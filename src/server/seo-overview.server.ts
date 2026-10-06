import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "./google-tokens.server";
import { ga4RunReportUrl } from "./ga4.server";
import { gscTotals, type GscFilter } from "./gsc.server";
import { heuteYmd, type Zeitraum } from "@/lib/date-range";
import { cacheLesen, cacheSchreiben } from "./uebersicht-cache.server";

// Agentur-Performance-Tabelle EzyRank (29.09.2026, analog EzyPerformance):
// SEO-Kennzahlen mehrerer Kunden fuer Zeitraum + Vergleich. Nur lesend, nichts
// wird persistiert.
//  - Traffic / Traffic CH: GA4-Sitzungen Kanal «Organic Search» (wie die Kachel
//    «Org. Traffic»), CH = countryId CH. Ohne GA4 Fallback auf Google-Klicks
//    aus der Search Console (country che) — Quelle wird mitgeliefert.
//  - Top 3 / Top 10: Rankings-Lauf (Crawl-Basis) zum Ende des Zeitraums bzw.
//    der Vergleichsperiode — gleiche Stichtag-Logik wie das SEO-Dashboard.
//  - Visibility Index: Sistrix (CH), gespeichert im Backlink-Lauf
//    (audit_type «ahrefs», result.sistrix) — ebenfalls per Stichtag.

export type SeoKennzahlen = {
  traffic: number | null;
  trafficCh: number | null;
  top3: number | null;
  top10: number | null;
  visibility: number | null;
};

export type SeoStand = {
  /** Datum des verwendeten Rankings-Laufs (YYYY-MM-DD) */
  rank: string | null;
  /** Datum des verwendeten Backlink-/Sistrix-Laufs */
  visibility: string | null;
};

export type SeoOverviewZeile = {
  clientId: string;
  cur: SeoKennzahlen | null;
  prev: SeoKennzahlen | null;
  /** Herkunft der Traffic-Werte */
  trafficQuelle: "ga4" | "gsc" | null;
  stand: { cur: SeoStand; prev: SeoStand };
  /**
   * Top-3/Top-10-Vergleich: "ok" = gleiche Messmethode, "methodenwechsel" =
   * Vergleichslauf anders gezaehlt (kein Delta), null = kein frueherer Lauf.
   */
  rankVergleich?: "ok" | "methodenwechsel" | null;
  /** Lesbarer Grund bei "methodenwechsel" (z. B. «Crawl-Standort geändert (…)») */
  rankVergleichGrund?: string | null;
  /** Land des Sistrix-Index des aktuellen Werts («ch», «fr» …); Altlaeufe ohne Angabe = «ch». */
  visibilityLand?: string | null;
  /** Hinweise zu fehlenden Teilen (nicht fatal) */
  hinweise: string[];
  error: string | null;
};

export type SeoOverviewKunde = {
  id: string;
  ga4_property: string | null;
  gsc_property: string | null;
};

const LEER: SeoKennzahlen = {
  traffic: null,
  trafficCh: null,
  top3: null,
  top10: null,
  visibility: null,
};

/**
 * GA4-Antwort (dimensions countryId [+ dateRange bei 2 Zeitraeumen], metric
 * sessions, bereits auf Organic Search gefiltert) → Summe + CH je Zeitraum.
 * Mit zwei dateRanges haengt GA4 die Dimension «dateRange» (date_range_0/1)
 * automatisch als LETZTE Dimension an.
 */
export function parseGa4Organisch(json: any): {
  cur: { total: number; ch: number };
  prev: { total: number; ch: number };
} {
  const out = { cur: { total: 0, ch: 0 }, prev: { total: 0, ch: 0 } };
  const headers: string[] = (json?.dimensionHeaders ?? []).map((h: any) => String(h?.name ?? ""));
  const iLand = headers.indexOf("countryId");
  const iRange = headers.indexOf("dateRange");
  for (const row of json?.rows ?? []) {
    const dims = row?.dimensionValues ?? [];
    const land = String(dims[iLand]?.value ?? "");
    const range = iRange >= 0 ? String(dims[iRange]?.value ?? "") : "date_range_0";
    const n = Number(row?.metricValues?.[0]?.value ?? 0) || 0;
    const ziel = range === "date_range_1" ? out.prev : out.cur;
    ziel.total += n;
    if (land.toUpperCase() === "CH") ziel.ch += n;
  }
  return out;
}

