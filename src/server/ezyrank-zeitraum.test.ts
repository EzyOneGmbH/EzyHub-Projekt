// EzyRank-Zeitraum-Stand (22.10.2026): gleiche Werte wie der SEO-Report-Endpoint
// für denselben Kunden und Zeitraum (Rankings, Verteilung, GSC je Keyword, Brand-Split).
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import { brandRegexFuer, letzterMesstagIm, type RankZeile } from "@/lib/seoReport";
import { berechneZeitraumStand, type ZeitraumQuellen } from "./ezyrank-zeitraum.server";
import { baueKonfig, berechneSeoReport, type Quellen } from "./seo-report.server";

const z = (
  date: string,
  keyword: string,
  position: number | null,
  pos_src: string | null,
  extra: Partial<RankZeile> = {},
): RankZeile => ({
  date,
  keyword,
  position,
  pos_src,
  method: pos_src ? "hybrid" : null,
  url: "https://www.hotelbernina.ch/",
  search_volume: null,
  ...extra,
});

const BRAND = String.raw`^(?!.*(express|pass)).*(?=.*\bber(n?in|ni|i)a\b).*\b(hotel|pontresina)\b`;

// rank_daily: DFS-Zeilen (mit Position) und alle Zeilen der Messtage
const DFS_ZEILEN = [
  z("2026-08-30", "pontresina", 20, null, { search_volume: 4400 }),
  z("2026-08-30", "hotel pontresina", 1, null, { search_volume: 2900 }),
  z("2026-09-18", "pontresina", 9, "crawl"),
  z("2026-09-18", "hotel bernina", 1, "crawl"),
  z("2026-09-28", "pontresina", 6, "crawl", { search_volume: 4400 }),
  z("2026-09-28", "hotel bernina", 2, "crawl", { search_volume: 90 }),
];
const TAGES_ZEILEN = [
  ...DFS_ZEILEN,
  z("2026-08-30", "hotel bernina", null, null),
  z("2026-09-28", "hotel pontresina", 9, "gsc", { search_volume: 2900 }),
  z("2026-09-28", "engadin hotel", null, null),
];
const GSC_ROWS = [
  { keys: ["hotel bernina pontresina"], clicks: 100, impressions: 1382, position: 2.2 },
  { keys: ["hotel bernina"], clicks: 38, impressions: 860, position: 7.1 },
  { keys: ["pontresina"], clicks: 9, impressions: 3709, position: 11.9 },
  { keys: ["hotel pontresina"], clicks: 4, impressions: 1880, position: 10.8 },
  { keys: ["bernina express"], clicks: 0, impressions: 400, position: 30 },
  { keys: ["indian summer engadin"], clicks: 0, impressions: 258, position: 8.6 },
];

const zq = (): ZeitraumQuellen => ({
  rankZeilen: async (von, bis) => DFS_ZEILEN.filter((r) => r.date >= von && r.date <= bis),
  rankTage: async (tage) => TAGES_ZEILEN.filter((r) => tage.includes(r.date)),
  googleToken: async () => "TOKEN",
  gscZeilen: async () => GSC_ROWS,
});
const KUNDE = {
  id: "55e123ff-634c-4281-9b83-cf87001af558",
  gsc_property: "https://www.hotelbernina.ch/",
  brand_regex: BRAND,
};
const SEPT = {
  von: "2026-09-01",
  bis: "2026-09-30",
  vergleichBis: "2026-09-01",
  heute: "2026-10-22",
};

