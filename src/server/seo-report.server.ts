// SEO-Monatsreport für n8n «SEO Monatspräsentation» (21.10.2026). Grundsatz
// (22.10.2026): jeder Wert aus EzyHub, gleiche Quelle wie das Dashboard. Kein Sistrix.
//   rankings.keywords      rank_daily, nur DataForSEO-Messtage (+ GSC je Keyword)
//   rankings.distribution  rank_daily, Crawl-Positionen am letzten Messtag
//   visibility (ETV)       gespeicherter labs_history-Lauf des agent-service
//   backlinks              gespeicherte EzyRank-Läufe (audit_runs 'ahrefs')
// Keine Live-Abfragen bei DataForSEO oder Ahrefs (22.10.2026): fehlt ein Wert
// in EzyHub, bleibt er null (checks-Hinweis).
//   gsc / ga4              gleiche Funktionen wie das Dashboard (gscTotals,
//                          GA4 «Organic Search») über die Google-Anbindung
// Konfiguration: clients + seo_report_config. Zeitraum: Monat (month) oder frei
// (from/to, 22.10.2026) mit gleich langer Vorperiode und Vorjahreszeitraum.
// Snapshots (seo_report_snapshots) nur für vollständige Monate; unvollständige
// Zeiträume → meta.partial = true, kein Snapshot.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizeDomain } from "./backlink-overview.server";
import {
  backlinkStandAus,
  labsMonateAusGespeichert,
  refdomainsVerlaufAus,
  verteilungAusRankDaily,
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
  letzterMesstag,
  letzterMesstagIm,
  monatPlus,
  periodenFuerMonat,
  refdomainsImZeitraum,
  zeitraumText,
  type Perioden,
  type Zeitraum,
  positionenAm,
  positionenAusSnapshot,
  veraenderung,
  volumenJeKeyword,
  type GscKennzahlen,
  type RankZeile,
} from "@/lib/seoReport";
import {
  ga4Organisch,
  googleToken,
  gscPeriode,
  gscTopSeiten,
  ladeGespeichertenLauf,
  ladeRankTage,
  ladeRankZeilen,
  type GespeicherterLauf,
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

export function echteQuellen(k: SeoKonfig, monat: string | null): Quellen {
  return {
    rankZeilen: (von, bis, kws) => ladeRankZeilen(k.id, von, bis, kws),
    rankTage: (tage) => ladeRankTage(k.id, tage),
    labsGespeichert: () => ladeGespeichertenLauf(k.id, "labs_history"),
    backlinkLauf: (bisIso) => ladeGespeichertenLauf(k.id, "ahrefs", bisIso),
    googleToken: () => googleToken(k.id),
    gscPeriode: (t, von, bis) => gscPeriode(String(k.gsc_property), t, von, bis),
    gscTopSeiten: (t, von, bis) => gscTopSeiten(String(k.gsc_property), t, von, bis),
    ga4: (t, z) => ga4Organisch(String(k.ga4_property_id), t, z),
    snapshotVormonat: () =>
      monat ? ladeSnapshot(k.id, monatPlus(monat, -1)) : Promise.resolve(null),
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

/** Rank-Fenster des Dashboards: [min(from, to − 30), to]. */
const rankFenster = (z: Zeitraum): Zeitraum => ({
  from: kleinerDatum(z.from, minusTage(z.to, 30)),
  to: z.to,
});

/** GA4-Werte eines Zeitraums inkl. Conversion-Rate (Key Events / Sitzungen). */
function ga4Block(w: Ga4Werte) {
  return {
    sessions: w.sessions,
    engagement_rate: w.engagement_rate,
    key_events: w.key_events,
    conversion_rate:
      w.sessions > 0 ? Math.round((w.key_events / w.sessions) * 10000) / 10000 : null,
    key_events_by_event: w.key_events_by_event ?? null,
  };
}

type BacklinkWert = {
  wert: number | null;
  quelle: "ezyhub" | null;
  lauf: GespeicherterLauf | null;
};

type GscBlock = GscKennzahlen & { brand: GscKennzahlen; nonbrand: GscKennzahlen };

/** Zeitraum unvollständig? GSC-Daten sind erst nach GSC_VERZUG_TAGE vollständig. */
export function zeitraumUnvollstaendig(bis: string, heute: string): boolean {
  return bis > minusTage(heute, GSC_VERZUG_TAGE);
}

/**
 * Report berechnen. `periode` = Berichtsmonat (YYYY-MM) oder Perioden aus
 * periodenFuerZeitraum (from/to). `heute` = Schweizer Datum (YYYY-MM-DD).
 */
export async function berechneSeoReport(
  k: SeoKonfig,
  periode: string | Perioden,
  q: Quellen,
  opts: { jetzt?: Date; heute: string },
) {
  const P = typeof periode === "string" ? periodenFuerMonat(periode) : periode;
  const monatsModus = P.modus === "month";
  const monat = P.etvMonat;
  const jetzt = opts.jetzt ?? new Date();
  const heute = opts.heute;
  const errors: Array<{ source: string; message: string }> = [];
  const fehler = (source: string, e: unknown) =>
    errors.push({ source, message: String((e as Error)?.message || e).slice(0, 160) });

  const zr = { current: P.current, previous: P.previous, previous_year: P.previous_year };
  const ende = P.current.to;
  const istBrand = brandErkenner(k.brand_regex);

  // Felder ohne gespeicherten Wert in EzyHub (bleiben null, checks-Hinweis)
  const fehlend: Array<{ field: string; monat: string }> = [];

  // ── Sichtbarkeit (ETV): gespeicherter labs_history-Lauf ────────────────────
  const sichtbarkeitLaden = async (): Promise<{
    labs: LabsMonat[] | null;
    stand: string | null;
  }> => {
    try {
      const lauf = await q.labsGespeichert();
      if (lauf)
        return {
          labs: labsMonateAusGespeichert(lauf.result?.months),
          stand: String(lauf.created_at).slice(0, 10),
        };
    } catch (e) {
      fehler("labs_history", e);
    }
    fehlend.push({ field: "visibility", monat });
    return { labs: null, stand: null };
  };

  // ── Backlinks: gespeicherte EzyRank-Läufe zum Monatsende ───────────────────
  const backlinksLaden = async () => {
    const laufBis = async (z: Zeitraum) => {
      try {
        return await q.backlinkLauf(tagesendeZuerich(z.to));
      } catch (e) {
        fehler("ezyrank_backlinks", e);
        return null;
      }
    };
    // Läufe zum Ende von Zeitraum, Vorperiode, Vorjahreszeitraum (Dashboard-Auswahl)
    const [laufCur, laufPrev, laufPy] = await Promise.all([
      laufBis(zr.current),
      laufBis(zr.previous),
      laufBis(zr.previous_year),
    ]);
    const laeufe = { current: laufCur, previous: laufPrev, previous_year: laufPy };
    type Teil = keyof typeof laeufe;
    const ausLauf = (t: Teil): BacklinkWert => {
      for (const lauf of [laufCur, t === "current" ? null : laeufe[t]]) {
        if (!lauf) continue;
        const wert = refdomainsImZeitraum(refdomainsVerlaufAus(lauf.result), zr[t].from, zr[t].to);
        if (wert != null) return { wert, quelle: "ezyhub", lauf };
      }
      return { wert: null, quelle: null, lauf: null };
    };
    const werte: Record<Teil, BacklinkWert> = {
      current: ausLauf("current"),
      previous: ausLauf("previous"),
      previous_year: ausLauf("previous_year"),
    };
    for (const p of Object.keys(werte) as Teil[])
      if (werte[p].wert == null)
        fehlend.push({ field: `backlinks.referring_domains.${p}`, monat: zeitraumText(zr[p]) });
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
    current: { startDate: zr.current.from, endDate: gscEnde },
    previous: { startDate: zr.previous.from, endDate: zr.previous.to },
    previous_year: { startDate: zr.previous_year.from, endDate: zr.previous_year.to },
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
        /** Kontrolle der Brand-Regex: grösste Brand-Queries im Berichtszeitraum */
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
      const ga4Bereiche = {
        current: {
          startDate: zr.current.from,
          endDate: kleinerDatum(ende, minusTage(heute, 1)),
        },
        previous: zeitraeume.previous,
        previous_year: zeitraeume.previous_year,
      };
      const [c, p, y] = (
        await q.ga4(token, [ga4Bereiche.current, ga4Bereiche.previous, ga4Bereiche.previous_year])
      ).map(ga4Block);
      ga4 = {
        property_id: k.ga4_property_id,
        channel: "Organic Search",
        ranges: ga4Bereiche,
        current: c,
        previous: p,
        previous_year: y,
        change: {
          sessions_mom: veraenderung(c.sessions, p.sessions),
          sessions_yoy: veraenderung(c.sessions, y.sessions),
          key_events_mom: veraenderung(c.key_events, p.key_events),
          key_events_yoy: veraenderung(c.key_events, y.key_events),
          conversion_rate_mom: veraenderung(c.conversion_rate, p.conversion_rate),
          conversion_rate_yoy: veraenderung(c.conversion_rate, y.conversion_rate),
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
      monatsModus ? zr.previous.from : rankFenster(zr.previous).from,
      ende,
      k.strategic_keywords.map((s) => s.toLowerCase()),
    );
  } catch (e) {
    fehler("rank_daily", e);
  }
  // Monat: letzter Messtag im Monat. Freier Zeitraum: Fenster wie das Dashboard
  // ([min(from, to − 30), to]), damit auch kurze Zeiträume eine Vollmessung haben.
  const messtagIn = (z: Zeitraum) =>
    monatsModus
      ? letzterMesstag(rankZeilen, z.from.slice(0, 7))
      : letzterMesstagIm(rankZeilen, rankFenster(z).from, z.to);
  const tagCur = messtagIn(zr.current);
  const tagPrev = messtagIn(zr.previous);
  let vorher = tagPrev ? positionenAm(rankZeilen, tagPrev) : null;
  let vorherQuelle: "rank_daily" | "snapshot" | null = tagPrev ? "rank_daily" : null;
  if (!vorher && monatsModus) {
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

  const partial = zeitraumUnvollstaendig(ende, heute);
  const checks = berechneChecks({
    monat,
    visibility,
    labsMonatFehlt: !!labs && !labs.some((m) => m.month === monat),
    rankTag: tagCur,
    keywords,
    konfigFehlt: !k.strategic_keywords.length,
    refdomains: { current: rdCur, previous: rdPrev },
    fehlend,
    ende: monatsModus ? undefined : ende,
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
      mode: P.modus,
      month: P.monat,
      previous_month: P.monat ? monatPlus(P.monat, -1) : null,
      previous_year_month: P.monat ? monatPlus(P.monat, -12) : null,
      from: zr.current.from,
      to: zr.current.to,
      previous: zr.previous,
      previous_year: zr.previous_year,
      days: Math.round((Date.parse(zr.current.to) - Date.parse(zr.current.from)) / 864e5) + 1,
      /** ETV ist ein Monatswert: Monat des Zeitraum-Endes */
      visibility_month: P.etvMonat,
      partial,
      data_dates: { rankings_current: tagCur, rankings_previous: tagPrev },
    },
    visibility: visibility ? { source: "ezyhub", data_date: sicht.stand, ...visibility } : null,
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
      source: quellenBl.length ? "ezyhub" : null,
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
      /** Zeitraum noch nicht vollständig (GSC-Verzug 3 Tage) — kein Snapshot */
      partial,
      /** keine Live-Abfragen mehr (22.10.2026) — immer 0 */
      dataforseo_cost: 0,
      errors,
    },
  };
}