/**
 * Stichtag fuer gespeicherte Laeufe: Tagesende (Europe/Zurich) des Datums;
 * Datum heute oder spaeter → null (= neuester Lauf), wie useEzyLatestRun.
 */
export function stichtagIso(ymd: string, jetztMs: number = Date.now()): string | null {
  if (ymd >= heuteYmd(jetztMs)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  // Offset der Zuercher Zeit an diesem Tag ermitteln (CET/CEST).
  const probe = new Date(Date.UTC(y, m - 1, d, 12));
  const teil = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Zurich",
    timeZoneName: "shortOffset",
  })
    .formatToParts(probe)
    .find((p) => p.type === "timeZoneName")?.value;
  const mm = /GMT([+-]\d{1,2})(?::(\d{2}))?/.exec(teil ?? "");
  const offsetMin = mm ? Number(mm[1]) * 60 + Math.sign(Number(mm[1])) * Number(mm[2] ?? 0) : 60;
  const utcMs = Date.UTC(y, m - 1, d, 23, 59, 59, 999) - offsetMin * 60_000;
  return new Date(utcMs).toISOString();
}

type Lauf = { id: string; created_at: string; wert: any; ort?: string | null };

/**
 * Methodenwechsel-Guard fuer Top 3 / Top 10 (analog guardMethodenwechsel der
 * Rank-Snapshot-Route): Anzahlen sind nur vergleichbar, wenn beide Laeufe nach
 * derselben Methode gezaehlt (seit 14.09.2026 Crawl-Basis, vorher Hybrid) UND
 * am selben Crawl-Standort gemessen wurden — sonst Schein-Verluste.
 */
/** Seit diesem Tag zaehlt der agent-service Top 3/10 nur aus Crawl-Positionen. */
export const RANK_CRAWLBASIS_AB = "2026-09-14";

/**
 * Zaehlmethode eines Laufs: aggregate.basis, falls vorhanden — die Snapshot-
 * Route speichert das Feld derzeit NICHT (Zod-Schema ohne basis), daher
 * Fallback ueber das Laufdatum (vor 14.09.2026 Hybrid-Zaehlung).
 */
export function rankZaehlmethode(l: { wert?: any; created_at?: string | null } | null): string {
  const basis = l?.wert?.basis;
  if (basis) return String(basis);
  return String(l?.created_at ?? "").slice(0, 10) >= RANK_CRAWLBASIS_AB ? "crawl" : "hybrid";
}

type RankLaufInfo = { wert?: any; ort?: string | null; created_at?: string | null } | null;

/**
 * Grund, warum zwei Laeufe NICHT vergleichbar sind — null = vergleichbar.
 * Standort: wie guardMethodenwechsel «kein Wissen = kein Eingriff» — nur wenn
 * BEIDE Laeufe einen crawlLocation tragen und dieser abweicht, wird blockiert.
 */
export function rankVergleichGrund(cur: RankLaufInfo, prev: RankLaufInfo): string | null {
  if (!cur || !prev) return "Kein Vergleichslauf";
  const mCur = rankZaehlmethode(cur);
  const mPrev = rankZaehlmethode(prev);
  const name = (m: string) => (m === "hybrid" ? "Hybrid-Zählung" : m === "crawl" ? "Crawl" : m);
  if (mCur !== mPrev) return `Zählmethode geändert (${name(mPrev)} → ${name(mCur)})`;
  const oCur = String(cur.ort ?? "").trim();
  const oPrev = String(prev.ort ?? "").trim();
  if (oCur && oPrev && oCur !== oPrev) return `Crawl-Standort geändert (${oPrev} → ${oCur})`;
  return null;
}

export function rankVergleichbar(cur: RankLaufInfo, prev: RankLaufInfo): boolean {
  return rankVergleichGrund(cur, prev) === null;
}

