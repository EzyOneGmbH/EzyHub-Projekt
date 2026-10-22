// Datenquellen des SEO-Monatsreports (21.10.2026, seit 22.10.2026 ohne Live-
// Abfragen bei DataForSEO/Ahrefs): EzyHub-Keyword-Liste (rank_daily),
// gespeicherte Läufe (audit_runs), Search Console und GA4 über die bestehende
// Google-Anbindung des Kunden. Alles ohne Sistrix.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "./google-tokens.server";
import { isProviderEnabled } from "./integrations.server";
import { ga4RunReportUrl } from "./ga4.server";
import { gscRows, gscTotals } from "./gsc.server";
import type { GscZeile, RankZeile } from "@/lib/seoReport";

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

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

export type Ga4KeyEvent = { event: string; count: number };
export type Ga4Werte = {
  sessions: number;
  engagement_rate: number | null;
  key_events: number;
  /** Key Events je Event-Name (absteigend); null = Abfrage fehlgeschlagen */
  key_events_by_event?: Ga4KeyEvent[] | null;
};

const ORGANIC_FILTER = {
  filter: {
    fieldName: "sessionDefaultChannelGroup",
    stringFilter: { matchType: "EXACT", value: "Organic Search" },
  },
};

/**
 * GA4 «Organic Search» für bis zu 4 Zeiträume: Sitzungen, Engagement-Rate,
 * Key Events und Key Events je Event-Name (Kennzahl keyEvents, gleicher
 * Kanalfilter — die Summe je Event ergibt key_events).
 */
export async function ga4Organisch(
  property: string,
  token: string,
  zeitraeume: Array<{ startDate: string; endDate: string }>,
  fetcher: Fetcher = fetch,
): Promise<Ga4Werte[]> {
  const abfrage = (body: Record<string, unknown>) =>
    fetcher(ga4RunReportUrl(property), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ dateRanges: zeitraeume, dimensionFilter: ORGANIC_FILTER, ...body }),
      signal: AbortSignal.timeout(25_000),
    });
  const [res, resEv] = await Promise.all([
    abfrage({
      metrics: [{ name: "sessions" }, { name: "engagementRate" }, { name: "keyEvents" }],
    }),
    abfrage({
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "keyEvents" }],
      orderBys: [{ metric: { metricName: "keyEvents" }, desc: true }],
      limit: 1000,
    }).catch(() => null),
  ]);
  if (!res.ok) throw new Error(`GA4 HTTP ${res.status}`);
  const werte = ga4WerteAus(await res.json(), zeitraeume.length);
  const jeEvent = resEv?.ok
    ? ga4KeyEventsAus(await resEv.json().catch(() => null), zeitraeume.length)
    : null;
  return werte.map((w, i) => ({ ...w, key_events_by_event: jeEvent ? jeEvent[i] : null }));
}

/**
 * GA4-Antwort (Dimension eventName, Kennzahl keyEvents) → Key Events je Event
 * und Zeitraum, absteigend, nur Events mit mindestens einem Key Event.
 */
export function ga4KeyEventsAus(j: any, anzahl: number): Ga4KeyEvent[][] | null {
  if (!j || typeof j !== "object") return null;
  const kopf: string[] = (j.dimensionHeaders ?? []).map((h: any) => String(h?.name ?? ""));
  const iEvent = Math.max(0, kopf.indexOf("eventName"));
  const iRange = kopf.indexOf("dateRange");
  const out: Ga4KeyEvent[][] = Array.from({ length: anzahl }, () => []);
  for (const row of j.rows ?? []) {
    const dv = row?.dimensionValues ?? [];
    const i =
      anzahl > 1 && iRange >= 0
        ? Number(String(dv[iRange]?.value ?? "").replace(/\D/g, "")) || 0
        : 0;
    const count = Number(row?.metricValues?.[0]?.value) || 0;
    const event = String(dv[iEvent]?.value ?? "");
    if (!out[i] || !event || count <= 0) continue;
    out[i].push({ event, count });
  }
  for (const liste of out)
    liste.sort((a, b) => b.count - a.count || a.event.localeCompare(b.event));
  return out;
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
