import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authenticateIngest, type IngestScope } from "@/server/ingest-auth.server";

// Rank-Snapshot-Ingest (Dashboard-Ausbau 2026-07-11, WP1/A1.2): der agent-service
// besitzt den Rank-Store (rank-tracking/<slug>.json, DataForSEO) und PUSHT nach
// jedem Tages-Crawl einen kompakten Snapshot hierher. Diese Route validiert und
// schreibt eine audit_runs-Zeile type 'rankings' (Payload 1:1). Idempotenz:
// existiert fuer client+date bereits eine rankings-Zeile -> Upsert (update),
// nie duplizieren.
//
// Mandanteneindeutig (13.09.2026, Volkan): clientId UND organizationId sind
// PFLICHT; der Kunde wird NIE mehr global ueber einen Slug gesucht (zwei
// Organisationen mit gleichem Kundennamen haetten sich sonst gegenseitig
// ueberschrieben). Zwei Auth-Pfade:
//  - kundenspezifisches Credential (purpose rank_snapshot, ingest_credentials):
//    clientId/organizationId muessen exakt dem Token-Scope entsprechen.
//  - interner Admin-Pfad (ADMIN_AUTOMATION_SECRET, agent-service): zusaetzlich
//    Pflicht-Header X-Ezy-Organization = organizationId (Org-Stempel des
//    Service) — fehlend/abweichend => 403.
// In beiden Faellen wird clientId gegen organizationId in `clients` geprueft.
// Der Slug (`client`) ist nur noch Anzeige-/Legacy-Feld; passt er nicht zum
// Kunden (oder ist er innerhalb der Organisation mehrdeutig), lehnt die Route ab.
//
// Messkontext (13.09.2026): crawlLocation, Messmethode, Land, Sprache, Geraet
// und Messdatum werden im Snapshot BEWAHRT. Methodenwechsel-Guard: ein Delta
// (posPrev7/28) gilt nur innerhalb derselben Messmethode (DataForSEO-Crawl vs.
// GSC-Ø); improved7/declined7 werden aus den bereinigten Deltas neu gezaehlt.

const PosSrc = z.enum(["crawl", "gsc"]);
const Keyword = z.object({
  kw: z.string().min(1),
  pos: z.number().int().min(1).nullable(),
  // Hybrid (09.09.2026): "crawl" = DataForSEO-SERP des Tages, "gsc" = GSC-Ø-Position (7 T, CH).
  posSrc: PosSrc.optional(),
  // Maps-Kasten (11.09.2026): Rang 1-3 im local_pack am letzten Crawl-Tag (standortbezogener Crawl).
  posLocal: z.number().int().min(1).nullable().optional(),
  posPrev7: z.number().int().min(1).nullable().optional(),
  posPrev28: z.number().int().min(1).nullable().optional(),
  // Messmethode der Vergleichswerte (13.09.2026) — fuer den Methodenwechsel-Guard.
  posPrev7Src: PosSrc.nullable().optional(),
  posPrev28Src: PosSrc.nullable().optional(),
  // Messdatum des Vergleichswerts (Store-Tag), rein informativ.
  posPrev7Date: z.string().nullable().optional(),
  posPrev28Date: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  volume: z.number().nullable().optional(),
  isMoney: z.boolean().optional(),
  // INT-Zweitmessung (06.08.): google.com USA/en, wöchentlich (Stores mit intl:true).
  posIntl: z.number().int().min(1).nullable().optional(),
  urlIntl: z.string().nullable().optional(),
  volumeIntl: z.number().nullable().optional(),
});
export type SnapshotKeyword = z.infer<typeof Keyword>;

const UUID = z.string().uuid();
const Body = z.object({
  // Mandant (13.09.2026): Pflicht.
  clientId: UUID,
  organizationId: UUID,
  // Slug nur noch Anzeige/Legacy (z. B. "hotel-ava") — nie Auswahlkriterium.
  client: z.string().min(1).max(120).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  crawlLocation: z.string().optional(), // z. B. "Lucerne,Lucerne,Switzerland" oder "Switzerland"
  // Messkontext (13.09.2026): alles optional, tolerant gegen aeltere Pusher.
  method: z.enum(["crawl", "gsc", "hybrid"]).optional(),
  country: z.string().optional(), // ISO-2, z. B. "CH"
  language: z.string().optional(), // z. B. "de"
  device: z.string().optional(), // "desktop" | "mobile"
  measuredAt: z.string().optional(), // ISO-Zeitstempel des Messlaufs
  keywords: z.array(Keyword),
  aggregate: z.object({
    tracked: z.number().int(),
    top3: z.number().int(),
    top10: z.number().int(),
    pos11to20: z.number().int(),
    notRanking: z.number().int(),
    improved7: z.number().int(),
    declined7: z.number().int(),
    avgPos: z.number().nullable(),
  }),
  // A1.3 Geo-Grid-Vorbereitung: tolerant entgegennehmen, 1:1 in den Payload legen.
  // Der Geo-Grid-Skill (erstmals Fr 17.07.) wird SPAETER angebunden — hier kein UI.
  geoGrid: z.any().optional(),
});
export type SnapshotBody = z.infer<typeof Body>;

