import { istBuchung } from "./ads-buchung";
import { gaqlBetween, type Zeitraum } from "@/lib/date-range";

// Ads-Report (06.10.2026, Ablösung Data-Studio-Dashboard): Zusatzblock im
// google_ads-Snapshot fuer die neue EzyPerformance-Uebersicht. Jeder Teil wird
// einzeln und fail-soft geladen; Fehler landen in report.errors.

const MICROS = 1_000_000;
const n = (v: unknown) => Number(v ?? 0) || 0;
/** searchStream liefert Chunks {results:[...]} — flach machen. */
const adsRows = (r: Array<{ results?: Array<any> }> | null | undefined): Array<any> =>
  (r ?? []).flatMap((b) => b?.results ?? []);

export type ReportConvAction = {
  name: string;
  category: string;
  /** Hauptziel (Buchung/Kauf) vs. Soft Conversion */
  booking: boolean;
  count: number;
  value: number;
  prevCount: number;
  prevValue: number;
};
export type ReportGeoRow = {
  id: string;
  name: string;
  countryCode: string;
  clicks: number;
  impressions: number;
  conversions: number;
  value: number;
  /** Nur Buchungs-Aktionen (primaer), falls je Conversion-Aktion abgefragt. */
  buchungen?: number;
  buchungswert?: number;
};
export type ReportShare = { key: string; conversions: number; clicks: number };
export type ReportSearchTerm = {
  term: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  value: number;
  absTop: number | null;
};
export type ReportAssetGroup = {
  name: string;
  campaign: string;
  status: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  value: number;
};
export type AdsReport = {
  conversionActions: ReportConvAction[];
  impressionShare: {
    top: number | null;
    absTop: number | null;
    prevTop: number | null;
    prevAbsTop: number | null;
  } | null;
  geo: {
    countries: ReportGeoRow[];
    regions: ReportGeoRow[];
    cities: ReportGeoRow[];
    /** true = buchungen/buchungswert je Ort sind gesetzt */
    buchungenGemessen?: boolean;
  } | null;
  audience: { age: ReportShare[]; gender: ReportShare[]; device: ReportShare[] } | null;
  searchTerms: ReportSearchTerm[] | null;
  assetGroups: ReportAssetGroup[] | null;
  errors: string[];
};

// ── Pure Parser (vitest) ────────────────────────────────────────────────────

/** Conversion-Aktionen aktuell + Vorperiode zusammenfuehren. Anzahl = alle
 *  Conversions (auch sekundaere Aktionen); bei Buchungen zaehlen primaere
 *  Conversions, sofern vorhanden (so wie in Google Ads «Conversions»). */
export function parseConvActions(cur: Array<any>, prev: Array<any>): ReportConvAction[] {
  type Summe = { p: number; pv: number; a: number; av: number };
  const leer = (): Summe => ({ p: 0, pv: 0, a: 0, av: 0 });
  const map = new Map<
    string,
    { name: string; category: string; booking: boolean; cur: Summe; prev: Summe }
  >();
  const add = (rows: Array<any>, periode: "cur" | "prev") => {
    for (const row of rows) {
      const s = row?.segments ?? {};
      const name = String(s.conversionActionName ?? "").trim();
      if (!name) continue;
      const category = String(s.conversionActionCategory ?? "").toUpperCase();
      const e = map.get(name) ?? {
        name,
        category,
        booking: istBuchung(category, name),
        cur: leer(),
        prev: leer(),
      };
      const m = row?.metrics ?? {};
      const z = e[periode];
      z.p += n(m.conversions);
      z.pv += n(m.conversionsValue);
      z.a += n(m.allConversions);
      z.av += n(m.allConversionsValue);
      map.set(name, e);
    }
  };
  add(cur, "cur");
  add(prev, "prev");

  // Sekundaere Buchungsaktionen (Engstligenalp 06.10.: «Buchung» primaer +
  // «Engstligenalp - Buchung» sekundaer) messen dieselben Buchungen doppelt.
  // Gibt es eine primaere Buchungsaktion, zaehlen nur primaere als Buchung;
  // die sekundaeren fallen ganz weg (auch nicht als Soft Conversion).
  const primaer = (e: { cur: Summe; prev: Summe }) => e.cur.p > 0 || e.prev.p > 0;
  const hatPrimaereBuchung = [...map.values()].some((e) => e.booking && primaer(e));
  const werte = (booking: boolean, z: Summe) =>
    booking && z.p > 0
      ? { count: z.p, value: z.pv }
      : { count: Math.max(z.a, z.p), value: Math.max(z.av, z.pv) };

  const out: ReportConvAction[] = [];
  for (const e of map.values()) {
    if (e.booking && hatPrimaereBuchung && !primaer(e)) continue;
    const c = werte(e.booking, e.cur);
    const v = werte(e.booking, e.prev);
    out.push({
      name: e.name,
      category: e.category,
      booking: e.booking,
      count: c.count,
      value: c.value,
      prevCount: v.count,
      prevValue: v.value,
    });
  }
  return out
    .filter((a) => a.count > 0 || a.prevCount > 0)
    .sort((a, b) => Number(b.booking) - Number(a.booking) || b.count - a.count);
}