describe("Zeitraum-Stand", () => {
  it("letzte DataForSEO-Messung bis Zeitraum-Ende, GSC-Ø nie als Position", async () => {
    const r = await berechneZeitraumStand(KUNDE, SEPT, zq());
    expect(r.rankings.measured_on).toBe("2026-09-28");
    expect(r.rankings.compare_measured_on).toBe("2026-08-30");
    expect(r.rankings.prev7_measured_on).toBe("2026-09-18");
    const hp = r.rankings.keywords.find((k) => k.kw === "hotel pontresina")!;
    expect(hp.position).toBeNull(); // nur GSC-Wert am Messtag
    expect(hp.gsc).toEqual({ clicks: 4, impressions: 1880, position: 10.8 });
    const hb = r.rankings.keywords.find((k) => k.kw === "hotel bernina")!;
    expect(hb).toMatchObject({ position: 2, posPrev7: 1, volume: 90 });
    expect(r.rankings.distribution.current).toEqual({
      top3: 1,
      top10: 2,
      top20: 2,
      top100: 2,
      total_tracked: 4,
    });
    expect(r.rankings.distribution.previous).toMatchObject({ top3: 1, total_tracked: 3 });
  });

  it("Brand-Split über den Zeitraum mit brand_regex, ungetrackte Non-Brand-Zeilen", async () => {
    const r = await berechneZeitraumStand(KUNDE, SEPT, zq());
    expect(r.gsc!.range).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(r.gsc!.brand).toEqual({
      clicks: 138,
      impressions: 2242,
      ctr: 0.0616,
      position: 4.1,
      queries: 2,
    });
    expect(r.gsc!.nonbrand.queries).toBe(4);
    expect(r.gsc!.buckets_nonbrand.top10).toEqual({ queries: 1, clicks: 0, impressions: 258 });
    expect(r.gsc!.queries_untracked.map((q) => q.query)).toEqual([
      "bernina express",
      "indian summer engadin",
    ]);
  });

  it("laufender Zeitraum: GSC endet 3 Tage vor heute; ohne Google kein GSC-Block", async () => {
    const a = await berechneZeitraumStand(
      KUNDE,
      { von: "2026-10-01", bis: "2026-10-21", vergleichBis: null, heute: "2026-10-22" },
      zq(),
    );
    expect(a.gsc!.range.to).toBe("2026-10-19");
    const b = await berechneZeitraumStand(KUNDE, SEPT, { ...zq(), googleToken: async () => null });
    expect(b.gsc).toBeNull();
    expect(b.errors).toEqual([{ source: "gsc", message: "Google nicht verbunden" }]);
  });

  it("identisch mit dem SEO-Report-Endpoint für September", async () => {
    const konfig = baueKonfig(
      {
        id: KUNDE.id,
        name: "Hotel Bernina",
        domain: "hotelbernina.ch",
        gsc_property: KUNDE.gsc_property,
        ga4_property: null,
        metadata: {},
        brand_terms: [],
      },
      { report_active: true, strategic_keywords: [], brand_regex: BRAND },
    );
    const q: Quellen = {
      dfs: null,
      ahrefs: null,
      rankZeilen: async (von, bis) => DFS_ZEILEN.filter((r) => r.date >= von && r.date <= bis),
      rankTage: async (tage) => TAGES_ZEILEN.filter((r) => tage.includes(r.date)),
      labsGespeichert: async () => null,
      backlinkLauf: async () => null,
      googleToken: async () => "TOKEN",
      gscPeriode: async () => ({
        totals: { clicks: 151, impressions: 8489, ctr: 0.0178, position: 9 },
        queries: GSC_ROWS,
        queriesGekappt: false,
      }),
      gscTopSeiten: async () => [],
      ga4: async () => [],
      snapshotVormonat: async () => null,
    };
    const report: any = await berechneSeoReport(konfig, "2026-09", q, { heute: "2026-10-22" });
    const stand = await berechneZeitraumStand(KUNDE, SEPT, zq());
    expect(stand.rankings.measured_on).toBe(report.period.data_dates.rankings_current);
    expect(stand.rankings.distribution.current).toEqual(report.rankings.distribution.current);
    expect(stand.rankings.distribution.previous).toEqual(report.rankings.distribution.previous);
    for (const k of report.rankings.keywords) {
      const d = stand.rankings.keywords.find((x) => x.kw.toLowerCase() === k.keyword);
      if (!d) continue;
      expect(d.position).toBe(k.position);
      expect(d.gsc?.clicks ?? null).toBe(k.gsc_clicks);
      expect(d.gsc?.impressions ?? null).toBe(k.gsc_impressions);
    }
    const { queries: _bq, ...brand } = stand.gsc!.brand;
    const { queries: _nq, ...nonbrand } = stand.gsc!.nonbrand;
    expect(brand).toEqual(report.gsc.current.brand);
    expect(nonbrand).toEqual(report.gsc.current.nonbrand);
  });
});

describe("gemeinsame Regeln", () => {
  it("Messtag im Fenster: Teil-Crawls unter 50 % zählen nicht", () => {
    const zeilen = [
      ...["a", "b", "c", "d"].map((k) => z("2026-09-25", k, 5, "crawl")),
      z("2026-09-29", "a", 3, "crawl"),
    ];
    expect(letzterMesstagIm(zeilen, "2026-09-01", "2026-09-30")).toBe("2026-09-25");
    expect(letzterMesstagIm(zeilen, "2026-09-26", "2026-09-30")).toBe("2026-09-29");
  });
  it("brand_regex vor clients.brand_terms", () => {
    expect(brandRegexFuer({ brand_terms: ["Hotel Bernina"] }, { brand_regex: " bernina " })).toBe(
      "bernina",
    );
    expect(brandRegexFuer({ brand_terms: ["Hotel Bernina"] }, null)).toBe("Hotel Bernina");
    expect(brandRegexFuer({ brand_terms: [] }, { brand_regex: "" })).toBeNull();
  });
});
