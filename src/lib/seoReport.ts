// SEO-Monatsreport (21.10.2026, Spezifikation «EzyHub Endpoint: SEO-Report-Daten»,
// Planänderung: alles aus EzyHub/DataForSEO/GSC/GA4, kein Sistrix).
// Reine Rechenregeln ohne Netz/DB — testbar. Prozent als Dezimalzahl
// (0.835 = +83.5 %), Positionsveränderung positiv = verbessert, fehlende
// Daten = null (nie 0).

export type Check = { field: string; level: "warn" | "info"; message: string };

const MONAT_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function istMonat(m: unknown): m is string {
  return typeof m === "string" && MONAT_RE.test(m);
}

/** Monat (YYYY-MM) verschoben um n Monate. */
export function monatPlus(m: string, n: number): string {
  const [j, mo] = m.split("-").map(Number);
  const idx = j * 12 + (mo - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** Letzter Tag des Monats (YYYY-MM-DD). */
export function monatsEnde(m: string): string {
  const [j, mo] = m.split("-").map(Number);
  const tag = new Date(Date.UTC(j, mo, 0)).getUTCDate();
  return `${m}-${String(tag).padStart(2, "0")}`;
}

/** Berichtsmonat liegt nach dem laufenden Monat (Schweizer Datum)? */
export function monatInZukunft(m: string, heuteYmd: string): boolean {
  return m > heuteYmd.slice(0, 7);
}

export function tageZwischen(vonYmd: string, bisYmd: string): number {
  return (Date.parse(`${bisYmd}T00:00:00Z`) - Date.parse(`${vonYmd}T00:00:00Z`)) / 864e5;
}

// ── Berichtszeitraum: Monat oder frei gewählt (from/to, 22.10.2026) ─────────
/** Gültiges Kalenderdatum YYYY-MM-DD? */
export function istYmd(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function plusTage(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
}

/** Gleicher Tag im Vorjahr; 29. Februar → 28. Februar. */
export function vorjahrTag(ymd: string): string {
  const j = Number(ymd.slice(0, 4)) - 1;
  const md = ymd.slice(5);
  return md === "02-29" ? `${j}-02-28` : `${j}-${md}`;
}

export type Zeitraum = { from: string; to: string };
export type Perioden = {
  modus: "month" | "range";
  /** Berichtsmonat (nur Monatsmodus) */
  monat: string | null;
  current: Zeitraum;
  previous: Zeitraum;
  previous_year: Zeitraum;
  /** Monat der Sichtbarkeit (ETV ist ein Monatswert): Monat des Zeitraum-Endes */
  etvMonat: string;
};

/** Monat: Vormonat und Vorjahresmonat, jeweils ganz. */
export function periodenFuerMonat(m: string): Perioden {
  const ganz = (x: string): Zeitraum => ({ from: `${x}-01`, to: monatsEnde(x) });
  return {
    modus: "month",
    monat: m,
    current: ganz(m),
    previous: ganz(monatPlus(m, -1)),
    previous_year: ganz(monatPlus(m, -12)),
    etvMonat: m,
  };
}

/** Freier Zeitraum: gleich lange Vorperiode direkt davor, gleicher Zeitraum im Vorjahr. */
export function periodenFuerZeitraum(from: string, to: string): Perioden {
  const tage = tageZwischen(from, to) + 1;
  return {
    modus: "range",
    monat: null,
    current: { from, to },
    previous: { from: plusTage(from, -tage), to: plusTage(from, -1) },
    previous_year: { from: vorjahrTag(from), to: vorjahrTag(to) },
    etvMonat: to.slice(0, 7),
  };
}

/** Bezeichnung eines Zeitraums in checks: Monat «2026-09» oder «2026-10-01 bis 2026-10-21». */
export function zeitraumText(z: Zeitraum): string {
  const m = z.from.slice(0, 7);
  return z.from === `${m}-01` && z.to === monatsEnde(m) ? m : `${z.from} bis ${z.to}`;
}

const rund = (n: number, stellen = 4) => {
  const f = 10 ** stellen;
  return Math.round(n * f) / f;
};

/** (aktuell − vorher) / vorher; vorher null oder 0 → null. */
export function veraenderung(aktuell: number | null, vorher: number | null): number | null {
  if (aktuell == null || vorher == null || vorher === 0) return null;
  return rund((aktuell - vorher) / vorher);
}

// ── Brand ────────────────────────────────────────────────────────────────────
function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Brand-Erkennung: brand_regex (case-insensitive); ungültiges Muster gilt wörtlich. */
export function brandErkenner(brandRegex: string | null | undefined): (kw: string) => boolean {
  const muster = String(brandRegex ?? "").trim();
  if (!muster) return () => false;
  let re: RegExp;
  try {
    re = new RegExp(muster, "i");
  } catch {
    re = new RegExp(escapeRegex(muster), "i");
  }
  return (kw) => re.test(kw);
}

/**
 * Brand-Regex eines Kunden — EINE Regel für Report und Dashboard (22.10.2026):
 * seo_report_config.brand_regex, Rückfall clients.brand_terms.
 */
export function brandRegexFuer(
  client: { brand_terms?: string[] | null } | null | undefined,
  konfig: { brand_regex?: string | null } | null | undefined,
): string | null {
  return konfig?.brand_regex?.trim() || brandRegexAusBegriffen(client?.brand_terms);
}

/** Brand-Regex aus clients.brand_terms, falls im Report nichts hinterlegt ist. */
export function brandRegexAusBegriffen(begriffe: string[] | null | undefined): string | null {
  const b = (begriffe ?? []).map((s) => s.trim()).filter(Boolean);
  return b.length ? b.map(escapeRegex).join("|") : null;
}

// ── DataForSEO Labs: Sichtbarkeit (ETV) + Verteilung ──────────────────────────
export type LabsMonat = {
  month: string;
  etv: number;
  count: number;
  pos: Record<string, number>;
};

export type Verteilung = { top3: number; top10: number; top20: number; top100: number };

/** ETV unter diesem Wert gilt als kleine Basis (Prozentwerte nicht als Highlight). */
export const ETV_KLEINE_BASIS = 50;

export type Sichtbarkeit = {
  metric: "etv";
  current: number | null;
  previous: number | null;
  previous_year: number | null;
  change_mom: number | null;
  change_yoy: number | null;
  small_base: boolean;
  history: Array<{ month: string; value: number }>;
};

export function berechneSichtbarkeit(
  reihe: LabsMonat[] | null,
  monat: string,
): Sichtbarkeit | null {
  if (!reihe) return null;
  const wert = (m: string) => {
    const e = reihe.find((x) => x.month === m);
    return e ? rund(e.etv, 1) : null;
  };
  const cur = wert(monat);
  const prev = wert(monatPlus(monat, -1));
  const py = wert(monatPlus(monat, -12));
  const ab = monatPlus(monat, -12);
  return {
    metric: "etv",
    current: cur,
    previous: prev,
    previous_year: py,
    change_mom: veraenderung(cur, prev),
    change_yoy: veraenderung(cur, py),
    small_base: prev != null && prev < ETV_KLEINE_BASIS,
    history: reihe
      .filter((x) => x.month >= ab && x.month <= monat)
      .map((x) => ({ month: x.month, value: rund(x.etv, 1) })),
  };
}

// ── Gespeicherte EzyHub-Daten (22.10.2026) ──────────────────────────────────
/** Monate aus dem gespeicherten labs_history-Lauf des agent-service (`result.months`). */
export function labsMonateAusGespeichert(months: any[] | null | undefined): LabsMonat[] {
  return (months ?? [])
    .map((m) => {
      const pos: Record<string, number> = {};
      for (const [k, v] of Object.entries(m ?? {}))
        if (k.startsWith("pos_")) pos[k] = Number(v) || 0;
      return {
        month: String(m?.month ?? ""),
        etv: Number(m?.etv) || 0,
        count: Number(m?.keywords) || 0,
        pos,
      };
    })
    .filter((m) => istMonat(m.month))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export type RefdomainPunkt = { date: string; refdomains: number };

/**
 * Verlauf der verweisenden Domains aus einem gespeicherten EzyRank-Backlink-Lauf
 * (audit_runs 'ahrefs'): Ahrefs { refdomains_history.refdomains[] } wöchentlich,
 * ältere DataForSEO-Läufe { refdomains_history.items[] } — wie das Dashboard.
 */
export function refdomainsVerlaufAus(result: any): RefdomainPunkt[] {
  const rows = result?.refdomains_history?.refdomains ?? result?.refdomains_history?.items;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r: any) => ({
      date: String(r?.date ?? "").slice(0, 10),
      refdomains: Number(r?.refdomains ?? r?.referring_domains),
    }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.refdomains))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Stand zum Monatsende: letzter Verlaufspunkt innerhalb des Monats. */
export function refdomainsZumMonatsende(verlauf: RefdomainPunkt[], monat: string): number | null {
  return refdomainsImZeitraum(verlauf, `${monat}-01`, monatsEnde(monat));
}

/** Stand zum Zeitraum-Ende: letzter Verlaufspunkt innerhalb des Zeitraums. */
export function refdomainsImZeitraum(
  verlauf: RefdomainPunkt[],
  von: string,
  bis: string,
): number | null {
  const drin = verlauf.filter((p) => p.date >= von && p.date <= bis);
  return drin.length ? drin[drin.length - 1].refdomains : null;
}

/** Kacheln des EzyRank-Dashboards aus demselben Lauf (Domain Rating, Backlinks live). */
export type BacklinkStand = {
  provider: "ahrefs" | "dataforseo";
  /** Ahrefs Domain Rating (0–100); null bei DataForSEO-Läufen */
  domain_rating: number | null;
  /** DataForSEO-Rank (0–1000), nur DataForSEO-Läufe (06.08.–09.09.2026) */
  dataforseo_rank: number | null;
  backlinks_live: number | null;
  referring_domains_live: number | null;
};

export function backlinkStandAus(result: any): BacklinkStand {
  const r = result || {};
  const provider = r.source === "dataforseo" ? "dataforseo" : "ahrefs";
  const zahl = (v: unknown) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
  const bl = r.backlinks_stats?.metrics ?? r.backlinks_stats ?? {};
  if (provider === "dataforseo")
    return {
      provider,
      domain_rating: null,
      dataforseo_rank: zahl(r.domain_rating?.rank),
      backlinks_live: zahl(bl.backlinks),
      referring_domains_live: zahl(bl.referring_domains),
    };
  const drNode = r.domain_rating?.domain_rating ?? r.domain_rating ?? {};
  const dr = typeof drNode === "number" ? drNode : drNode?.domain_rating;
  return {
    provider,
    domain_rating: zahl(dr),
    dataforseo_rank: null,
    backlinks_live: zahl(bl.live ?? bl.all_time),
    referring_domains_live: zahl(bl.live_refdomains),
  };
}

// ── Keyword-Liste (rank_daily) ───────────────────────────────────────────────
export type RankZeile = {
  date: string;
  keyword: string;
  position: number | null;
  pos_src: string | null;
  method: string | null;
  url: string | null;
  search_volume: number | null;
  /** Messland/-gerät (internationale Zusatzmessungen); fehlt in älteren Tests */
  country?: string | null;
  device?: string | null;
};

/**
 * Hauptmessung eines Tages: häufigste Kombination aus Land und Gerät.
 * Internationale Zusatzmessungen (alle 10 Tage) zählen damit nicht doppelt.
 */
export function hauptmessung(zeilen: RankZeile[]): RankZeile[] {
  const schluessel = (r: RankZeile) => `${r.country ?? ""}|${r.device ?? ""}`;
  const n = new Map<string, number>();
  for (const r of zeilen) n.set(schluessel(r), (n.get(schluessel(r)) ?? 0) + 1);
  if (n.size <= 1) return zeilen;
  const best = [...n.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return zeilen.filter((r) => schluessel(r) === best);
}

/**
 * DataForSEO-Messung? Seit 09.09.2026 «hybrid»: pos_src crawl = DataForSEO,
 * gsc = GSC-Ø-Position (zählt NICHT als Ranking). Davor (method/pos_src leer)
 * waren alle Positionen DataForSEO-Crawls.
 */
export function istDfsZeile(r: RankZeile): boolean {
  if (r.position == null || !(r.position > 0)) return false;
  if (r.pos_src === "crawl") return true;
  return r.pos_src == null && r.method == null;
}

/**
 * Letzter DataForSEO-Messtag im Monat: letzter Tag mit mindestens der Hälfte
 * der maximalen DFS-Zeilen des Monats (Teil-Crawls wie «nur Top 10» zählen nicht).
 */
export function letzterMesstag(zeilen: RankZeile[], monat: string): string | null {
  return letzterMesstagIm(zeilen, `${monat}-01`, monatsEnde(monat));
}

/**
 * Letzter DataForSEO-Messtag in einem Zeitfenster (gleiche Regel wie
 * letzterMesstag: mindestens die Hälfte der maximalen DFS-Zeilen im Fenster).
 * Genutzt vom Report (Monat) und vom Dashboard (Zeitraum, 22.10.2026).
 */
export function letzterMesstagIm(zeilen: RankZeile[], von: string, bis: string): string | null {
  const proTag = new Map<string, number>();
  for (const r of zeilen)
    if (r.date >= von && r.date <= bis && istDfsZeile(r))
      proTag.set(r.date, (proTag.get(r.date) ?? 0) + 1);
  if (!proTag.size) return null;
  const max = Math.max(...proTag.values());
  return [...proTag.entries()]
    .filter(([, n]) => n >= max * 0.5)
    .map(([d]) => d)
    .sort()
    .pop()!;
}

export type DfsPos = { position: number; url: string | null };

/** DFS-Positionen eines Tages (bester Rang je Keyword, klein geschrieben). */
export function positionenAm(zeilen: RankZeile[], tag: string | null): Map<string, DfsPos> {
  const m = new Map<string, DfsPos>();
  if (!tag) return m;
  for (const r of hauptmessung(zeilen.filter((z) => z.date === tag && istDfsZeile(z)))) {
    const k = r.keyword.trim().toLowerCase();
    const alt = m.get(k);
    if (!alt || (r.position as number) < alt.position)
      m.set(k, { position: r.position as number, url: r.url });
  }
  return m;
}

export type RankVerteilung = Verteilung & { total_tracked: number };

/**
 * Ranking-Verteilung aus rank_daily an einem DataForSEO-Messtag (22.10.2026):
 * nur Crawl-Positionen (GSC-Ø zählt nicht), kumuliert; total_tracked = alle an
 * dem Tag getrackten Keywords (auch ohne Position). `zeilen` = ALLE Zeilen des Tages.
 */
export function verteilungAusRankDaily(
  zeilen: RankZeile[],
  tag: string | null,
): RankVerteilung | null {
  if (!tag) return null;
  const tagZ = hauptmessung(zeilen.filter((r) => r.date === tag));
  if (!tagZ.length) return null;
  const alle = new Set<string>();
  const best = new Map<string, number>();
  for (const r of tagZ) {
    const k = r.keyword.trim().toLowerCase();
    alle.add(k);
    if (!istDfsZeile(r)) continue;
    const p = r.position as number;
    if (!best.has(k) || p < (best.get(k) as number)) best.set(k, p);
  }
  const bis = (max: number) => [...best.values()].filter((p) => p <= max).length;
  return {
    top3: bis(3),
    top10: bis(10),
    top20: bis(20),
    top100: bis(100),
    total_tracked: alle.size,
  };
}

/** Suchvolumen je Keyword (jüngster Wert). */
export function volumenJeKeyword(zeilen: RankZeile[]): Map<string, number> {
  const m = new Map<string, { d: string; v: number }>();
  for (const r of zeilen) {
    if (r.search_volume == null) continue;
    const k = r.keyword.trim().toLowerCase();
    const alt = m.get(k);
    if (!alt || r.date > alt.d) m.set(k, { d: r.date, v: r.search_volume });
  }
  return new Map([...m].map(([k, x]) => [k, x.v]));
}

export type GscKw = { clicks: number; impressions: number };

export type KeywordReport = {
  keyword: string;
  brand: boolean;
  position: number | null;
  position_previous: number | null;
  change: number | null;
  new?: true;
  lost?: true;
  search_volume: number | null;
  url: string | null;
  gsc_clicks: number | null;
  gsc_impressions: number | null;
};

/**
 * Keyword-Tabelle. `vorher` = null → kein Vergleich (erster Monat): change,
 * new und lost entfallen. `fest` = strategische Keywords (auch ohne Ranking).
 * Ohne feste Liste: alle Keywords mit DFS-Position in einem der beiden Monate,
 * nach Suchvolumen absteigend, maximal `max`.
 */
export function berechneKeywords(a: {
  aktuell: Map<string, DfsPos>;
  vorher: Map<string, DfsPos> | null;
  volumen: Map<string, number>;
  gsc: Map<string, GscKw> | null;
  istBrand: (kw: string) => boolean;
  fest?: string[];
  max?: number;
}): KeywordReport[] {
  const fest = (a.fest ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean);
  const namen = fest.length
    ? [...new Set(fest)]
    : [...new Set([...a.aktuell.keys(), ...(a.vorher?.keys() ?? [])])];
  const zeilen = namen.map((kw): KeywordReport => {
    const c = a.aktuell.get(kw) ?? null;
    const p = a.vorher ? (a.vorher.get(kw) ?? null) : null;
    const g = a.gsc ? (a.gsc.get(kw) ?? { clicks: 0, impressions: 0 }) : null;
    const z: KeywordReport = {
      keyword: kw,
      brand: a.istBrand(kw),
      position: c?.position ?? null,
      position_previous: p?.position ?? null,
      change: c && p ? p.position - c.position : null,
      search_volume: a.volumen.get(kw) ?? null,
      url: c?.url ?? p?.url ?? null,
      gsc_clicks: g ? g.clicks : null,
      gsc_impressions: g ? g.impressions : null,
    };
    // lost/new nur gegen DataForSEO-Messtage: `vorher` stammt aus positionenAm()
    // (nur DFS-Zeilen) bzw. aus dem Vormonats-Snapshot, der ebenso entstand.
    if (a.vorher) {
      if (c && !p) z.new = true;
      if (!c && p) z.lost = true;
    }
    return z;
  });
  return zeilen
    .sort(
      (x, y) =>
        (y.search_volume ?? -1) - (x.search_volume ?? -1) ||
        (x.position ?? 999) - (y.position ?? 999) ||
        x.keyword.localeCompare(y.keyword),
    )
    .slice(0, a.max ?? 20);
}

/** Vormonats-Positionen aus einem gespeicherten Report (Fallback ohne Historie). */
export function positionenAusSnapshot(payload: any): Map<string, DfsPos> | null {
  const kws = payload?.rankings?.keywords;
  if (!Array.isArray(kws)) return null;
  const m = new Map<string, DfsPos>();
  for (const k of kws)
    if (typeof k?.position === "number")
      m.set(String(k.keyword).toLowerCase(), { position: k.position, url: k.url ?? null });
  return m;
}

// ── GSC ──────────────────────────────────────────────────────────────────────
export type GscZeile = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr?: number;
  position: number;
};
export type GscKennzahlen = {
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
};

/** Summen aus Zeilen (impressionsgewichtete Ø-Position) — nur für Teilmengen. */
export function summe(rows: GscZeile[]): GscKennzahlen {
  let c = 0,
    i = 0,
    p = 0;
  for (const r of rows) {
    c += Number(r.clicks) || 0;
    i += Number(r.impressions) || 0;
    p += (Number(r.position) || 0) * (Number(r.impressions) || 0);
  }
  return {
    clicks: c,
    impressions: i,
    ctr: i > 0 ? rund(c / i) : null,
    position: i > 0 ? rund(p / i, 1) : null,
  };
}

export function brandSplit(rows: GscZeile[], istBrand: (q: string) => boolean) {
  const brand = rows.filter((r) => istBrand(r.keys[0] ?? ""));
  const nonbrand = rows.filter((r) => !istBrand(r.keys[0] ?? ""));
  return { brand: summe(brand), nonbrand: summe(nonbrand) };
}

/** Brand-Queries mit den meisten Impressionen (zur Kontrolle der Brand-Regex). */
export function brandTopQueries(rows: GscZeile[], istBrand: (q: string) => boolean, max = 20) {
  return rows
    .filter((r) => istBrand(r.keys[0] ?? ""))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, max)
    .map((r) => ({
      query: r.keys[0],
      impressions: r.impressions,
      clicks: r.clicks,
      position: rund(r.position, 1),
    }));
}

/** Keywords auf Position 8–20 mit den meisten Impressionen (Chancen). */
export function chancenKeywords(rows: GscZeile[], max = 10) {
  return rows
    .filter((r) => r.position >= 8 && r.position <= 20)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, max)
    .map((r) => ({
      query: r.keys[0],
      impressions: r.impressions,
      clicks: r.clicks,
      position: rund(r.position, 1),
    }));
}

export type GscKwVoll = GscKw & { position: number | null };

/** GSC je Suchanfrage inkl. impressionsgewichteter Ø-Position (Dashboard-Spalte «Ø Position GSC»). */
export function gscJeQueryVoll(rows: GscZeile[]): Map<string, GscKwVoll> {
  const roh = new Map<string, { clicks: number; impressions: number; pi: number }>();
  for (const r of rows) {
    const k = String(r.keys[0] ?? "")
      .trim()
      .toLowerCase();
    const alt = roh.get(k) ?? { clicks: 0, impressions: 0, pi: 0 };
    const imp = Number(r.impressions) || 0;
    roh.set(k, {
      clicks: alt.clicks + (Number(r.clicks) || 0),
      impressions: alt.impressions + imp,
      pi: alt.pi + (Number(r.position) || 0) * imp,
    });
  }
  return new Map(
    [...roh].map(([k, x]) => [
      k,
      {
        clicks: x.clicks,
        impressions: x.impressions,
        position: x.impressions > 0 ? rund(x.pi / x.impressions, 1) : null,
      },
    ]),
  );
}

export type BrandBucket = { queries: number; clicks: number; impressions: number };

/**
 * Brand/Non-Brand-Widget des Dashboards: Summen + Anzahl Suchanfragen und
 * Non-Brand-Buckets nach Ø-Position (Top 3 = unter 4, Top 10 = 4–10).
 * Summen identisch zu brandSplit (Report).
 */
export function brandWidget(rows: GscZeile[], istBrand: (q: string) => boolean) {
  const split = brandSplit(rows, istBrand);
  const leer = (): BrandBucket => ({ queries: 0, clicks: 0, impressions: 0 });
  const buckets = { top3: leer(), top10: leer(), pos11to20: leer(), pos21plus: leer() };
  let brandQ = 0;
  let nonbrandQ = 0;
  for (const r of rows) {
    if (istBrand(r.keys[0] ?? "")) {
      brandQ += 1;
      continue;
    }
    nonbrandQ += 1;
    const p = Number(r.position) || 0;
    const b =
      p < 4
        ? buckets.top3
        : p <= 10
          ? buckets.top10
          : p <= 20
            ? buckets.pos11to20
            : buckets.pos21plus;
    b.queries += 1;
    b.clicks += Number(r.clicks) || 0;
    b.impressions += Number(r.impressions) || 0;
  }
  return {
    brand: { ...split.brand, queries: brandQ },
    nonbrand: { ...split.nonbrand, queries: nonbrandQ },
    buckets_nonbrand: buckets,
  };
}

export function gscJeQuery(rows: GscZeile[]): Map<string, GscKw> {
  const m = new Map<string, GscKw>();
  for (const r of rows) {
    const k = String(r.keys[0] ?? "")
      .trim()
      .toLowerCase();
    const alt = m.get(k) ?? { clicks: 0, impressions: 0 };
    m.set(k, { clicks: alt.clicks + r.clicks, impressions: alt.impressions + r.impressions });
  }
  return m;
}

// ── checks ───────────────────────────────────────────────────────────────────
export type ReportTeile = {
  monat: string;
  visibility: Sichtbarkeit | null;
  labsMonatFehlt: boolean;
  rankTag: string | null;
  keywords: KeywordReport[] | null;
  konfigFehlt: boolean;
  refdomains: { current: number | null; previous: number | null };
  /** Felder ohne gespeicherten Wert in EzyHub (bleiben null) */
  fehlend?: Array<{ field: string; monat: string }>;
  /** freier Zeitraum: Ende des Berichtszeitraums (sonst Monatsende) */
  ende?: string;
};

/** Plausibilitätsprüfungen laut Spezifikation — markieren, nie korrigieren. */
export function berechneChecks(t: ReportTeile): Check[] {
  const c: Check[] = [];
  const rdChange = veraenderung(t.refdomains.current, t.refdomains.previous);
  if (rdChange != null && Math.abs(rdChange) >= 0.5)
    c.push({
      field: "backlinks.referring_domains",
      level: "warn",
      message: `${rdChange > 0 ? "Zuwachs" : "Rückgang"} von 50 % oder mehr in einem Monat, vor dem Report prüfen`,
    });
  if (t.visibility?.small_base)
    c.push({
      field: "visibility",
      level: "info",
      message: `Kleine Basis (ETV Vormonat < ${ETV_KLEINE_BASIS}), Prozentwert nicht als Highlight verwenden`,
    });
  if (t.labsMonatFehlt)
    c.push({
      field: "visibility",
      level: "warn",
      message: "Die gespeicherte Labs-Historie hat noch keinen Wert für den Berichtsmonat",
    });
  const ende = t.ende ?? monatsEnde(t.monat);
  if (!t.rankTag)
    c.push({
      field: "rankings",
      level: "warn",
      message: t.ende
        ? "Keine DataForSEO-Messung im Berichtszeitraum"
        : "Keine DataForSEO-Messung im Berichtsmonat",
    });
  else if (tageZwischen(t.rankTag, ende) > 10)
    c.push({
      field: "rankings",
      level: "warn",
      message: `Letzte DataForSEO-Messung vom ${t.rankTag}, mehr als 10 Tage vor ${t.ende ? "Zeitraum-Ende" : "Monatsende"}`,
    });
  for (const k of t.keywords ?? [])
    if (k.change != null && k.change <= -10)
      c.push({
        field: `rankings.keywords.${k.keyword}`,
        level: "info",
        message: `Keyword «${k.keyword}» verliert ${-k.change} Positionen`,
      });
  for (const f of t.fehlend ?? [])
    c.push({
      field: f.field,
      level: "info",
      message: `EzyHub hat für ${f.monat} keine gespeicherten Daten, Wert bleibt leer`,
    });
  if (t.konfigFehlt)
    c.push({
      field: "rankings",
      level: "warn",
      message: "Keine strategischen Keywords hinterlegt — Top-Keywords nach Suchvolumen verwendet",
    });
  return c;
}
