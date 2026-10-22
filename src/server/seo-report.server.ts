// SEO-Monatsreport für n8n «SEO Monatspräsentation» (21.10.2026). Alle Daten aus
// EzyHub bzw. den EzyHub-Integrationen — kein Sistrix:
//   rankings.keywords      EzyHub-Keyword-Liste (rank_daily, nur DataForSEO-Messtage)
//                          + GSC-Klicks/-Impressionen je Keyword
//   rankings.distribution  DataForSEO Labs historical_rank_overview
//   visibility (ETV)       DataForSEO Labs historical_rank_overview
//   backlinks              Ahrefs refdomains-history (wie EzyRank-Modul),
//                          DataForSEO timeseries_summary als Rückweg
//   gsc / ga4              Live über die Google-Anbindung des Kunden
// Konfiguration: clients + seo_report_config. Jeder Abruf wird als Monats-
// Snapshot in seo_report_snapshots gespeichert; der zweite Aufruf kostet nichts.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizeDomain } from "./backlink-overview.server";
import {
  ahrefsMonateAus,
  dfsBacklinkMonateAus,
  refdomainsIm,
  type BacklinkMonat,
  berechneChecks,
  berechneKeywords,
  berechneSichtbarkeit,
  brandErkenner,
  brandRegexAusBegriffen,
  brandSplit,
  brandTopQueries,
  chancenKeywords,
  gscJeQuery,
  labsMonateAus,
  letzterMesstag,
  monatPlus,
  monatsEnde,
  positionenAm,
  positionenAusSnapshot,
  veraenderung,
  verteilungAus,
  volumenJeKeyword,
  type GscKennzahlen,
  type RankZeile,
} from "@/lib/seoReport";
import {
  ahrefsRefdomains,
  ahrefsZugang,
  type AhrefsAntwort,
  dfsTask,
  dfsZugang,
  ga4Organisch,
  googleToken,
  gscPeriode,
  gscTopSeiten,
  ladeRankZeilen,
  type DfsAntwort,
  type Ga4Werte,
  type GscPeriode,
} from "./seo-report-quellen.server";

/** GSC-Daten sind erst nach ~3 Tagen vollständig. */
const GSC_VERZUG_TAGE = 3;

export type SeoKonfig = {
  id: string;
  name: string;
  domain: string;
  dfs_location_code: number;
  dfs_language_code: string;
  strategic_keywords: string[];
  brand_regex: string | null;
  gsc_property: string | null;
  ga4_property_id: string | null;
  awork_project_id: string | null;
  website: string | null;
  report_active: boolean;
};

const KONFIG_FELDER =
  "client_id, report_active, strategic_keywords, brand_regex, awork_project_id, website, dfs_location_code, dfs_language_code";
const KUNDEN_FELDER = "id, name, domain, gsc_property, ga4_property, metadata, brand_terms";