async function letzterLauf(
  clientId: string,
  auditType: "rankings" | "ahrefs",
  feld: string,
  bisIso: string | null,
  extra = "",
): Promise<Lauf | null> {
  let q = (supabaseAdmin as any)
    .from("audit_runs")
    .select(`id, created_at, wert:${feld}${extra}`)
    .eq("client_id", clientId)
    .eq("audit_type", auditType)
    .eq("status", "succeeded");
  if (bisIso) q = q.lte("created_at", bisIso);
  const { data } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as Lauf | null) ?? null;
}

/** Land des gespeicherten Sistrix-Werts (result.sistrix.country); fehlt es, galt «ch». */
export function sistrixLandDesLaufs(l: { wert?: any } | null): string {
  return String(l?.wert?.country || "ch").toLowerCase();
}

const zahlOderNull = (v: unknown): number | null => {
  const n = Number(v);
  return v == null || !Number.isFinite(n) ? null : n;
};

// Zwischenspeicher (06.10.2026): 60 min, Arbeitsspeicher + Tabelle
// uebersicht_cache — gilt für alle Instanzen und Nutzer (uebersicht-cache.server).
/** Nur vollständige Zeilen speichern — Google-Fehler nicht eine Stunde festhalten. */
export function seoZeileSpeicherbar(z: Pick<SeoOverviewZeile, "hinweise" | "error">): boolean {
  if (z.error) return false;
  return !(z.hinweise || []).some((h) => /^(GA4:|Search Console:|Google nicht verbunden)/.test(h));
}

