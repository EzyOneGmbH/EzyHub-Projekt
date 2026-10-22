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

/** Labs historical_rank_overview → Monatsreihe (fehlende pos_*-Felder = 0). */
export function labsMonateAus(items: any[] | null | undefined): LabsMonat[] {
  return (items ?? [])
    .map((it) => {
      const o = it?.metrics?.organic ?? {};
      const pos: Record<string, number> = {};
      for (const [k, v] of Object.entries(o)) if (k.startsWith("pos_")) pos[k] = Number(v) || 0;
      return {
        month: `${it?.year}-${String(it?.month).padStart(2, "0")}`,
        etv: Number(o.etv) || 0,
        count: Number(o.count) || 0,
        pos,
      };
    })
    .filter((m) => istMonat(m.month))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export type Verteilung = { top3: number; top10: number; top20: number; top100: number };

export function verteilungAus(m: LabsMonat | null | undefined): Verteilung | null {
  if (!m) return null;
  const p = (k: string) => m.pos[k] ?? 0;
  const top3 = p("pos_1") + p("pos_2_3");
  const top10 = top3 + p("pos_4_10");
  const top20 = top10 + p("pos_11_20");
  return { top3, top10, top20, top100: m.count };
}

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

// ── Backlinks: Ahrefs (wie EzyRank-Modul), DataForSEO als Rückweg ───────────
/** Verweisende Domains je Monat (YYYY-MM). */
export type BacklinkMonat = { month: string; referring_domains: number };

/**
 * Ahrefs refdomains-history (history_grouping=monthly): Punkt «YYYY-MM-01» =
 * Monatswert (live geprüft 21.10.2026: 2026-09-01 = 843, Woche 28.09. = 841).
 */
export function ahrefsMonateAus(rows: any[] | null | undefined): BacklinkMonat[] {
  return (rows ?? [])
    .map((r) => ({
      month: String(r?.date ?? "").slice(0, 7),
      referring_domains: Number(r?.refdomains),
    }))
    .filter((x) => istMonat(x.month) && Number.isFinite(x.referring_domains));
}

/** DataForSEO timeseries_summary (group_range=month): Datum = letzter Tag des Monats. */
export function dfsBacklinkMonateAus(items: any[] | null | undefined): BacklinkMonat[] {
  return (items ?? [])
    .map((it) => ({
      month: String(it?.date ?? "").slice(0, 7),
      referring_domains: Number(it?.referring_domains),
    }))
    .filter((x) => istMonat(x.month) && Number.isFinite(x.referring_domains));
}

export function refdomainsIm(reihe: BacklinkMonat[] | null, monat: string): number | null {
  return reihe?.find((x) => x.month === monat)?.referring_domains ?? null;
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
};

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
  const proTag = new Map<string, number>();
  for (const r of zeilen)
    if (r.date.slice(0, 7) === monat && istDfsZeile(r))
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
  for (const r of zeilen) {
    if (r.date !== tag || !istDfsZeile(r)) continue;
    const k = r.keyword.trim().toLowerCase();
    const alt = m.get(k);
    if (!alt || (r.position as number) < alt.position)
      m.set(k, { position: r.position as number, url: r.url });
  }
  return m;
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
      message: "DataForSEO Labs hat noch keinen Wert für den Berichtsmonat",
    });
  const ende = monatsEnde(t.monat);
  if (!t.rankTag)
    c.push({
      field: "rankings",
      level: "warn",
      message: "Keine DataForSEO-Messung im Berichtsmonat",
    });
  else if (tageZwischen(t.rankTag, ende) > 10)
    c.push({
      field: "rankings",
      level: "warn",
      message: `Letzte DataForSEO-Messung vom ${t.rankTag}, mehr als 10 Tage vor Monatsende`,
    });
  for (const k of t.keywords ?? [])
    if (k.change != null && k.change <= -10)
      c.push({
        field: `rankings.keywords.${k.keyword}`,
        level: "info",
        message: `Keyword «${k.keyword}» verliert ${-k.change} Positionen`,
      });
  if (t.konfigFehlt)
    c.push({
      field: "rankings",
      level: "warn",
      message: "Keine strategischen Keywords hinterlegt — Top-Keywords nach Suchvolumen verwendet",
    });
  return c;
}
