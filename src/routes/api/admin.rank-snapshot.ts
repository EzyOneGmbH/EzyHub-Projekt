import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Rank-Snapshot-Ingest (Dashboard-Ausbau 2026-07-11, WP1/A1.2): der agent-service
// besitzt den Rank-Store (rank-tracking/<slug>.json, DataForSEO) und PUSHT nach
// jedem Tages-Crawl einen kompakten Snapshot hierher. Diese Route validiert und
// schreibt eine audit_runs-Zeile type 'rankings' (Payload 1:1). Idempotenz:
// existiert fuer client+date bereits eine rankings-Zeile -> Upsert (update),
// nie duplizieren. Secret-gated wie /api/admin/agent-run (ADMIN_AUTOMATION_SECRET).
//
// Messkontext (13.09.2026, Volkan): crawlLocation, Messmethode, Land, Sprache,
// Geraet und Messdatum werden im Snapshot BEWAHRT (crawlLocation wurde frueher
// validiert, aber verworfen). Methodenwechsel-Guard: ein Delta (posPrev7/28)
// gilt nur innerhalb derselben Messmethode (DataForSEO-Crawl vs. GSC-Ø) —
// sonst entstehen Schein-Bewegungen; der agent-service liefert dazu
// posPrev7Src/posPrev28Src, die Route erzwingt die Regel zusaetzlich und
// rechnet improved7/declined7 aus den bereinigten Deltas neu.

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

const Body = z.object({
  client: z.string().min(1), // slug, z.B. "hotel-ava"
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
export function guardMethodenwechsel(d: SnapshotBody): SnapshotBody {
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
export function baueSnapshotResult(d: SnapshotBody): Record<string, unknown> {
  const srcs = new Set(d.keywords.map((k) => k.posSrc).filter(Boolean));
  const method =
    d.method ?? (srcs.size > 1 ? "hybrid" : srcs.size === 1 ? ([...srcs][0] as string) : undefined);
  const result: Record<string, unknown> = {
    client: d.client,
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

function slugifyName(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const Route = createFileRoute("/api/admin/rank-snapshot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret)
          return Response.json(
            { ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" },
            { status: 503 },
          );
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json(
            { ok: false, error: "Invalid input", details: parsed.error.issues },
            { status: 400 },
          );
        const d = guardMethodenwechsel(parsed.data);

        // Client per Slug aufloesen (Store-Slug = slugify(clients.name)).
        const { data: clients } = await supabaseAdmin
          .from("clients")
          .select("id, name, domain, organization_id");
        const target = (clients || []).find(
          (c: any) =>
            slugifyName(c.name) === d.client ||
            slugifyName(
              String(c.domain || "")
                .replace(/^https?:\/\//, "")
                .replace(/^www\./, "")
                .split(".")[0],
            ) === d.client,
        );
        if (!target)
          return Response.json(
            { ok: false, error: `Kunde '${d.client}' nicht gefunden` },
            { status: 404 },
          );

        // triggered_by: audit_runs verlangt einen Org-User (gleiche Logik wie populate).
        const { data: users } = await supabaseAdmin
          .from("app_users")
          .select("user_id, role")
          .eq("organization_id", target.organization_id)
          .limit(20);
        const owner =
          (users || []).find((u: any) => ["owner", "admin"].includes(u.role)) || (users || [])[0];
        if (!owner)
          return Response.json(
            { ok: false, error: "Kein Org-User fuer triggered_by" },
            { status: 500 },
          );

        const result = baueSnapshotResult(d);

        // Upsert fuer client+date: bestehende rankings-Zeile desselben Tages updaten.
        const { data: existing } = await supabaseAdmin
          .from("audit_runs")
          .select("id")
          .eq("client_id", target.id)
          .eq("audit_type", "rankings")
          .eq("input->>date", d.date)
          .limit(1)
          .maybeSingle();

        const now = new Date().toISOString();
        if (existing?.id) {
          const { error } = await supabaseAdmin
            .from("audit_runs")
            .update({ result, status: "succeeded", finished_at: now } as never)
            .eq("id", existing.id);
          if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
          return Response.json({ ok: true, id: existing.id, upserted: true });
        }
        const { data: created, error } = await supabaseAdmin
          .from("audit_runs")
          .insert({
            client_id: target.id,
            organization_id: target.organization_id,
            triggered_by: (owner as any).user_id,
            audit_type: "rankings",
            status: "succeeded",
            input: { date: d.date, client: d.client },
            result,
            started_at: now,
            finished_at: now,
          } as never)
          .select("id")
          .single();
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        return Response.json({ ok: true, id: created?.id, upserted: false });
      },
    },
  },
});