/**
 * Methodenwechsel-Guard (pure, vitest-gedeckt): Vergleichswerte nur innerhalb
 * derselben Messmethode. Fehlt die Methode des Vergleichswerts (aeltere
 * Pusher), bleibt der Wert erhalten (kein Wissen = kein Eingriff); liegt sie
 * vor und weicht ab, wird das Delta auf null gesetzt. improved7/declined7
 * werden aus den bereinigten Werten neu gezaehlt.
 */
export function guardMethodenwechsel<T extends Pick<SnapshotBody, "keywords" | "aggregate">>(
  d: T,
): T {
  const keywords = d.keywords.map((k) => {
    const cur = k.posSrc ?? null;
    const guard = (prev: number | null | undefined, prevSrc: string | null | undefined) =>
      prev != null && prevSrc != null && cur != null && prevSrc !== cur ? null : (prev ?? null);
    return {
      ...k,
      posPrev7: guard(k.posPrev7, k.posPrev7Src),
      posPrev28: guard(k.posPrev28, k.posPrev28Src),
    };
  });
  const withPrev7 = keywords.filter((k) => k.pos != null && k.posPrev7 != null);
  return {
    ...d,
    keywords,
    aggregate: {
      ...d.aggregate,
      improved7: withPrev7.filter((k) => (k.pos as number) < (k.posPrev7 as number)).length,
      declined7: withPrev7.filter((k) => (k.pos as number) > (k.posPrev7 as number)).length,
    },
  };
}

/** Snapshot-Payload fuer audit_runs.result — bewahrt den Messkontext. */
export function baueSnapshotResult(
  d: Pick<
    SnapshotBody,
    | "client"
    | "date"
    | "keywords"
    | "aggregate"
    | "method"
    | "crawlLocation"
    | "country"
    | "language"
    | "device"
    | "measuredAt"
    | "geoGrid"
  > & { clientId?: string; organizationId?: string },
): Record<string, unknown> {
  const srcs = new Set(d.keywords.map((k) => k.posSrc).filter(Boolean));
  const method =
    d.method ?? (srcs.size > 1 ? "hybrid" : srcs.size === 1 ? ([...srcs][0] as string) : undefined);
  const result: Record<string, unknown> = {
    ...(d.client ? { client: d.client } : {}),
    ...(d.clientId ? { clientId: d.clientId } : {}),
    ...(d.organizationId ? { organizationId: d.organizationId } : {}),
    date: d.date,
    keywords: d.keywords,
    aggregate: d.aggregate,
    measurement: {
      method: method ?? null,
      crawlLocation: d.crawlLocation ?? null,
      country: d.country ?? "CH",
      language: d.language ?? "de",
      device: d.device ?? "desktop",
      measuredAt: d.measuredAt ?? null,
    },
  };
  if (d.crawlLocation) result.crawlLocation = d.crawlLocation;
  if (d.geoGrid !== undefined) result.geoGrid = d.geoGrid;
  return result;
}

