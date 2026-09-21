import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireTeamRole } from "@/server/team-guard.server";
import { ZeitraumFehler, zeitraumAusParams } from "@/lib/date-range";

// First-Party-KPIs, Phase 3 (22.09.2026, Volkan): Kachel-Daten fuer den
// SEO-Tab aus den Phase-2a-Auswertungen (SQL-Funktionen kpi_*). Sichtbarkeit
// nach Volkans Entscheid: nur Owner/Admin der AKTIVEN Organisation, Kunde
// muss zur Organisation gehoeren, und das Kunden-Flag
// clients.metadata.first_party_kpi muss gesetzt sein — sonst {aktiv:false}
// (die Kacheln werden dann gar nicht gerendert).
//
// GET ?client=<uuid>&startDate&endDate | days &minImpressions&posVon&posBis
//     &zielposition&limit
// Alle fuenf Auswertungen laufen parallel und fail-soft: ein Fehler in einem
// Block liefert dort {rows: [], fehler} statt die ganze Antwort zu kippen.
// Fehlertexte sind redaktiert (nur message, gekuerzt — nie details/hint/code
// aus PostgREST). Antwort ist nie cachebar (no-store).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const FLAG_FELD = "first_party_kpi";

export const KONFIG_DEFAULTS = {
  minImpressions: 100,
  posVon: 8,
  posBis: 20,
  zielposition: 5,
  limit: 25,
  /** Gewinner/Verlierer und Organic-Conversions: Top N je Liste. */
  topN: 10,
} as const;

type Block<T> = { rows: T[]; fehler: string | null };

class ParamFehler extends Error {}

/** Ganzzahl-Parameter mit Default und Grenzen; ungueltige Angaben → 400. */
function ganzzahl(p: URLSearchParams, name: string, def: number, min: number, max: number): number {
  const roh = p.get(name);
  if (roh == null || roh === "") return def;
  const n = Number(roh);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new ParamFehler(`${name} muss eine ganze Zahl zwischen ${min} und ${max} sein`);
  return n;
}

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

async function block<T>(
  quelle: string,
  p: PromiseLike<{ data: T[] | null; error: { message?: string } | null }>,
): Promise<Block<T>> {
  try {
    const { data, error } = await p;
    if (error) {
      console.warn(`[kpi.first-party] ${quelle}:`, redaktiereFehler(error));
      return { rows: [], fehler: redaktiereFehler(error) };
    }
    return { rows: Array.isArray(data) ? data : [], fehler: null };
  } catch (e) {
    console.warn(`[kpi.first-party] ${quelle}:`, redaktiereFehler(e));
    return { rows: [], fehler: redaktiereFehler(e) };
  }
}

type Datenstand = { quelle: string; von: string; bis: string; zeilen: number };
type GewinnerVerlierer = { richtung: string; [k: string]: unknown };
type CtrPunkt = { quelle: string; [k: string]: unknown };

/** Liegt fuer mindestens eine Quelle ein Datenstand mit Zeilen IM Zeitraum vor? */
export function datenImZeitraum(rows: Datenstand[], von: string, bis: string): boolean {
  return rows.some(
    (r) =>
      Number(r.zeilen) > 0 &&
      typeof r.von === "string" &&
      typeof r.bis === "string" &&
      r.von.slice(0, 10) <= bis &&
      r.bis.slice(0, 10) >= von,
  );
}

const NO_STORE = { "cache-control": "no-store" };
const antwort = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

export const Route = createFileRoute("/api/kpi/first-party")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const t = await requireTeamRole(request, "admin");
        if (t instanceof Response) return t;

        const p = new URL(request.url).searchParams;
        const clientId = String(p.get("client") || "").trim();
        if (!UUID_RE.test(clientId))
          return antwort({ ok: false, error: "client (UUID) fehlt oder ungültig" }, 400);

        let range: { from: string; to: string; days: number };
        let konfig: {
          minImpressions: number;
          posVon: number;
          posBis: number;
          zielposition: number;
          limit: number;
        };
        try {
          const z = zeitraumAusParams(p, { defaultDays: 28, maxDays: 366 });
          range = { from: z.startDate, to: z.endDate, days: z.days };
          konfig = {
            minImpressions: ganzzahl(p, "minImpressions", KONFIG_DEFAULTS.minImpressions, 0, 1e9),
            posVon: ganzzahl(p, "posVon", KONFIG_DEFAULTS.posVon, 1, 100),
            posBis: ganzzahl(p, "posBis", KONFIG_DEFAULTS.posBis, 1, 100),
            zielposition: ganzzahl(p, "zielposition", KONFIG_DEFAULTS.zielposition, 1, 100),
            limit: ganzzahl(p, "limit", KONFIG_DEFAULTS.limit, 1, 100),
          };
          if (konfig.posVon > konfig.posBis)
            throw new ParamFehler("posVon darf nicht grösser als posBis sein");
        } catch (e) {
          if (e instanceof ZeitraumFehler || e instanceof ParamFehler)
            return antwort({ ok: false, error: e.message }, 400);
          throw e;
        }

        const sb = supabaseAdmin as any;
        const { data: client } = await sb
          .from("clients")
          .select("id, organization_id, metadata")
          .eq("id", clientId)
          .eq("organization_id", t.organizationId)
          .maybeSingle();
        if (!client) return antwort({ ok: false, error: "Kunde nicht gefunden" }, 404);
        if ((client.metadata as any)?.[FLAG_FELD] !== true)
          return antwort({ ok: true, aktiv: false, range });

        const basis = { _client_id: client.id as string, _von: range.from, _bis: range.to };
        const [datenstand, chancen, gv, organicConversions, ctrKurve] = await Promise.all([
          block<Datenstand>("kpi_datenstand", sb.rpc("kpi_datenstand", { _client_id: client.id })),
          block(
            "kpi_chancen_keywords",
            sb.rpc("kpi_chancen_keywords", {
              ...basis,
              _min_impressions: konfig.minImpressions,
              _pos_von: konfig.posVon,
              _pos_bis: konfig.posBis,
              _zielposition: konfig.zielposition,
              _limit: konfig.limit,
            }),
          ),
          block<GewinnerVerlierer>(
            "kpi_gewinner_verlierer",
            sb.rpc("kpi_gewinner_verlierer", { ...basis, _limit: KONFIG_DEFAULTS.topN }),
          ),
          block(
            "kpi_organic_conversions",
            sb.rpc("kpi_organic_conversions", { ...basis, _limit: KONFIG_DEFAULTS.topN }),
          ),
          block<CtrPunkt>("kpi_ctr_kurve", sb.rpc("kpi_ctr_kurve", basis)),
        ]);

        const gewinner = {
          rows: gv.rows.filter((r) => r.richtung === "gewinner"),
          fehler: gv.fehler,
        };
        const verlierer = {
          rows: gv.rows.filter((r) => r.richtung === "verlierer"),
          fehler: gv.fehler,
        };
        // «leer»: keine eigenen Zeilen (GSC + GA4) im Zeitraum — Referenz-CTR-
        // Punkte zaehlen nicht als Kundendaten.
        const leer =
          !datenImZeitraum(datenstand.rows, range.from, range.to) &&
          chancen.rows.length === 0 &&
          gv.rows.length === 0 &&
          organicConversions.rows.length === 0 &&
          !ctrKurve.rows.some((r) => r.quelle === "eigene");

        return antwort({
          ok: true,
          aktiv: true,
          range,
          datenstand,
          konfig,
          chancen,
          gewinner,
          verlierer,
          organicConversions,
          ctrKurve,
          leer,
        });
      },
    },
  },
});