export async function fetchSeoOverviewZeile(
  kunde: SeoOverviewKunde,
  fenster: { aktuell: Zeitraum; vorher: Zeitraum },
  googleErlaubt: boolean,
): Promise<SeoOverviewZeile> {
  const { aktuell, vorher } = fenster;
  const key = `${kunde.id}|${aktuell.startDate}|${aktuell.endDate}|${vorher.startDate}|${vorher.endDate}`;
  const hit = await cacheLesen<SeoOverviewZeile>("seo", `${key}|${googleErlaubt ? 1 : 0}`);
  if (hit) return hit;

  const cur: SeoKennzahlen = { ...LEER };
  const prev: SeoKennzahlen = { ...LEER };
  const hinweise: string[] = [];
  let trafficQuelle: SeoOverviewZeile["trafficQuelle"] = null;

  // ── Rankings + Sichtbarkeit aus gespeicherten Laeufen ──────────────────────
  const bisCur = stichtagIso(aktuell.endDate);
  const bisPrev = stichtagIso(vorher.endDate);
  const [rCur, rPrev, vCur, vPrev] = await Promise.all([
    letzterLauf(kunde.id, "rankings", "result->aggregate", bisCur, ", ort:result->>crawlLocation"),
    letzterLauf(kunde.id, "rankings", "result->aggregate", bisPrev, ", ort:result->>crawlLocation"),
    letzterLauf(kunde.id, "ahrefs", "result->sistrix", bisCur),
    letzterLauf(kunde.id, "ahrefs", "result->sistrix", bisPrev),
  ]);
  if (rCur) {
    cur.top3 = zahlOderNull(rCur.wert?.top3);
    cur.top10 = zahlOderNull(rCur.wert?.top10);
  } else hinweise.push("Kein Rankings-Lauf bis Zeitraum-Ende");
  // Vergleich nur, wenn ein ANDERER (frueherer) Lauf existiert — wie im Dashboard —
  // und beide nach derselben Methode gezaehlt wurden (Methodenwechsel-Guard).
  let rankVergleich: SeoOverviewZeile["rankVergleich"] = null;
  let rankVergleichGrundText: string | null = null;
  if (rPrev && rCur && rPrev.id !== rCur.id) {
    rankVergleichGrundText = rankVergleichGrund(rCur, rPrev);
    if (rankVergleichGrundText === null) {
      prev.top3 = zahlOderNull(rPrev.wert?.top3);
      prev.top10 = zahlOderNull(rPrev.wert?.top10);
      rankVergleich = "ok";
    } else {
      rankVergleich = "methodenwechsel";
    }
  }
  const vi = (l: Lauf | null) => {
    const n = zahlOderNull(l?.wert?.visibility_index);
    return n != null && n > 0 ? n : null; // 0 = aeltere Laeufe ohne Sistrix
  };
  cur.visibility = vi(vCur);
  // Sistrix-Land (30.09.2026): Werte verschiedener Laender-Indizes sind nicht
  // vergleichbar (z. B. Wechsel CH → FR) — dann kein Vorwert.
  const visibilityLand = sistrixLandDesLaufs(vCur);
  if (vPrev && vCur && vPrev.id !== vCur.id && sistrixLandDesLaufs(vPrev) === visibilityLand)
    prev.visibility = vi(vPrev);
  if (cur.visibility == null) hinweise.push("Kein Sistrix-Wert bis Zeitraum-Ende");

  // ── Traffic: GA4 (Organic Search), Fallback GSC ────────────────────────────
  if (!googleErlaubt) {
    hinweise.push("Google-Integration deaktiviert");
  } else if (!kunde.ga4_property && !kunde.gsc_property) {
    hinweise.push("Weder GA4 noch Search Console hinterlegt");
  } else {
    let token = "";
    try {
      token = (await getGoogleAccessToken(kunde.id)).accessToken;
    } catch {
      hinweise.push("Google nicht verbunden");
    }
    if (token && kunde.ga4_property) {
      try {
        const res = await fetch(ga4RunReportUrl(String(kunde.ga4_property)), {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            dateRanges: [
              { startDate: aktuell.startDate, endDate: aktuell.endDate },
              { startDate: vorher.startDate, endDate: vorher.endDate },
            ],
            dimensions: [{ name: "countryId" }],
            metrics: [{ name: "sessions" }],
            dimensionFilter: {
              filter: {
                fieldName: "sessionDefaultChannelGroup",
                stringFilter: { matchType: "EXACT", value: "Organic Search" },
              },
            },
            limit: 1000,
          }),
          signal: AbortSignal.timeout(25_000),
        });
        if (!res.ok) throw new Error(`GA4 HTTP ${res.status}`);
        const p = parseGa4Organisch(await res.json());
        cur.traffic = p.cur.total;
        cur.trafficCh = p.cur.ch;
        prev.traffic = p.prev.total;
        prev.trafficCh = p.prev.ch;
        trafficQuelle = "ga4";
      } catch (e) {
        hinweise.push(`GA4: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`);
      }
    }
    if (token && trafficQuelle == null && kunde.gsc_property) {
      try {
        const basis = (z: Zeitraum, filter?: GscFilter) => ({
          site: String(kunde.gsc_property),
          accessToken: token,
          startDate: z.startDate,
          endDate: z.endDate,
          timeoutMs: 25_000,
          filter,
        });
        const ch: GscFilter = {
          dimensionFilterGroups: [
            { filters: [{ dimension: "country", operator: "equals", expression: "che" }] },
          ],
        };
        const [a, aCh, b, bCh] = await Promise.all([
          gscTotals(basis(aktuell)),
          gscTotals(basis(aktuell, ch)),
          gscTotals(basis(vorher)),
          gscTotals(basis(vorher, ch)),
        ]);
        cur.traffic = a.clicks;
        cur.trafficCh = aCh.clicks;
        prev.traffic = b.clicks;
        prev.trafficCh = bCh.clicks;
        trafficQuelle = "gsc";
      } catch (e) {
        hinweise.push(
          `Search Console: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`,
        );
      }
    }
  }

  const zeile: SeoOverviewZeile = {
    clientId: kunde.id,
    cur,
    prev,
    trafficQuelle,
    rankVergleich,
    rankVergleichGrund: rankVergleichGrundText,
    visibilityLand: vCur ? visibilityLand : null,
    stand: {
      cur: {
        rank: rCur ? String(rCur.created_at).slice(0, 10) : null,
        visibility: vCur ? String(vCur.created_at).slice(0, 10) : null,
      },
      prev: {
        rank: rankVergleich === "ok" && rPrev ? String(rPrev.created_at).slice(0, 10) : null,
        visibility:
          vPrev && vCur && vPrev.id !== vCur.id ? String(vPrev.created_at).slice(0, 10) : null,
      },
    },
    hinweise,
    error: null,
  };
  if (seoZeileSpeicherbar(zeile))
    await cacheSchreiben("seo", `${key}|${googleErlaubt ? 1 : 0}`, kunde.id, zeile);
  return zeile;
}