export function slugifyName(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Slugs, unter denen ein Kunde legitim gepusht werden darf (Name, Domain-Stamm). */
export function kundenSlugs(c: { name?: string | null; domain?: string | null }): string[] {
  return [
    slugifyName(String(c.name || "")),
    slugifyName(
      String(c.domain || "")
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split(".")[0],
    ),
  ].filter(Boolean);
}

const nein = (status: number, error: string) => Response.json({ ok: false, error }, { status });

/**
 * Mandanten-Scope pruefen (pure gegen den Auth-Scope + Request-Header):
 * Credential-Scope muss exakt passen; Admin-Pfad braucht den Org-Stempel.
 */
export function pruefeScope(
  scope: IngestScope,
  request: Request,
  body: { clientId: string; organizationId: string },
): Response | null {
  if (!scope.admin) {
    if (
      scope.clientId.toLowerCase() !== body.clientId.toLowerCase() ||
      scope.organizationId.toLowerCase() !== body.organizationId.toLowerCase()
    )
      return nein(403, "clientId/organizationId passen nicht zum Token-Scope");
    return null;
  }
  const stempel = (request.headers.get("x-ezy-organization") || "").trim().toLowerCase();
  if (!stempel) return nein(403, "X-Ezy-Organization (Org-Stempel) erforderlich");
  if (stempel !== body.organizationId.toLowerCase())
    return nein(403, "organizationId passt nicht zum Org-Stempel");
  return null;
}

export const Route = createFileRoute("/api/admin/rank-snapshot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Auth: kundenspezifisches Credential (rank_snapshot) ODER interner
        // Admin-Pfad (ADMIN_AUTOMATION_SECRET) — beides ueber authenticateIngest
        // (Hash-Lookup, Widerruf/Ablauf, Rate-Limits, 401-Bremse).
        const auth = await authenticateIngest(request, "rank_snapshot");
        if (!auth.ok) return auth.response;

        const raw = await request.json().catch(() => ({}));
        // Legacy-Pusher (nur Slug) klar benennen, statt generisch «Invalid input».
        if (raw && typeof raw === "object" && !("clientId" in raw))
          return nein(
            400,
            "clientId (uuid) und organizationId (uuid) sind Pflicht — Slug genuegt nicht",
          );
        const parsed = Body.safeParse(raw);
        if (!parsed.success)
          return Response.json(
            { ok: false, error: "Invalid input", details: parsed.error.issues },
            { status: 400 },
          );
        const scopeFehler = pruefeScope(auth.scope, request, parsed.data);
        if (scopeFehler) return scopeFehler;
        const d = guardMethodenwechsel(parsed.data);

        // Kunde MUSS in genau dieser Organisation existieren (serverseitiger Scope).
        const { data: target } = await supabaseAdmin
          .from("clients")
          .select("id, name, domain, organization_id")
          .eq("id", d.clientId)
          .eq("organization_id", d.organizationId)
          .maybeSingle();
        if (!target) return nein(404, "Kunde nicht in dieser Organisation gefunden");

        // Slug ist nur Anzeige/Legacy: muss zum Kunden passen; ist er in der
        // Organisation mehrdeutig, darf er nie als Auswahl gedient haben.
        if (d.client) {
          const slug = slugifyName(d.client);
          if (!kundenSlugs(target).includes(slug))
            return nein(400, `client (Slug '${d.client}') passt nicht zum clientId`);
          const { data: gleiche } = await supabaseAdmin
            .from("clients")
            .select("id, name, domain")
            .eq("organization_id", d.organizationId);
          const treffer = (gleiche || []).filter((c: any) => kundenSlugs(c).includes(slug));
          if (treffer.length > 1 && !treffer.some((c: any) => c.id === target.id))
            return nein(409, `Slug '${d.client}' ist in dieser Organisation mehrdeutig`);
        }

        // triggered_by: audit_runs verlangt einen Org-User — NUR aus dieser Organisation.
        const { data: users } = await supabaseAdmin
          .from("app_users")
          .select("user_id, role")
          .eq("organization_id", d.organizationId)
          .limit(20);
        const owner =
          (users || []).find((u: any) => ["owner", "admin"].includes(u.role)) || (users || [])[0];
        if (!owner) return nein(500, "Kein Org-User fuer triggered_by");

        const result = baueSnapshotResult(d);

        // Upsert fuer client+date INNERHALB der Organisation.
        const { data: existing } = await supabaseAdmin
          .from("audit_runs")
          .select("id")
          .eq("client_id", target.id)
          .eq("organization_id", d.organizationId)
          .eq("audit_type", "rankings")
          .eq("input->>date", d.date)
          .limit(1)
          .maybeSingle();

        const now = new Date().toISOString();
        if (existing?.id) {
          const { error } = await supabaseAdmin
            .from("audit_runs")
            .update({ result, status: "succeeded", finished_at: now } as never)
            .eq("id", existing.id)
            .eq("organization_id", d.organizationId);
          if (error) return nein(500, error.message);
          return Response.json({ ok: true, id: existing.id, upserted: true });
        }
        const { data: created, error } = await supabaseAdmin
          .from("audit_runs")
          .insert({
            client_id: target.id,
            organization_id: d.organizationId,
            triggered_by: (owner as any).user_id,
            audit_type: "rankings",
            status: "succeeded",
            input: { date: d.date, clientId: target.id, ...(d.client ? { client: d.client } : {}) },
            result,
            started_at: now,
            finished_at: now,
          } as never)
          .select("id")
          .single();
        if (error) return nein(500, error.message);
        return Response.json({ ok: true, id: created?.id, upserted: false });
      },
    },
  },
});
