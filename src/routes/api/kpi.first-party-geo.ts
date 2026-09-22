import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireTeamRole } from "@/server/team-guard.server";
import { ZeitraumFehler, istYmd, zeitraumAusParams } from "@/lib/date-range";
import {
  DID_DEFAULTS,
  DidParamFehler,
  aggregiereReferrals,
  bereiteDid,
  brandBegriffeAus,
  brandWochen,
  crawlerBlock,
  didFenster,
  hostAusDomain,
  kreuzeZitate,
  ladeRobots,
  zitierteUrlsAusReports,
  type BrandWocheZeile,
  type KiReferralZeile,
  type SeiteTagZeile,
  type SeiteZeitraumZeile,
} from "@/server/first-party-geo.server";

// First-Party GEO, Phase 4 (22.09.2026, Volkan): GEO-Kacheln im EzyAI-Tab aus
// den First-Party-Daten (gsc_daily, ga4_landing_daily) — Muster und Sichtbarkeit
// wie /api/kpi/first-party: nur Owner/Admin der AKTIVEN Organisation, Kunde in
// der Organisation, Kunden-Flag clients.metadata.first_party_kpi, sonst
// {aktiv:false}. Reine Logik in src/server/first-party-geo.server.ts.
//
// GET  ?client=<uuid>&startDate&endDate|days&block=referrals|zitate|brand|crawler
//      (ohne block = alle vier). Bloecke laufen parallel und fail-soft: ein
//      Fehler landet redaktiert in fehler[block], die anderen liefern.
//      referrals  KI-Referrals aus GA4 (kpi_ki_referrals + klassifiziereKiQuelle)
//      zitate     zitierte eigene URLs (juengster AI-Visibility-Report,
//                 parts.br.urls ∪ parts.sa.urls) x GSC-Seiten (kpi_seiten_zeitraum)
//      brand      Brand/Nonbrand je ISO-Woche (kpi_brand_wochen) + Trend
//      crawler    robots.txt der Kundendomain gegen die KI-Crawler-Referenz
// POST {client, action:"did", pages[], changeDate, praeTage?, washoutTage?, postTage?}
//      Difference-in-Differences (kpi_seiten_tage) fuer eine Massnahme.
// Antworten sind nie cachebar (no-store); Fehlertexte nur message, gekuerzt.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const FLAG_FELD = "first_party_kpi";
export const BLOECKE = ["referrals", "zitate", "brand", "crawler"] as const;
type BlockName = (typeof BLOECKE)[number];

/** Grenzen fuer die DiD-Parameter (Tage). */
export const DID_GRENZEN = {
  praeTage: { min: 7, max: 180 },
  washoutTage: { min: 0, max: 60 },
  postTage: { min: 7, max: 120 },
  maxPages: 200,
} as const;

class ParamFehler extends Error {}

/** Redaktierte Fehlermeldung: nur message, gekuerzt — nie Rohdaten der DB. */
export function redaktiereFehler(e: unknown): string {
  const msg =
    typeof e === "string"
      ? e
      : e && typeof e === "object" && "message" in e
        ? String((e as { message?: unknown }).message ?? "")
        : "";
  const sauber = msg.replace(/\s+/g, " ").trim();
  return sauber ? sauber.slice(0, 160) : "Abfrage fehlgeschlagen";
}

/** rpc-Aufruf → Zeilen; PostgREST-Fehler werden als Error (nur message) geworfen. */
async function rpcZeilen<T>(
  p: PromiseLike<{ data: T[] | null; error: { message?: string } | null }>,
): Promise<T[]> {
  const { data, error } = await p;
  if (error) throw new Error(redaktiereFehler(error));
  return Array.isArray(data) ? data : [];
}

function ganzzahl(roh: unknown, name: string, def: number, min: number, max: number): number {
  if (roh == null || roh === "") return def;
  const n = Number(roh);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new ParamFehler(`${name} muss eine ganze Zahl zwischen ${min} und ${max} sein`);
  return n;
}