/** Impression-Anteile (oben / ganz oben) aus einer customer-Zeile. */
export function parseImpressionShare(rows: Array<any>): {
  top: number | null;
  absTop: number | null;
} {
  const m = rows[0]?.metrics;
  if (!m) return { top: null, absTop: null };
  const pct = (v: unknown) => (v == null ? null : Math.round(Number(v) * 1000) / 10);
  return { top: pct(m.topImpressionPercentage), absTop: pct(m.absoluteTopImpressionPercentage) };
}

const geoId = (v: unknown) =>
  String(v ?? "")
    .split("/")
    .pop() ?? "";

/** geographic_view-Zeilen nach einem Schluessel aggregieren (Land/Region/Stadt). */
export function aggregiereGeo(rows: Array<any>, schluessel: (row: any) => unknown): ReportGeoRow[] {
  const map = new Map<string, ReportGeoRow>();
  for (const row of rows) {
    const id = geoId(schluessel(row));
    if (!id) continue;
    const e = map.get(id) ?? {
      id,
      name: "",
      countryCode: "",
      clicks: 0,
      impressions: 0,
      conversions: 0,
      value: 0,
    };
    const m = row?.metrics ?? {};
    e.clicks += n(m.clicks);
    e.impressions += n(m.impressions);
    e.conversions += n(m.conversions);
    e.value += n(m.conversionsValue);
    map.set(id, e);
  }
  return [...map.values()];
}

/** Buchungen je Ort aus geographic_view-Zeilen mit Conversion-Aktions-Segment
 *  (metrics.conversions = nur primaere Aktionen, also keine Doppelzaehlung). */
export function buchungenJeGeo(
  rows: Array<any>,
  schluessel: (row: any) => unknown,
): Map<string, { buchungen: number; wert: number }> {
  const map = new Map<string, { buchungen: number; wert: number }>();
  for (const row of rows) {
    const id = geoId(schluessel(row));
    const s = row?.segments ?? {};
    if (!id || !istBuchung(s.conversionActionCategory, s.conversionActionName)) continue;
    const e = map.get(id) ?? { buchungen: 0, wert: 0 };
    e.buchungen += n(row?.metrics?.conversions);
    e.wert += n(row?.metrics?.conversionsValue);
    map.set(id, e);
  }
  return map;
}

/** Buchungen an Geo-Zeilen haengen; Orte nur mit Buchungen werden ergaenzt. */
export function mitBuchungen(
  geo: ReportGeoRow[],
  buchungen: Map<string, { buchungen: number; wert: number }>,
): ReportGeoRow[] {
  const out = geo.map((g) => ({
    ...g,
    buchungen: buchungen.get(g.id)?.buchungen ?? 0,
    buchungswert: buchungen.get(g.id)?.wert ?? 0,
  }));
  const vorhanden = new Set(geo.map((g) => g.id));
  for (const [id, b] of buchungen) {
    if (vorhanden.has(id)) continue;
    out.push({
      id,
      name: "",
      countryCode: "",
      clicks: 0,
      impressions: 0,
      conversions: 0,
      value: 0,
      buchungen: b.buchungen,
      buchungswert: b.wert,
    });
  }
  return out;
}

/** Namen aus geo_target_constant-Zeilen einsetzen; unbekannte IDs fallen weg. */
export function benenneGeo(rows: ReportGeoRow[], konstanten: Array<any>): ReportGeoRow[] {
  const namen = new Map<string, { name: string; code: string }>();
  for (const k of konstanten) {
    const g = k?.geoTargetConstant ?? {};
    const id = geoId(g.resourceName ?? g.id);
    if (id) namen.set(id, { name: String(g.name ?? ""), code: String(g.countryCode ?? "") });
  }
  return rows
    .map((r) => ({
      ...r,
      name: namen.get(r.id)?.name ?? "",
      countryCode: namen.get(r.id)?.code ?? "",
    }))
    .filter((r) => r.name);
}