export function baueKonfig(c: any, k: any | null): SeoKonfig {
  const domain = normalizeDomain(String(c.domain ?? "")).toLowerCase();
  const strategic = Array.isArray(k?.strategic_keywords)
    ? k.strategic_keywords.map((s: unknown) => String(s).trim()).filter(Boolean)
    : [];
  return {
    id: String(c.id),
    name: String(c.name ?? ""),
    domain,
    dfs_location_code: Number(k?.dfs_location_code) || 2756,
    dfs_language_code: String(k?.dfs_language_code || "de"),
    strategic_keywords: strategic,
    brand_regex: k?.brand_regex?.trim() || brandRegexAusBegriffen(c.brand_terms),
    gsc_property: c.gsc_property || null,
    ga4_property_id: c.ga4_property ? String(c.ga4_property).replace(/^properties\//, "") : null,
    awork_project_id: k?.awork_project_id ?? null,
    website: k?.website?.trim() || (domain ? `https://${domain.split("/")[0]}` : null),
    report_active: k?.report_active === true,
  };
}

/** Aktive EzyRank-Kunden mit eingeschaltetem Report. */
export async function ladeSeoKunden(): Promise<SeoKonfig[]> {
  const sb = supabaseAdmin as any;
  const { data: konfig, error } = await sb
    .from("seo_report_config")
    .select(KONFIG_FELDER)
    .eq("report_active", true);
  if (error) throw new Error(error.message);
  const ids = (konfig ?? []).map((k: any) => k.client_id);
  if (!ids.length) return [];
  const [{ data: kunden }, { data: zugriff }] = await Promise.all([
    sb.from("clients").select(KUNDEN_FELDER).in("id", ids),
    sb
      .from("client_app_access")
      .select("client_id")
      .eq("app", "seo")
      .eq("enabled", true)
      .in("client_id", ids),
  ]);
  const mitSeo = new Set((zugriff ?? []).map((z: any) => z.client_id));
  const kMap = new Map((konfig ?? []).map((k: any) => [k.client_id, k]));
  return (kunden ?? [])
    .filter((c: any) => mitSeo.has(c.id) && (c.metadata ?? {})?.status !== "paused")
    .map((c: any) => baueKonfig(c, kMap.get(c.id)))
    .sort((a: SeoKonfig, b: SeoKonfig) => a.name.localeCompare(b.name));
}

/** Einzelner Kunde per Client-ID oder awork-Projekt-ID; null = unbekannt / ohne EzyRank. */
export async function ladeSeoKunde(by: {
  client?: string;
  awork?: string;
}): Promise<SeoKonfig | null> {
  const sb = supabaseAdmin as any;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let clientId = by.client?.trim() || "";
  let k: any = null;
  if (!clientId && by.awork) {
    if (!uuid.test(by.awork.trim())) return null;
    const { data } = await sb
      .from("seo_report_config")
      .select(KONFIG_FELDER)
      .eq("awork_project_id", by.awork.trim())
      .maybeSingle();
    if (!data) return null;
    k = data;
    clientId = data.client_id;
  }
  if (!uuid.test(clientId)) return null;
  const [{ data: c }, { data: z }, konf] = await Promise.all([
    sb.from("clients").select(KUNDEN_FELDER).eq("id", clientId).maybeSingle(),
    sb
      .from("client_app_access")
      .select("client_id")
      .eq("client_id", clientId)
      .eq("app", "seo")
      .eq("enabled", true)
      .maybeSingle(),
    k
      ? Promise.resolve({ data: k })
      : sb.from("seo_report_config").select(KONFIG_FELDER).eq("client_id", clientId).maybeSingle(),
  ]);
  if (!c || !z) return null;
  return baueKonfig(c, konf?.data ?? null);
}

export async function ladeSnapshot(clientId: string, monat: string): Promise<any | null> {
  const { data } = await (supabaseAdmin as any)
    .from("seo_report_snapshots")
    .select("payload")
    .eq("client_id", clientId)
    .eq("month", monat)
    .maybeSingle();
  return data?.payload ?? null;
}

export async function speichereSnapshot(clientId: string, monat: string, payload: any) {
  const { error } = await (supabaseAdmin as any).from("seo_report_snapshots").upsert(
    {
      client_id: clientId,
      month: monat,
      payload,
      dataforseo_cost: payload?.meta?.dataforseo_cost ?? 0,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_id,month" },
  );
  if (error) throw new Error(error.message);
}

// ── Quellen (für Tests austauschbar) ─────────────────────────────────────────
export type Quellen = {
  dfs: ((pfad: string, task: Record<string, unknown>) => Promise<DfsAntwort>) | null;
  ahrefs: ((von: string, bis: string) => Promise<AhrefsAntwort>) | null;
  rankZeilen: (von: string, bis: string, keywords: string[]) => Promise<RankZeile[]>;
  googleToken: () => Promise<string | null>;
  gscPeriode: (token: string, von: string, bis: string) => Promise<GscPeriode>;
  gscTopSeiten: (token: string, von: string, bis: string) => Promise<any[]>;
  ga4: (
    token: string,
    zeitraeume: Array<{ startDate: string; endDate: string }>,
  ) => Promise<Ga4Werte[]>;
  snapshotVormonat: () => Promise<any | null>;
};

export function echteQuellen(k: SeoKonfig, monat: string): Quellen {
  const auth = dfsZugang();
  const ahrefs = ahrefsZugang();
  return {
    dfs: auth ? (pfad, task) => dfsTask(pfad, task, { auth }) : null,
    ahrefs: ahrefs ? (von, bis) => ahrefsRefdomains(k.domain, von, bis, { auth: ahrefs }) : null,
    rankZeilen: (von, bis, kws) => ladeRankZeilen(k.id, von, bis, kws),
    googleToken: () => googleToken(k.id),
    gscPeriode: (t, von, bis) => gscPeriode(String(k.gsc_property), t, von, bis),
    gscTopSeiten: (t, von, bis) => gscTopSeiten(String(k.gsc_property), t, von, bis),
    ga4: (t, z) => ga4Organisch(String(k.ga4_property_id), t, z),
    snapshotVormonat: () => ladeSnapshot(k.id, monatPlus(monat, -1)),
  };
}

const kleinerDatum = (a: string, b: string) => (a < b ? a : b);
const minusTage = (ymd: string, n: number) =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) - n * 864e5).toISOString().slice(0, 10);

