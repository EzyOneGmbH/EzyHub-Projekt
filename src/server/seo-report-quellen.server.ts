// Datenquellen des SEO-Monatsreports (21.10.2026): DataForSEO (Labs, Backlinks),
// EzyHub-Keyword-Liste (rank_daily), Search Console und GA4 über die
// bestehende Google-Anbindung des Kunden. Alles ohne Sistrix.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ahrefsAuth, backlinkProvider, dfsAuth } from "./backlink-overview.server";
import { getGoogleAccessToken } from "./google-tokens.server";
import { isProviderEnabled } from "./integrations.server";
import { ga4RunReportUrl } from "./ga4.server";
import { gscRows, gscTotals } from "./gsc.server";
import type { GscZeile, RankZeile } from "@/lib/seoReport";

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const DFS_BASIS = "https://api.dataforseo.com/v3";
const TIMEOUT_MS = 20_000;
/** DFS-Statuscodes «keine Daten» — leer, kein Fehler. */
const DFS_LEER = new Set([40102]);

export type DfsAntwort =
  | { ok: true; items: any[]; cost: number }
  | { ok: false; leer: true; cost: number }
  | { ok: false; leer: false; error: string; cost: number };

/** Ein DataForSEO-Live-Task; Timeout 20 s, ein Retry bei Netz-/Serverfehler. */
export async function dfsTask(
  pfad: string,
  task: Record<string, unknown>,
  opts: { auth: string; fetcher?: Fetcher },
): Promise<DfsAntwort> {
  const f = opts.fetcher ?? fetch;
  let fehler = "";
  for (let versuch = 0; versuch < 2; versuch++) {
    try {
      const r = await f(`${DFS_BASIS}/${pfad}`, {
        method: "POST",
        headers: { Authorization: opts.auth, "Content-Type": "application/json" },
        body: JSON.stringify([task]),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const j: any = await r.json().catch(() => null);
      const t = j?.tasks?.[0];
      const cost = Number(t?.cost) || 0;
      if (t && Number(t.status_code) === 20000)
        return { ok: true, items: t.result?.[0]?.items ?? [], cost };
      if (t && DFS_LEER.has(Number(t.status_code))) return { ok: false, leer: true, cost };
      fehler = String(t?.status_message || j?.status_message || `HTTP ${r.status}`).slice(0, 160);
      if (r.status < 500 && t) break; // fachlicher Fehler: kein Retry
    } catch (e) {
      fehler = String((e as Error)?.message || e).slice(0, 160);
    }
  }
  return { ok: false, leer: false, error: fehler, cost: 0 };
}

export function dfsZugang(): string | null {
  return dfsAuth();
}

/** Ahrefs-Zugang wie das EzyRank-Modul; null bei BACKLINK_PROVIDER=dataforseo oder fehlendem Key. */
export function ahrefsZugang(): string | null {
  return backlinkProvider() === "ahrefs" ? ahrefsAuth() : null;
}

export type AhrefsAntwort =
  | { ok: true; rows: any[]; units: number }
  | { ok: false; error: string; units: number };

/**
 * Ahrefs refdomains-history, monatlich, mode=subdomains (wie das EzyRank-Modul).
 * Kosten laut Ahrefs: 6 Units je Zeile (13 Monate = 78 Units). Ein Retry bei 429/5xx.
 */
export async function ahrefsRefdomains(
  domain: string,
  von: string,
  bis: string,
  opts: { auth: string; fetcher?: Fetcher },
): Promise<AhrefsAntwort> {
  const f = opts.fetcher ?? fetch;
  const url = new URL("https://api.ahrefs.com/v3/site-explorer/refdomains-history");
  url.searchParams.set("target", domain);
  url.searchParams.set("date_from", von);
  url.searchParams.set("date_to", bis);
  url.searchParams.set("history_grouping", "monthly");
  url.searchParams.set("mode", "subdomains");
  let fehler = "";
  for (let versuch = 0; versuch < 2; versuch++) {
    try {
      const r = await f(url.toString(), {
        headers: { Authorization: opts.auth, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (r.ok) {
        const j: any = await r.json().catch(() => null);
        const rows = Array.isArray(j?.refdomains) ? j.refdomains : [];
        return { ok: true, rows, units: rows.length * 6 };
      }
      const t = await r.text().catch(() => "");
      fehler = `Ahrefs HTTP ${r.status}: ${t.replace(/Bearers+S+/gi, "Bearer ***").slice(0, 120)}`;
      if (r.status !== 429 && r.status < 500) break;
    } catch (e) {
      fehler = String((e as Error)?.message || e).slice(0, 160);
    }
  }
  return { ok: false, error: fehler, units: 0 };
}

/**
 * rank_daily-Zeilen eines Kunden im Zeitraum. Nur DFS-relevante Zeilen
 * (Crawl oder Vor-Hybrid-Zeit) plus die strategischen Keywords (für Volumen
 * ohne Ranking). Paginiert (PostgREST liefert max. 1000 Zeilen je Abfrage).
 */
export async function ladeRankZeilen(
  clientId: string,
  von: string,
  bis: string,
  keywords: string[] = [],
): Promise<RankZeile[]> {
  const sb = supabaseAdmin as any;
  const felder = "date, keyword, position, pos_src, method, url, search_volume, country, device";
  const alle: RankZeile[] = [];
  const seite = 1000;
  for (let ab = 0; ab < 50_000; ab += seite) {
    const { data, error } = await sb
      .from("rank_daily")
      .select(felder)
      .eq("client_id", clientId)
      .gte("date", von)
      .lte("date", bis)
      .not("position", "is", null)
      .or("pos_src.eq.crawl,and(pos_src.is.null,method.is.null)")
      .order("date")
      .order("keyword")
      .range(ab, ab + seite - 1);
    if (error) throw new Error(`rank_daily: ${error.message}`);
    alle.push(...(data ?? []));
    if (!data || data.length < seite) break;
  }
  if (keywords.length) {
    const { data } = await sb
      .from("rank_daily")
      .select(felder)
      .eq("client_id", clientId)
      .gte("date", von)
      .lte("date", bis)
      .in("keyword", keywords)
      .not("search_volume", "is", null)
      .order("date", { ascending: false })
      .limit(keywords.length * 3);
    for (const r of data ?? []) alle.push({ ...r, position: null });
  }
  return alle.map((r) => ({
    ...r,
    position: r.position == null ? null : Number(r.position),
    search_volume: r.search_volume == null ? null : Number(r.search_volume),
  }));
}

/** Alle rank_daily-Zeilen der Messtage (auch ohne Position) — Basis der Verteilung. */
export async function ladeRankTage(clientId: string, tage: string[]): Promise<RankZeile[]> {
  if (!tage.length) return [];
  const sb = supabaseAdmin as any;
  const alle: RankZeile[] = [];
  const seite = 1000;
  for (let ab = 0; ab < 50_000; ab += seite) {
    const { data, error } = await sb
      .from("rank_daily")
      .select("date, keyword, position, pos_src, method, url, search_volume, country, device")
      .eq("client_id", clientId)
      .in("date", tage)
      .order("date")
      .order("keyword")
      .range(ab, ab + seite - 1);
    if (error) throw new Error(`rank_daily: ${error.message}`);
    alle.push(...(data ?? []));
    if (!data || data.length < seite) break;
  }
  return alle.map((r) => ({ ...r, position: r.position == null ? null : Number(r.position) }));
}

export type GespeicherterLauf = { created_at: string; result: any };

/**
 * Jüngster gespeicherter Lauf eines Typs (audit_runs, succeeded), optional bis
 * zu einem Zeitpunkt — gleiche Auswahl wie useEzyLatestRun im Dashboard.
 */
export async function ladeGespeichertenLauf(
  clientId: string,
  auditType: "labs_history" | "ahrefs",
  bisIso?: string,
): Promise<GespeicherterLauf | null> {
  let q = (supabaseAdmin as any)
    .from("audit_runs")
    .select("created_at, result")
    .eq("client_id", clientId)
    .eq("audit_type", auditType)
    .eq("status", "succeeded");
  if (bisIso) q = q.lte("created_at", bisIso);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`audit_runs ${auditType}: ${error.message}`);
  return data ?? null;
}

/** Google-Zugriff des Kunden (GSC/GA4); null = nicht verbunden oder abgeschaltet. */
export async function googleToken(clientId: string): Promise<string | null> {
  if (!(await isProviderEnabled(clientId, "google"))) return null;
  try {
    return (await getGoogleAccessToken(clientId)).accessToken;
  } catch {
    return null;
  }
}

export type GscPeriode = {
  totals: { clicks: number; impressions: number; ctr: number; position: number };
  queries: GscZeile[];
  queriesGekappt: boolean;
};

/** GSC eines Zeitraums: Gesamttotale + Query-Zeilen (Web, alle Länder). */
export async function gscPeriode(
  site: string,
  token: string,
  von: string,
  bis: string,
): Promise<GscPeriode> {
  const basis = { site, accessToken: token, startDate: von, endDate: bis, timeoutMs: 25_000 };
  const [t, q] = await Promise.all([
    gscTotals(basis),
    gscRows({ ...basis, dimensions: ["query"], rowLimit: 25_000 }),
  ]);
  return {
    totals: { clicks: t.clicks, impressions: t.impressions, ctr: t.ctr, position: t.position },
    queries: q.rows as unknown as GscZeile[],
    queriesGekappt: q.coverage.truncated,
  };
}

export async function gscTopSeiten(
  site: string,
  token: string,
  von: string,
  bis: string,
  max = 10,
) {
  const { rows } = await gscRows({
    site,
    accessToken: token,
    startDate: von,
    endDate: bis,
    timeoutMs: 25_000,
    dimensions: ["page"],
    rowLimit: max,
  });
  return rows.map((r: any) => ({
    page: r.keys?.[0],
    clicks: Number(r.clicks) || 0,
    impressions: Number(r.impressions) || 0,
    ctr: Math.round((Number(r.ctr) || 0) * 10000) / 10000,
    position: Math.round((Number(r.position) || 0) * 10) / 10,
  }));
}

export type Ga4Werte = { sessions: number; engagement_rate: number | null; key_events: number };

/** GA4 organische Sitzungen, Engagement-Rate, Key Events für bis zu 4 Zeiträume. */
export async function ga4Organisch(
  property: string,
  token: string,
  zeitraeume: Array<{ startDate: string; endDate: string }>,
  fetcher: Fetcher = fetch,
): Promise<Ga4Werte[]> {
  const res = await fetcher(ga4RunReportUrl(property), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      dateRanges: zeitraeume,
      metrics: [{ name: "sessions" }, { name: "engagementRate" }, { name: "keyEvents" }],
      dimensionFilter: {
        filter: {
          fieldName: "sessionDefaultChannelGroup",
          stringFilter: { matchType: "EXACT", value: "Organic Search" },
        },
      },
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`GA4 HTTP ${res.status}`);
  return ga4WerteAus(await res.json(), zeitraeume.length);
}

/** GA4-Antwort → Werte je Zeitraum (bei mehreren Zeiträumen Dimension dateRange). */
export function ga4WerteAus(j: any, anzahl: number): Ga4Werte[] {
  const out: Ga4Werte[] = Array.from({ length: anzahl }, () => ({
    sessions: 0,
    engagement_rate: null,
    key_events: 0,
  }));
  for (const row of j?.rows ?? []) {
    const dr = String(row?.dimensionValues?.[0]?.value ?? "date_range_0");
    const i = anzahl > 1 ? Number(dr.replace(/\D/g, "")) || 0 : 0;
    if (!out[i]) continue;
    const m = row?.metricValues ?? [];
    out[i] = {
      sessions: Number(m[0]?.value) || 0,
      engagement_rate: m[1]?.value != null ? Math.round(Number(m[1].value) * 10000) / 10000 : null,
      key_events: Number(m[2]?.value) || 0,
    };
  }
  return out;
}