const NO_STORE = { "cache-control": "no-store" };
const antwort = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

type Kunde = {
  id: string;
  organization_id: string;
  metadata: unknown;
  domain: string | null;
  brand_terms: unknown;
};

/** Kunde der aktiven Organisation laden; null, wenn fremd/unbekannt. */
async function ladeKunde(sb: any, clientId: string, organizationId: string): Promise<Kunde | null> {
  const { data } = await sb
    .from("clients")
    .select("id, organization_id, metadata, domain, brand_terms")
    .eq("id", clientId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return (data as Kunde | null) ?? null;
}

const flagGesetzt = (k: Kunde) => (k.metadata as any)?.[FLAG_FELD] === true;

export const Route = createFileRoute("/api/kpi/first-party-geo")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const t = await requireTeamRole(request, "admin");
        if (t instanceof Response) return t;

        const p = new URL(request.url).searchParams;
        const clientId = String(p.get("client") || "").trim();
        if (!UUID_RE.test(clientId))
          return antwort({ ok: false, error: "client (UUID) fehlt oder ungültig" }, 400);
        const blockRoh = String(p.get("block") || "").trim();
        if (blockRoh && !(BLOECKE as readonly string[]).includes(blockRoh))
          return antwort(
            { ok: false, error: `block muss eines von ${BLOECKE.join("|")} sein` },
            400,
          );
        const gewuenscht = new Set<BlockName>(blockRoh ? [blockRoh as BlockName] : BLOECKE);

        let range: { from: string; to: string; days: number };
        try {
          const z = zeitraumAusParams(p, { defaultDays: 28, maxDays: 366 });
          range = { from: z.startDate, to: z.endDate, days: z.days };
        } catch (e) {
          if (e instanceof ZeitraumFehler) return antwort({ ok: false, error: e.message }, 400);
          throw e;
        }

        const sb = supabaseAdmin as any;
        const kunde = await ladeKunde(sb, clientId, t.organizationId);
        if (!kunde) return antwort({ ok: false, error: "Kunde nicht gefunden" }, 404);
        if (!flagGesetzt(kunde)) return antwort({ ok: true, aktiv: false, range });

        const basis = { _client_id: kunde.id, _von: range.from, _bis: range.to };
        const fehler: Record<string, string> = {};
        const block = async <T>(name: BlockName, fn: () => Promise<T>): Promise<T | undefined> => {
          if (!gewuenscht.has(name)) return undefined;
          try {
            return await fn();
          } catch (e) {
            fehler[name] = redaktiereFehler(e);
            console.warn(`[kpi.first-party-geo] ${name}:`, fehler[name]);
            return undefined;
          }
        };

        const [referrals, zitate, brand, crawler] = await Promise.all([
          block("referrals", async () => {
            const rows = await rpcZeilen<KiReferralZeile>(sb.rpc("kpi_ki_referrals", basis));
            return aggregiereReferrals(rows, range);
          }),
          block("zitate", async () => {
            const [rep, seiten] = await Promise.all([
              sb
                .from("ai_visibility_reports")
                .select("snapshot_date, parts")
                .eq("client_id", kunde.id)
                .order("snapshot_date", { ascending: false })
                .limit(10) as PromiseLike<{ data: unknown; error: { message?: string } | null }>,
              rpcZeilen<SeiteZeitraumZeile>(sb.rpc("kpi_seiten_zeitraum", basis)),
            ]);
            if (rep.error) throw new Error(redaktiereFehler(rep.error));
            const reports = Array.isArray(rep.data) ? rep.data : [];
            const { standVom, urls } = zitierteUrlsAusReports(reports);
            return kreuzeZitate(urls, seiten, standVom);
          }),
          block("brand", async () => {
            const begriffe = brandBegriffeAus(kunde);
            const rows = await rpcZeilen<BrandWocheZeile>(
              sb.rpc("kpi_brand_wochen", { ...basis, _begriffe: begriffe }),
            );
            return brandWochen(rows, begriffe, range);
          }),
          block("crawler", async () => {
            const host = hostAusDomain(kunde.domain);
            if (!host) {
              fehler.crawler = "Keine Domain beim Kunden hinterlegt";
              return crawlerBlock(null, false, "");
            }
            const robotsUrl = `https://${host}/robots.txt`;
            const { geladen, text } = await ladeRobots(robotsUrl);
            return crawlerBlock(robotsUrl, geladen, text);
          }),
        ]);

        return antwort({
          ok: true,
          aktiv: true,
          range,
          ...(referrals ? { referrals } : {}),
          ...(zitate ? { zitate } : {}),
          ...(brand ? { brand } : {}),
          ...(crawler ? { crawler } : {}),
          ...(Object.keys(fehler).length ? { fehler } : {}),
        });
      },

      POST: async ({ request }) => {
        const t = await requireTeamRole(request, "admin");
        if (t instanceof Response) return t;

        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        if (!body || typeof body !== "object")
          return antwort({ ok: false, error: "JSON-Body fehlt oder ungültig" }, 400);
        const clientId = String(body.client || "").trim();
        if (!UUID_RE.test(clientId))
          return antwort({ ok: false, error: "client (UUID) fehlt oder ungültig" }, 400);
        if (body.action !== "did")
          return antwort({ ok: false, error: 'action muss "did" sein' }, 400);

        let pages: string[];
        let praeTage: number, washoutTage: number, postTage: number;
        const changeDate = String(body.changeDate || "").trim();
        try {
          const roh = Array.isArray(body.pages) ? body.pages : null;
          if (!roh) throw new ParamFehler("pages muss eine Liste von URLs sein");
          pages = [...new Set(roh.map((x) => String(x ?? "").trim()).filter(Boolean))];
          if (!pages.length) throw new ParamFehler("pages darf nicht leer sein");
          if (pages.length > DID_GRENZEN.maxPages)
            throw new ParamFehler(`pages: höchstens ${DID_GRENZEN.maxPages} URLs`);
          if (!istYmd(changeDate)) throw new ParamFehler("changeDate muss YYYY-MM-DD sein");
          const g = DID_GRENZEN;
          praeTage = ganzzahl(
            body.praeTage,
            "praeTage",
            DID_DEFAULTS.praeTage,
            g.praeTage.min,
            g.praeTage.max,
          );
          washoutTage = ganzzahl(
            body.washoutTage,
            "washoutTage",
            DID_DEFAULTS.washoutTage,
            g.washoutTage.min,
            g.washoutTage.max,
          );
          postTage = ganzzahl(
            body.postTage,
            "postTage",
            DID_DEFAULTS.postTage,
            g.postTage.min,
            g.postTage.max,
          );
        } catch (e) {
          if (e instanceof ParamFehler) return antwort({ ok: false, error: e.message }, 400);
          throw e;
        }

        const sb = supabaseAdmin as any;
        const kunde = await ladeKunde(sb, clientId, t.organizationId);
        if (!kunde) return antwort({ ok: false, error: "Kunde nicht gefunden" }, 404);
        if (!flagGesetzt(kunde)) return antwort({ ok: true, aktiv: false });

        let fenster;
        try {
          fenster = didFenster(changeDate, praeTage, washoutTage, postTage);
        } catch (e) {
          if (e instanceof DidParamFehler) return antwort({ ok: false, error: e.message }, 400);
          throw e;
        }

        let zeilen: SeiteTagZeile[];
        try {
          zeilen = await rpcZeilen<SeiteTagZeile>(
            sb.rpc("kpi_seiten_tage", {
              _client_id: kunde.id,
              _von: fenster.ladeVon,
              _bis: fenster.ladeBis,
            }),
          );
        } catch (e) {
          const msg = redaktiereFehler(e);
          console.warn("[kpi.first-party-geo] did:", msg);
          return antwort({ ok: false, error: msg }, 502);
        }

        return antwort({ ok: true, aktiv: true, did: bereiteDid({ pages, zeilen, fenster }) });
      },
    },
  },
});
