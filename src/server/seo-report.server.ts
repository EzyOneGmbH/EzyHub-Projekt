// SEO-Monatsreport für n8n «SEO Monatspräsentation» (21.10.2026). Grundsatz
// (22.10.2026): jeder Wert aus EzyHub, gleiche Quelle wie das Dashboard; live
// nur als Rückweg, wenn EzyHub für den Monat nichts gespeichert hat (source +
// checks-Warnung). Kein Sistrix.
//   rankings.keywords      rank_daily, nur DataForSEO-Messtage (+ GSC je Keyword)
//   rankings.distribution  rank_daily, Crawl-Positionen am letzten Messtag
//   visibility (ETV)       gespeicherter labs_history-Lauf des agent-service
//                          (Rückweg: DataForSEO Labs live)
//   backlinks              gespeicherte EzyRank-Läufe (audit_runs 'ahrefs')
//                          (Rückweg: Ahrefs bzw. DataForSEO live)
//   gsc / ga4              gleiche Funktionen wie das Dashboard (gscTotals,
//                          GA4 «Organic Search») über die Google-Anbindung
// Konfiguration: clients + seo_report_config. Jeder Abruf wird als Monats-
// Snapshot in seo_report_snapshots gespeichert; der zweite Aufruf kostet nichts.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizeDomain } from "./backlink-overview.server";
import {
  ahrefsMonateAus,
  backlinkStandAus,
  dfsBacklinkMonateAus,
  labsMonateAusGespeichert,
  refdomainsIm,
  refdomainsVerlaufAus,
  refdomainsZumMonatsende,
  verteilungAusRankDaily,
  type BacklinkMonat,
  type LabsMonat,
  berechneChecks,
  berechneKeywords,
  berechneSichtbarkeit,
  brandErkenner,
  brandRegexFuer,
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
  ladeGespeichertenLauf,
  ladeRankTage,
  ladeRankZeilen,
  type GespeicherterLauf,
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
    brand_regex: brandRegexFuer(c, k),
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
  /** alle rank_daily-Zeilen der Messtage (Verteilung) */
  rankTage: (tage: string[]) => Promise<RankZeile[]>;
  /** jüngster gespeicherter labs_history-Lauf */
  labsGespeichert: () => Promise<GespeicherterLauf | null>;
  /** jüngster gespeicherter EzyRank-Backlink-Lauf bis zum Zeitpunkt */
  backlinkLauf: (bisIso: string) => Promise<GespeicherterLauf | null>;
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
    rankTage: (tage) => ladeRankTage(k.id, tage),
    labsGespeichert: () => ladeGespeichertenLauf(k.id, "labs_history"),
    backlinkLauf: (bisIso) => ladeGespeichertenLauf(k.id, "ahrefs", bisIso),
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

/** Tagesende in Zürich als ISO-Zeitpunkt (Sommerzeit Ende März bis Ende Oktober). */
export function tagesendeZuerich(ymd: string): string {
  const m = Number(ymd.slice(5, 7));
  return `${ymd}T23:59:59.999${m >= 3 && m <= 9 ? "+02:00" : "+01:00"}`;
}

type BacklinkWert = {
  wert: number | null;
  quelle: "ezyhub" | "ahrefs_live" | "dataforseo_live" | null;
  lauf: GespeicherterLauf | null;
};

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

  const liveRueckwege: Array<{ field: string; quelle: string; monat: string }> = [];
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

  // ── Sichtbarkeit (ETV): gespeicherter labs_history-Lauf, live nur als Rückweg
  const sichtbarkeitLaden = async (): Promise<{
    labs: LabsMonat[] | null;
    quelle: "ezyhub" | "dataforseo_live" | null;
    stand: string | null;
  }> => {
    let gespeichert: LabsMonat[] | null = null;
    let stand: string | null = null;
    try {
      const lauf = await q.labsGespeichert();
      if (lauf) {
        gespeichert = labsMonateAusGespeichert(lauf.result?.months);
        stand = String(lauf.created_at).slice(0, 10);
      }
    } catch (e) {
      fehler("labs_history", e);
    }
    if (gespeichert?.some((m) => m.month === monat))
      return { labs: gespeichert, quelle: "ezyhub", stand };
    const items = await dfs(
      "dataforseo.labs",
      "dataforseo_labs/google/historical_rank_overview/live",
      {
        target: k.domain,
        location_code: k.dfs_location_code,
        language_code: k.dfs_language_code,
        date_from: `${vj}-01`,
        date_to: kleinerDatum(ende, heute),
      },
    );
    if (items) {
      liveRueckwege.push({ field: "visibility", quelle: "DataForSEO Labs", monat });
      return { labs: labsMonateAus(items), quelle: "dataforseo_live", stand: heute };
    }
    return { labs: gespeichert, quelle: gespeichert ? "ezyhub" : null, stand };
  };

  // ── Backlinks: gespeicherte EzyRank-Läufe, live nur für fehlende Monate ────
  // Ahrefs kennt kein «heute» (bad date) -> spätestens gestern
  const blBis = kleinerDatum(ende, minusTage(heute, 1));
  const backlinksLaden = async () => {
    const laufBis = async (m: string) => {
      try {
        return await q.backlinkLauf(tagesendeZuerich(monatsEnde(m)));
      } catch (e) {
        fehler("ezyrank_backlinks", e);
        return null;
      }
    };
    // Läufe zum Ende von Monat, Vormonat, Vorjahresmonat (Dashboard-Auswahl)
    const [laufCur, laufPrev, laufPy] = await Promise.all([
      laufBis(monat),
      laufBis(vm),
      laufBis(vj),
    ]);
    const laeufe = { current: laufCur, previous: laufPrev, previous_year: laufPy };
    const laufVon: Record<string, GespeicherterLauf | null> = {
      [monat]: laufCur,
      [vm]: laufPrev,
      [vj]: laufPy,
    };
    const ausLauf = async (m: string): Promise<BacklinkWert> => {
      for (const lauf of [laufCur, m === monat ? null : laufVon[m]]) {
        if (!lauf) continue;
        const wert = refdomainsZumMonatsende(refdomainsVerlaufAus(lauf.result), m);
        if (wert != null) return { wert, quelle: "ezyhub", lauf };
      }
      return { wert: null, quelle: null, lauf: null };
    };
    const werte: Record<"current" | "previous" | "previous_year", BacklinkWert> = {
      current: await ausLauf(monat),
      previous: await ausLauf(vm),
      previous_year: await ausLauf(vj),
    };
    const monatVon = { current: monat, previous: vm, previous_year: vj };
    const fehlend = (Object.keys(werte) as Array<keyof typeof werte>).filter(
      (p) => werte[p].wert == null,
    );
    if (fehlend.length) {
      const monate = fehlend.map((p) => monatVon[p]).sort();
      const von = `${monate[0]}-01`;
      const letzter = monate[monate.length - 1];
      let reihe: BacklinkMonat[] | null = null;
      let quelle: "ahrefs_live" | "dataforseo_live" = "ahrefs_live";
      if (q.ahrefs) {
        const a = await q.ahrefs(von, kleinerDatum(monatsEnde(letzter), blBis));
        ahrefsUnits += a.units;
        if (a.ok) reihe = ahrefsMonateAus(a.rows);
        else errors.push({ source: "ahrefs", message: a.error });
      }
      if (!reihe) {
        quelle = "dataforseo_live";
        const items = await dfs("dataforseo.backlinks", "backlinks/timeseries_summary/live", {
          target: k.domain,
          date_from: von,
          date_to: kleinerDatum(monatsEnde(letzter), heute),
          group_range: "month",
        });
        reihe = items ? dfsBacklinkMonateAus(items) : null;
      }
      for (const p of fehlend) {
        const wert = refdomainsIm(reihe, monatVon[p]);
        if (wert == null) continue;
        werte[p] = { wert, quelle, lauf: null };
        liveRueckwege.push({
          field: `backlinks.referring_domains.${p}`,
          quelle: quelle === "ahrefs_live" ? "Ahrefs" : "DataForSEO",
          monat: monatVon[p],
        });
      }
    }
    return { ...werte, laeufe };
  };

  const [sicht, bl] = await Promise.all([sichtbarkeitLaden(), backlinksLaden()]);
  const labs = sicht.labs;
  const visibility = berechneSichtbarkeit(labs, monat);
  const rdCur = bl.current.wert;
  const rdPrev = bl.previous.wert;
  const rdPy = bl.previous_year.wert;

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
  let tagesZeilen: RankZeile[] = [];
  const messtage = [tagCur, tagPrev].filter((t): t is string => !!t);
  if (messtage.length) {
    try {
      tagesZeilen = await q.rankTage(messtage);
    } catch (e) {
      fehler("rank_daily", e);
    }
  }
  const distribution = {
    current: verteilungAusRankDaily(tagesZeilen, tagCur),
    previous: verteilungAusRankDaily(tagesZeilen, tagPrev),
  };
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
    liveRueckwege,
  });
  const quellenBl = [bl.current.quelle, bl.previous.quelle, bl.previous_year.quelle].filter(
    (x) => x != null,
  );
  // Stand der EzyRank-Kacheln (Domain Rating, Backlinks) zum Monatsende — der
  // Lauf, den das Dashboard für einen Zeitraum mit diesem Ende zeigt.
  const standAus = (lauf: GespeicherterLauf | null) =>
    lauf
      ? { run_date: String(lauf.created_at).slice(0, 10), ...backlinkStandAus(lauf.result) }
      : null;
  const ezyrank = {
    current: standAus(bl.laeufe.current),
    previous: standAus(bl.laeufe.previous),
    previous_year: standAus(bl.laeufe.previous_year),
  };
  const differenz = (a: number | null, b: number | null) =>
    a != null && b != null ? Math.round((a - b) * 10) / 10 : null;
  const drVergleichbar = (a: any, b: any) => a?.provider === "ahrefs" && b?.provider === "ahrefs";

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
    visibility: visibility ? { source: sicht.quelle, data_date: sicht.stand, ...visibility } : null,
    rankings: {
      source: "ezyhub",
      previous_source: vorherQuelle,
      selection: k.strategic_keywords.length ? "strategic_keywords" : "top_search_volume",
      keywords,
      distribution: {
        source: "rank_daily",
        basis: "crawl",
        data_dates: { current: tagCur, previous: tagPrev },
        ...distribution,
      },
    },
    backlinks: {
      source: !quellenBl.length
        ? null
        : quellenBl.every((x) => x === "ezyhub")
          ? "ezyhub"
          : quellenBl.some((x) => x === "ezyhub")
            ? "ezyhub_with_live_fallback"
            : "live",
      sources: {
        current: bl.current.quelle,
        previous: bl.previous.quelle,
        previous_year: bl.previous_year.quelle,
      },
      /** Stand des EzyRank-Laufs zum Monatsende (Kacheln Domain Rating / Backlinks) */
      ezyrank: {
        ...ezyrank,
        change: {
          domain_rating: drVergleichbar(ezyrank.current, ezyrank.previous)
            ? differenz(ezyrank.current!.domain_rating, ezyrank.previous!.domain_rating)
            : null,
          backlinks_live_pct: drVergleichbar(ezyrank.current, ezyrank.previous)
            ? veraenderung(ezyrank.current!.backlinks_live, ezyrank.previous!.backlinks_live)
            : null,
          backlinks_live_pct_yoy: drVergleichbar(ezyrank.current, ezyrank.previous_year)
            ? veraenderung(ezyrank.current!.backlinks_live, ezyrank.previous_year!.backlinks_live)
            : null,
        },
      },
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