/** Zeilen nach Typ-Schluessel (Alter/Geschlecht/Geraet) aufsummieren. */
export function aggregiereAnteile(
  rows: Array<any>,
  schluessel: (row: any) => unknown,
): ReportShare[] {
  const map = new Map<string, ReportShare>();
  for (const row of rows) {
    const key = String(schluessel(row) ?? "").toUpperCase();
    if (!key) continue;
    const e = map.get(key) ?? { key, conversions: 0, clicks: 0 };
    e.conversions += n(row?.metrics?.conversions);
    e.clicks += n(row?.metrics?.clicks);
    map.set(key, e);
  }
  return [...map.values()];
}

/** search_term_view-Zeilen je Suchbegriff (ueber Anzeigengruppen) zusammenfassen. */
export function parseSuchbegriffe(rows: Array<any>, limit = 200): ReportSearchTerm[] {
  const map = new Map<string, ReportSearchTerm & { absTopGewicht: number }>();
  for (const row of rows) {
    const term = String(row?.searchTermView?.searchTerm ?? "").trim();
    if (!term) continue;
    const m = row?.metrics ?? {};
    const e = map.get(term) ?? {
      term,
      impressions: 0,
      clicks: 0,
      cost: 0,
      conversions: 0,
      value: 0,
      absTop: null,
      absTopGewicht: 0,
    };
    const impr = n(m.impressions);
    e.impressions += impr;
    e.clicks += n(m.clicks);
    e.cost += n(m.costMicros) / MICROS;
    e.conversions += n(m.conversions);
    e.value += n(m.conversionsValue);
    if (m.absoluteTopImpressionPercentage != null && impr > 0)
      e.absTopGewicht += n(m.absoluteTopImpressionPercentage) * impr;
    map.set(term, e);
  }
  return [...map.values()]
    .map(({ absTopGewicht, ...e }) => ({
      ...e,
      absTop:
        e.impressions > 0 && absTopGewicht > 0
          ? Math.round((absTopGewicht / e.impressions) * 1000) / 10
          : null,
    }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, limit);
}

export function parseAssetGroups(rows: Array<any>): ReportAssetGroup[] {
  return rows
    .map((row) => {
      const m = row?.metrics ?? {};
      return {
        name: String(row?.assetGroup?.name ?? ""),
        campaign: String(row?.campaign?.name ?? ""),
        status: String(row?.assetGroup?.status ?? ""),
        impressions: n(m.impressions),
        clicks: n(m.clicks),
        cost: n(m.costMicros) / MICROS,
        conversions: n(m.conversions),
        value: n(m.conversionsValue),
      };
    })
    .filter((g) => g.name)
    .sort((a, b) => b.impressions - a.impressions);
}

// ── Laden ───────────────────────────────────────────────────────────────────

type Query = (gaql: string) => Promise<Array<{ results?: Array<any> }>>;

export async function ladeAdsReport(
  query: Query,
  aktuell: Zeitraum,
  vorher: Zeitraum,
): Promise<AdsReport> {
  const report: AdsReport = {
    conversionActions: [],
    impressionShare: null,
    geo: null,
    audience: null,
    searchTerms: null,
    assetGroups: null,
    errors: [],
  };
  const rows = async (gaql: string) => adsRows(await query(gaql));
  const teil = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      report.errors.push(`${label}: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`);
    }
  };
  const cur = gaqlBetween(aktuell);
  const prv = gaqlBetween(vorher);

  await Promise.all([
    teil("conversion_actions", async () => {
      const gaql = (w: string) =>
        `SELECT segments.conversion_action_name, segments.conversion_action_category, metrics.conversions, metrics.conversions_value, metrics.all_conversions, metrics.all_conversions_value FROM customer WHERE ${w}`;
      const [a, b] = await Promise.all([rows(gaql(cur)), rows(gaql(prv))]);
      report.conversionActions = parseConvActions(a, b);
    }),
    teil("impression_share", async () => {
      const gaql = (w: string) =>
        `SELECT metrics.top_impression_percentage, metrics.absolute_top_impression_percentage FROM customer WHERE ${w}`;
      const [a, b] = await Promise.all([rows(gaql(cur)), rows(gaql(prv))]);
      const x = parseImpressionShare(a);
      const y = parseImpressionShare(b);
      report.impressionShare = {
        top: x.top,
        absTop: x.absTop,
        prevTop: y.top,
        prevAbsTop: y.absTop,
      };
    }),
    teil("geo", async () => {
      const m =
        "metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value";
      // Buchungen je Ort (07.10.2026, Karte zaehlte alle Conversions als
      // «Buchungen»): zusaetzlich je Conversion-Aktion — fail-soft (null).
      const ca =
        "segments.conversion_action_name, segments.conversion_action_category, metrics.conversions, metrics.conversions_value";
      const buchungsRows = (sel: string) =>
        rows(
          `SELECT ${sel}, ${ca} FROM geographic_view WHERE ${cur} AND metrics.conversions > 0`,
        ).catch(() => null);
      const [land, region, stadt, bLand, bRegion, bStadt] = await Promise.all([
        rows(`SELECT geographic_view.country_criterion_id, ${m} FROM geographic_view WHERE ${cur}`),
        rows(`SELECT segments.geo_target_region, ${m} FROM geographic_view WHERE ${cur}`),
        rows(
          `SELECT segments.geo_target_city, ${m} FROM geographic_view WHERE ${cur} AND metrics.conversions > 0`,
        ),
        buchungsRows("geographic_view.country_criterion_id"),
        buchungsRows("segments.geo_target_region"),
        buchungsRows("segments.geo_target_city"),
      ]);
      const buchungenGemessen = !!(bLand && bRegion && bStadt);
      const anhaengen = (
        geo: ReportGeoRow[],
        b: Array<any> | null,
        k: (r: any) => unknown,
      ): ReportGeoRow[] => (buchungenGemessen && b ? mitBuchungen(geo, buchungenJeGeo(b, k)) : geo);
      const countries = anhaengen(
        aggregiereGeo(land, (r) => r?.geographicView?.countryCriterionId),
        bLand,
        (r) => r?.geographicView?.countryCriterionId,
      );
      const regions = anhaengen(
        aggregiereGeo(region, (r) => r?.segments?.geoTargetRegion)
          .filter((r) => r.clicks > 0 || r.conversions > 0)
          .sort((a, b) => b.clicks - a.clicks)
          .slice(0, 150),
        bRegion,
        (r) => r?.segments?.geoTargetRegion,
      );
      const cities = anhaengen(
        aggregiereGeo(stadt, (r) => r?.segments?.geoTargetCity)
          .sort((a, b) => b.conversions - a.conversions)
          .slice(0, 60),
        bStadt,
        (r) => r?.segments?.geoTargetCity,
      );
      const ids = [...new Set([...countries, ...regions, ...cities].map((r) => r.id))];
      const konstanten: Array<any> = [];
      for (let i = 0; i < ids.length; i += 100) {
        const liste = ids
          .slice(i, i + 100)
          .map((id) => `'geoTargetConstants/${id}'`)
          .join(",");
        konstanten.push(
          ...(await rows(
            `SELECT geo_target_constant.resource_name, geo_target_constant.name, geo_target_constant.country_code FROM geo_target_constant WHERE geo_target_constant.resource_name IN (${liste})`,
          )),
        );
      }
      report.geo = {
        countries: benenneGeo(countries, konstanten).sort(
          (a, b) => b.conversions - a.conversions || b.clicks - a.clicks,
        ),
        regions: benenneGeo(regions, konstanten),
        cities: benenneGeo(cities, konstanten),
        buchungenGemessen,
      };
    }),
    teil("audience", async () => {
      const m = "metrics.conversions, metrics.clicks";
      const [alter, geschlecht, geraet] = await Promise.all([
        rows(`SELECT ad_group_criterion.age_range.type, ${m} FROM age_range_view WHERE ${cur}`),
        rows(`SELECT ad_group_criterion.gender.type, ${m} FROM gender_view WHERE ${cur}`),
        rows(`SELECT segments.device, ${m} FROM customer WHERE ${cur}`),
      ]);
      report.audience = {
        age: aggregiereAnteile(alter, (r) => r?.adGroupCriterion?.ageRange?.type),
        gender: aggregiereAnteile(geschlecht, (r) => r?.adGroupCriterion?.gender?.type),
        device: aggregiereAnteile(geraet, (r) => r?.segments?.device),
      };
    }),
    teil("search_terms", async () => {
      report.searchTerms = parseSuchbegriffe(
        await rows(
          `SELECT search_term_view.search_term, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.absolute_top_impression_percentage FROM search_term_view WHERE ${cur} ORDER BY metrics.clicks DESC LIMIT 1000`,
        ),
      );
    }),
    teil("asset_groups", async () => {
      report.assetGroups = parseAssetGroups(
        await rows(
          `SELECT asset_group.name, asset_group.status, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM asset_group WHERE ${cur}`,
        ),
      );
    }),
  ]);
  return report;
}