type GscBlock = GscKennzahlen & { brand: GscKennzahlen; nonbrand: GscKennzahlen };

/** Report berechnen. `heute` = Schweizer Datum (YYYY-MM-DD). */
export async function berechneSeoReport(
  k: SeoKonfig,
  monat: string,
  q: Quellen,
  opts: { jetzt?: Date; heute: string },
) {
  const jetzt = opts.jetzt ?? new Date();
  const heute = opts.heute;
  const errors: Array<{ source: string; message: string }> = [];
  let kosten = 0;
  let ahrefsUnits = 0;
  const fehler = (source: string, e: unknown) =>
    errors.push({ source, message: String((e as Error)?.message || e).slice(0, 160) });

  const vm = monatPlus(monat, -1);
  const vj = monatPlus(monat, -12);
  const ende = monatsEnde(monat);
  const istBrand = brandErkenner(k.brand_regex);

  // ── DataForSEO Labs (ETV + Verteilung) und Backlinks (Ahrefs), parallel ─────
  const dfs = async (quelle: string, pfad: string, task: Record<string, unknown>) => {
    if (!q.dfs) {
      errors.push({ source: quelle, message: "DATAFORSEO_LOGIN/PASSWORD fehlt" });
      return null;
    }
    const r = await q.dfs(pfad, task);
    kosten += r.cost;
    if (r.ok) return r.items;
    if (r.leer) return [];
    errors.push({ source: quelle, message: r.error });
    return null;
  };
  // Ahrefs kennt kein «heute» (bad date) -> spätestens gestern
  const blBis = kleinerDatum(ende, minusTage(heute, 1));
  const backlinksLaden = async (): Promise<{
    quelle: "ahrefs" | "dataforseo";
    reihe: BacklinkMonat[] | null;
  }> => {
    if (q.ahrefs) {
      const a = await q.ahrefs(`${vj}-01`, blBis);
      ahrefsUnits += a.units;
      if (a.ok) return { quelle: "ahrefs", reihe: ahrefsMonateAus(a.rows) };
      errors.push({ source: "ahrefs", message: a.error });
    }
    const items = await dfs("dataforseo.backlinks", "backlinks/timeseries_summary/live", {
      target: k.domain,
      date_from: `${vj}-01`,
      date_to: kleinerDatum(ende, heute),
      group_range: "month",
    });
    return { quelle: "dataforseo", reihe: items ? dfsBacklinkMonateAus(items) : null };
  };
  const [labsItems, bl] = await Promise.all([
    dfs("dataforseo.labs", "dataforseo_labs/google/historical_rank_overview/live", {
      target: k.domain,
      location_code: k.dfs_location_code,
      language_code: k.dfs_language_code,
      date_from: `${vj}-01`,
      date_to: kleinerDatum(ende, heute),
    }),
    backlinksLaden(),
  ]);
  const labs = labsItems ? labsMonateAus(labsItems) : null;
  const visibility = berechneSichtbarkeit(labs, monat);
  const distribution = {
    current: labs ? verteilungAus(labs.find((m) => m.month === monat)) : null,
    previous: labs ? verteilungAus(labs.find((m) => m.month === vm)) : null,
  };
  const rdCur = refdomainsIm(bl.reihe, monat);
  const rdPrev = refdomainsIm(bl.reihe, vm);
  const rdPy = refdomainsIm(bl.reihe, vj);

  // ── Google: Token einmal, dann GSC (3 Zeiträume + Top-Seiten) und GA4 ───────
  const token = k.gsc_property || k.ga4_property_id ? await q.googleToken() : null;
  const gscEnde = kleinerDatum(ende, minusTage(heute, GSC_VERZUG_TAGE));
  const zeitraeume = {
    current: { startDate: `${monat}-01`, endDate: gscEnde },
    previous: { startDate: `${vm}-01`, endDate: monatsEnde(vm) },
    previous_year: { startDate: `${vj}-01`, endDate: monatsEnde(vj) },
  };
  let gsc: any = null;
  let gscCur: GscPeriode | null = null;
  if (k.gsc_property && !token) errors.push({ source: "gsc", message: "Google nicht verbunden" });
  if (k.gsc_property && token) {
    try {
      const [c, p, y, seiten] = await Promise.all([
        q.gscPeriode(token, zeitraeume.current.startDate, zeitraeume.current.endDate),
        q.gscPeriode(token, zeitraeume.previous.startDate, zeitraeume.previous.endDate),
        q.gscPeriode(token, zeitraeume.previous_year.startDate, zeitraeume.previous_year.endDate),
        q.gscTopSeiten(token, zeitraeume.current.startDate, zeitraeume.current.endDate),
      ]);
      gscCur = c;
      const block = (x: GscPeriode): GscBlock => ({
        clicks: x.totals.clicks,
        impressions: x.totals.impressions,
        ctr: x.totals.impressions > 0 ? Math.round(x.totals.ctr * 10000) / 10000 : null,
        position: x.totals.impressions > 0 ? Math.round(x.totals.position * 10) / 10 : null,
        ...brandSplit(x.queries, istBrand),
      });
      const b = { current: block(c), previous: block(p), previous_year: block(y) };
      gsc = {
        property: k.gsc_property,
        ranges: zeitraeume,
        partial: gscEnde < ende,
        ...b,
        change: {
          clicks_mom: veraenderung(b.current.clicks, b.previous.clicks),
          clicks_yoy: veraenderung(b.current.clicks, b.previous_year.clicks),
          impressions_mom: veraenderung(b.current.impressions, b.previous.impressions),
          impressions_yoy: veraenderung(b.current.impressions, b.previous_year.impressions),
        },
        top_pages: seiten,
        opportunity_keywords: chancenKeywords(c.queries),
        /** Kontrolle der Brand-Regex: grösste Brand-Queries im Berichtsmonat */
        brand_top_queries: brandTopQueries(c.queries, istBrand),
        /** Brand/Non-Brand = Summe der gelisteten Queries (ohne anonymisierte) */
        brand_basis: "queries",
      };
    } catch (e) {
      fehler("gsc", e);
    }
  }

  let ga4: any = undefined; // Feld fehlt, wenn GA4 nicht angebunden ist
  if (k.ga4_property_id && token) {
    try {
      const [c, p, y] = await q.ga4(token, [
        { startDate: `${monat}-01`, endDate: kleinerDatum(ende, minusTage(heute, 1)) },
        zeitraeume.previous,
        zeitraeume.previous_year,
      ]);
      ga4 = {
        property_id: k.ga4_property_id,
        channel: "Organic Search",
        current: c,
        previous: p,
        previous_year: y,
        change: {
          sessions_mom: veraenderung(c.sessions, p.sessions),
          sessions_yoy: veraenderung(c.sessions, y.sessions),
          key_events_mom: veraenderung(c.key_events, p.key_events),
        },
      };
    } catch (e) {
      fehler("ga4", e);
      ga4 = null;
    }
  }

  // ── Keyword-Liste (rank_daily) ─────────────────────────────────────────────
  let rankZeilen: RankZeile[] = [];
  try {
    rankZeilen = await q.rankZeilen(
      `${vm}-01`,
      ende,
      k.strategic_keywords.map((s) => s.toLowerCase()),
    );
  } catch (e) {
    fehler("rank_daily", e);
  }
  const tagCur = letzterMesstag(rankZeilen, monat);
  const tagPrev = letzterMesstag(rankZeilen, vm);
  let vorher = tagPrev ? positionenAm(rankZeilen, tagPrev) : null;
  let vorherQuelle: "rank_daily" | "snapshot" | null = tagPrev ? "rank_daily" : null;
  if (!vorher) {
    vorher = positionenAusSnapshot(await q.snapshotVormonat().catch(() => null));
    if (vorher) vorherQuelle = "snapshot";
  }
  const keywords = tagCur
    ? berechneKeywords({
        aktuell: positionenAm(rankZeilen, tagCur),
        vorher,
        volumen: volumenJeKeyword(rankZeilen),
        gsc: gscCur ? gscJeQuery(gscCur.queries) : null,
        istBrand,
        fest: k.strategic_keywords,
      })
    : null;

  const checks = berechneChecks({
    monat,
    visibility,
    labsMonatFehlt: !!labs && !labs.some((m) => m.month === monat),
    rankTag: tagCur,
    keywords,
    konfigFehlt: !k.strategic_keywords.length,
    refdomains: { current: rdCur, previous: rdPrev },
  });

  return {
    client: {
      id: k.id,
      name: k.name,
      domain: k.domain,
      brand_regex: k.brand_regex,
      awork_project_id: k.awork_project_id,
      gsc_property: k.gsc_property,
      ga4_property_id: k.ga4_property_id,
      dataforseo: { location_code: k.dfs_location_code, language_code: k.dfs_language_code },
    },
    period: {
      month: monat,
      previous_month: vm,
      previous_year_month: vj,
      data_dates: { rankings_current: tagCur, rankings_previous: tagPrev },
    },
    visibility,
    rankings: {
      source: "ezyhub",
      previous_source: vorherQuelle,
      selection: k.strategic_keywords.length ? "strategic_keywords" : "top_search_volume",
      keywords,
      distribution: { source: "dataforseo_labs", ...distribution },
    },
    backlinks: {
      source: bl.quelle,
      referring_domains: {
        current: rdCur,
        previous: rdPrev,
        previous_year: rdPy,
        change: rdCur != null && rdPrev != null ? rdCur - rdPrev : null,
        change_pct: veraenderung(rdCur, rdPrev),
        change_pct_yoy: veraenderung(rdCur, rdPy),
      },
    },
    gsc,
    ...(ga4 !== undefined ? { ga4 } : {}),
    checks,
    meta: {
      generated_at: jetzt.toISOString(),
      cached: false,
      dataforseo_cost: Math.round(kosten * 10000) / 10000,
      ahrefs_units: ahrefsUnits,
      errors,
    },
  };
}
