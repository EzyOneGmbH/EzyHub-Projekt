// SEO-Monatsreport (21.10.2026): Rechenregeln, null-Fälle, checks und Fehler
// mit gemockten Quellen (DataForSEO-Formen live geprüft 21.10.2026).
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import {
  ahrefsMonateAus,
  dfsBacklinkMonateAus,
  refdomainsIm,
  berechneChecks,
  berechneKeywords,
  berechneSichtbarkeit,
  brandErkenner,
  brandRegexAusBegriffen,
  brandSplit,
  brandTopQueries,
  chancenKeywords,
  istDfsZeile,
  istMonat,
  labsMonateAus,
  letzterMesstag,
  monatInZukunft,
  monatPlus,
  monatsEnde,
  positionenAm,
  positionenAusSnapshot,
  veraenderung,
  verteilungAus,
  type RankZeile,
} from "@/lib/seoReport";
import { baueKonfig, berechneSeoReport, type Quellen } from "./seo-report.server";
import { dfsTask, ga4WerteAus } from "./seo-report-quellen.server";

const labsItem = (
  year: number,
  month: number,
  etv: number,
  count: number,
  pos: Record<string, number>,
) => ({
  year,
  month,
  metrics: { organic: { etv, count, ...pos } },
});
const LABS = [
  labsItem(2026, 9, 1283.414, 84, {
    pos_1: 2,
    pos_2_3: 3,
    pos_4_10: 10,
    pos_11_20: 23,
    pos_21_30: 21,
  }),
  labsItem(2026, 8, 2174.318, 66, { pos_1: 2, pos_2_3: 2, pos_4_10: 11, pos_11_20: 16 }),
  labsItem(2025, 9, 1524.1666, 155, { pos_1: 3, pos_2_3: 1, pos_4_10: 19, pos_11_20: 33 }),
];
const AHREFS = [
  { date: "2025-09-01T00:00:00Z", refdomains: 87 },
  { date: "2026-08-01T00:00:00Z", refdomains: 446 },
  { date: "2026-09-01T00:00:00Z", refdomains: 843 },
];
const BERNINA_BRAND = String.raw`^(?!.*(express|pass|piz|bahn|zug|gletscher|samedan|1865|st\.?\s?moritz|ischgl|thusis|swiss\s?q|wi-?fi|wlan|\bpin\b)).*(?=.*\bber(n?in|ni|i)a\b).*\b(hotel|hotels|pontresina|restaurant)\b`;
const BACKLINKS = [
  { date: "2025-09-30 00:00:00 +00:00", referring_domains: 70, backlinks: 658 },
  { date: "2026-08-31 00:00:00 +00:00", referring_domains: 85, backlinks: 674 },
  { date: "2026-09-30 00:00:00 +00:00", referring_domains: 93, backlinks: 174 },
];

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

describe("Monate", () => {
  it("prüft Format, Zukunft und Jahresgrenzen", () => {
    expect(istMonat("2026-09")).toBe(true);
    expect(istMonat("2026-13")).toBe(false);
    expect(monatInZukunft("2027-01", "2026-10-21")).toBe(true);
    expect(monatInZukunft("2026-10", "2026-10-21")).toBe(false);
    expect(monatPlus("2026-01", -1)).toBe("2025-12");
    expect(monatsEnde("2028-02")).toBe("2028-02-29");
  });
});

describe("Prozentveränderung", () => {
  it("als Dezimalzahl, null bei fehlender oder 0-Basis", () => {
    expect(veraenderung(477, 260)).toBe(0.8346);
    expect(veraenderung(5, 0)).toBeNull();
    expect(veraenderung(null, 5)).toBeNull();
  });
});

describe("Labs: Sichtbarkeit (ETV) und Verteilung", () => {
  const reihe = labsMonateAus(LABS);
  it("Monat, Vormonat, Vorjahr; History aufsteigend", () => {
    const v = berechneSichtbarkeit(reihe, "2026-09")!;
    expect(v).toMatchObject({
      metric: "etv",
      current: 1283.4,
      previous: 2174.3,
      previous_year: 1524.2,
    });
    expect(v.change_mom).toBe(-0.4097);
    expect(v.small_base).toBe(false);
    expect(v.history.map((h) => h.month)).toEqual(["2025-09", "2026-08", "2026-09"]);
  });
  it("fehlende Monate → null, Fehler → null", () => {
    const v = berechneSichtbarkeit(reihe, "2026-10")!;
    expect(v.current).toBeNull();
    expect(berechneSichtbarkeit(null, "2026-09")).toBeNull();
  });
  it("Verteilung: Top 3/10/20 kumuliert, Top 100 = count", () => {
    expect(verteilungAus(reihe.find((m) => m.month === "2026-09"))).toEqual({
      top3: 5,
      top10: 15,
      top20: 38,
      top100: 84,
    });
    expect(verteilungAus(undefined)).toBeNull();
  });
});

describe("Backlinks: Ahrefs (Monatswert) und DataForSEO-Rückweg", () => {
  it("Ahrefs «YYYY-MM-01» = Monat, DFS «letzter Tag» = Monat", () => {
    const ah = ahrefsMonateAus(AHREFS);
    expect(refdomainsIm(ah, "2026-09")).toBe(843);
    expect(refdomainsIm(ah, "2025-09")).toBe(87);
    expect(refdomainsIm(ah, "2026-07")).toBeNull();
    expect(refdomainsIm(dfsBacklinkMonateAus(BACKLINKS), "2026-09")).toBe(93);
    expect(refdomainsIm(null, "2026-09")).toBeNull();
  });
});

describe("Brand-Regex Hotel Bernina", () => {
  const istBrand = brandErkenner(BERNINA_BRAND);
  it.each([
    ["bernina express", false],
    ["berninapass", false],
    ["bernina pass hotels", false],
    ["piz bernina", false],
    ["hotel bernia", true],
    ["berina hotel", true],
    ["Hotel Bernina Pontresina", true],
    ["pontresina hotel", false],
    ["bernina nähmaschine", false],
    ["bernina 535", false],
    // andere Hotels namens Bernina und WLAN-Text (22.10.2026)
    ["hotel bernina samedan", false],
    ["bernina hotel samedan", false],
    ["hotel bernina 1865", false],
    ["hotel bernina st moritz", false],
    ["hotel bernina ischgl", false],
    ["bernina thusis speisekarte", false],
    ["bernina swiss q hotels", false],
    [
      "hotel bernina wi-fi pin: @bernina it - connettiti alla rete hotelberninafree. registrati con nome, cognome, ed email inserendo il pin.",
      false,
    ],
    ["hotel bernina pontresina", true],
    ["hotel bernina", true],
    ["restaurant bernina pontresina", true],
    ["hotel bernina pontresina preise", true],
  ])("«%s» → Brand %s", (q, erwartet) => {
    expect(istBrand(q)).toBe(erwartet);
  });
});

describe("Keyword-Liste rank_daily", () => {
  it("nur DataForSEO-Positionen zählen, GSC-Ø nie", () => {
    expect(istDfsZeile(z("2026-09-28", "a", 4, "crawl"))).toBe(true);
    expect(istDfsZeile(z("2026-09-28", "a", 4, "gsc"))).toBe(false);
    expect(istDfsZeile(z("2026-08-30", "a", 4, null))).toBe(true); // vor Hybrid
    expect(istDfsZeile({ ...z("2026-09-29", "a", null, null), method: "hybrid" })).toBe(false);
  });
  it("letzter Messtag ignoriert Teil-Crawls und GSC-Tage", () => {
    const zeilen = [
      ...Array.from({ length: 10 }, (_, i) => z("2026-09-25", `k${i}`, 5, "crawl")),
      ...Array.from({ length: 8 }, (_, i) => z("2026-09-28", `k${i}`, 5, "crawl")),
      ...Array.from({ length: 2 }, (_, i) => z("2026-09-30", `k${i}`, 5, "crawl")), // Top-10-Crawl
      ...Array.from({ length: 10 }, (_, i) => z("2026-09-29", `k${i}`, 5, "gsc")),
    ];
    expect(letzterMesstag(zeilen, "2026-09")).toBe("2026-09-28");
    expect(letzterMesstag(zeilen, "2026-08")).toBeNull();
  });
  it("bester Rang je Keyword", () => {
    const m = positionenAm(
      [z("2026-09-28", "Bernina Hotel", 10, "crawl"), z("2026-09-28", "bernina hotel", 2, "crawl")],
      "2026-09-28",
    );
    expect(m.get("bernina hotel")?.position).toBe(2);
  });
});

describe("Keywords im Report", () => {
  const brand = brandErkenner("bernina");
  const pos = (e: Record<string, number>) =>
    new Map(
      Object.entries(e).map(([k, p]) => [k, { position: p, url: "https://www.hotelbernina.ch/" }]),
    );
  const volumen = new Map([
    ["pontresina", 4400],
    ["hotel pontresina", 2900],
    ["bernina hotel", 90],
    ["sporthotel pontresina", 4400],
  ]);
  const gsc = new Map([["pontresina", { clicks: 12, impressions: 900 }]]);
  it("change, new/lost, Volumen, GSC, Brand, Sortierung", () => {
    const k = berechneKeywords({
      aktuell: pos({ pontresina: 6, "bernina hotel": 2, "sporthotel pontresina": 10 }),
      vorher: pos({ pontresina: 20, "hotel pontresina": 1, "sporthotel pontresina": 43 }),
      volumen,
      gsc,
      istBrand: brand,
    });
    expect(k.map((x) => x.keyword)).toEqual([
      "pontresina",
      "sporthotel pontresina",
      "hotel pontresina",
      "bernina hotel",
    ]);
    expect(k[1]).toMatchObject({
      position: 10,
      position_previous: 43,
      change: 33,
      search_volume: 4400,
      gsc_clicks: 0,
    });
    expect(k[0]).toMatchObject({ change: 14, gsc_clicks: 12, gsc_impressions: 900 });
    expect(k[2]).toMatchObject({ position: null, lost: true, change: null });
    expect(k[3]).toMatchObject({ brand: true, new: true });
    expect("traffic" in k[1]).toBe(false);
  });
  it("erster Monat ohne Vergleich: kein change/new/lost; ohne GSC null", () => {
    const k = berechneKeywords({
      aktuell: pos({ pontresina: 6 }),
      vorher: null,
      volumen,
      gsc: null,
      istBrand: brand,
    });
    expect(k[0]).toMatchObject({ change: null, position_previous: null, gsc_clicks: null });
    expect(k[0].new).toBeUndefined();
  });
  it("strategische Keywords erscheinen auch ohne Ranking; maximal 20", () => {
    const k = berechneKeywords({
      aktuell: pos({}),
      vorher: pos({}),
      volumen,
      gsc: null,
      istBrand: brand,
      fest: ["Sporthotel Pontresina"],
    });
    expect(k).toEqual([
      expect.objectContaining({ keyword: "sporthotel pontresina", position: null }),
    ]);
    const viele = pos(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`kw ${i}`, 5])));
    expect(
      berechneKeywords({ aktuell: viele, vorher: null, volumen, gsc: null, istBrand: brand }),
    ).toHaveLength(20);
  });
  it("Vormonat aus Snapshot", () => {
    const m = positionenAusSnapshot({
      rankings: {
        keywords: [
          { keyword: "Pontresina", position: 7 },
          { keyword: "x", position: null },
        ],
      },
    });
    expect([...m!.entries()]).toEqual([["pontresina", { position: 7, url: null }]]);
    expect(positionenAusSnapshot(null)).toBeNull();
  });
  it("Brand-Regex: ungültiges Muster wörtlich, Begriffe escaped", () => {
    expect(brandErkenner("hotel (bern")("Hotel (Bern) Pontresina")).toBe(true);
    expect(brandRegexAusBegriffen(["Hotel Bernina", "b.5"])).toBe("Hotel Bernina|b\\.5");
  });
});

describe("GSC-Auswertung", () => {
  const rows = [
    { keys: ["hotel bernina"], clicks: 50, impressions: 200, position: 1.2 },
    { keys: ["pontresina hotel"], clicks: 3, impressions: 800, position: 12 },
    { keys: ["engadin wandern"], clicks: 0, impressions: 300, position: 25 },
    { keys: ["hotel pontresina"], clicks: 5, impressions: 400, position: 8.4 },
  ];
  it("Brand/Non-Brand getrennt, impressionsgewichtete Position", () => {
    const s = brandSplit(rows, brandErkenner("bernina"));
    expect(s.brand).toEqual({ clicks: 50, impressions: 200, ctr: 0.25, position: 1.2 });
    expect(s.nonbrand.impressions).toBe(1500);
    expect(s.nonbrand.position).toBe(13.6);
  });
  it("Brand-Top-Queries nach Impressionen, Nähmaschinen ausgeschlossen", () => {
    const mit = [...rows, { keys: ["bernina 535"], clicks: 1, impressions: 900, position: 3 }];
    expect(brandTopQueries(mit, brandErkenner(BERNINA_BRAND))).toEqual([
      { query: "hotel bernina", impressions: 200, clicks: 50, position: 1.2 },
    ]);
  });
  it("Chancen: Position 8–20 nach Impressionen", () => {
    expect(chancenKeywords(rows).map((r) => r.query)).toEqual([
      "pontresina hotel",
      "hotel pontresina",
    ]);
  });
});

describe("checks", () => {
  const vis = berechneSichtbarkeit(labsMonateAus(LABS), "2026-09");
  const basis = {
    monat: "2026-09",
    visibility: vis,
    labsMonatFehlt: false,
    rankTag: "2026-09-28",
    keywords: [],
    konfigFehlt: false,
  };
  it("Backlink-Sprung ≥ 50 %", () => {
    const c = berechneChecks({ ...basis, refdomains: { current: 477, previous: 260 } });
    expect(c.map((x) => x.level + ":" + x.field)).toEqual(["warn:backlinks.referring_domains"]);
  });
  it("kleine Basis, veraltete Daten, Keyword-Einbruch, Konfiguration, Labs fehlt", () => {
    const c = berechneChecks({
      ...basis,
      visibility: { ...vis!, small_base: true },
      labsMonatFehlt: true,
      rankTag: "2026-09-14",
      keywords: [
        {
          keyword: "x",
          brand: false,
          position: 30,
          position_previous: 18,
          change: -12,
          search_volume: null,
          url: null,
          gsc_clicks: null,
          gsc_impressions: null,
        },
      ],
      konfigFehlt: true,
      refdomains: { current: 100, previous: 90 },
    });
    expect(c.map((x) => x.level + ":" + x.field)).toEqual([
      "info:visibility",
      "warn:visibility",
      "warn:rankings",
      "info:rankings.keywords.x",
      "warn:rankings",
    ]);
  });
  it("keine Messung im Monat", () => {
    const c = berechneChecks({
      ...basis,
      rankTag: null,
      refdomains: { current: null, previous: null },
    });
    expect(c).toEqual([expect.objectContaining({ field: "rankings", level: "warn" })]);
  });
});

// ── Ganzer Ablauf mit gemockten Quellen ──────────────────────────────────────
const BERNINA = baueKonfig(
  {
    id: "55e123ff-634c-4281-9b83-cf87001af558",
    name: "Hotel Bernina",
    domain: "hotelbernina.ch",
    gsc_property: "https://www.hotelbernina.ch/",
    ga4_property: "326680365",
    metadata: {},
    brand_terms: [],
  },
  { report_active: true, strategic_keywords: [], brand_regex: "bernina" },
);

function quellen(over: Partial<Quellen> = {}): Quellen & { aufrufe: string[] } {
  const aufrufe: string[] = [];
  const periode = (clicks: number) => ({
    totals: { clicks, impressions: clicks * 20, ctr: 0.05, position: 9.5 },
    queries: [
      { keys: ["hotel bernina"], clicks: clicks - 5, impressions: 300, position: 1.1 },
      { keys: ["pontresina"], clicks: 5, impressions: 900, position: 11 },
    ],
    queriesGekappt: false,
  });
  const q: Quellen = {
    dfs: async (pfad) => {
      aufrufe.push(pfad);
      if (pfad.startsWith("dataforseo_labs")) return { ok: true, items: LABS, cost: 0.0103 };
      return { ok: true, items: BACKLINKS, cost: 0.0201 };
    },
    ahrefs: async () => ({ ok: true, rows: AHREFS, units: AHREFS.length * 6 }),
    rankZeilen: async () => [
      z("2026-08-30", "pontresina", 20, null, { search_volume: 4400 }),
      z("2026-08-30", "hotel pontresina", 1, null, { search_volume: 2900 }),
      z("2026-09-28", "pontresina", 6, "crawl", { search_volume: 4400 }),
      z("2026-09-28", "bernina hotel", 2, "crawl", { search_volume: 90 }),
      z("2026-09-29", "pontresina", 3, "gsc"),
    ],
    googleToken: async () => "TOKEN",
    gscPeriode: async (_t, von) => periode(von.startsWith("2026-09") ? 100 : 80),
    gscTopSeiten: async () => [
      {
        page: "https://www.hotelbernina.ch/",
        clicks: 60,
        impressions: 900,
        ctr: 0.0667,
        position: 4.2,
      },
    ],
    ga4: async () => [
      { sessions: 400, engagement_rate: 0.61, key_events: 7 },
      { sessions: 320, engagement_rate: 0.58, key_events: 5 },
      { sessions: 300, engagement_rate: 0.55, key_events: 4 },
    ],
    snapshotVormonat: async () => null,
    ...over,
  };
  return Object.assign(q, { aufrufe });
}

describe("berechneSeoReport", () => {
  const opts = { jetzt: new Date("2026-10-03T05:00:00Z"), heute: "2026-10-03" };

  it("Bernina September 2026: alle Blöcke, Kosten, Quellen", async () => {
    const q = quellen();
    const r: any = await berechneSeoReport(BERNINA, "2026-09", q, opts);
    expect(r.visibility).toMatchObject({ metric: "etv", current: 1283.4, previous: 2174.3 });
    expect(r.rankings).toMatchObject({
      source: "ezyhub",
      previous_source: "rank_daily",
      selection: "top_search_volume",
    });
    expect(r.period.data_dates).toEqual({
      rankings_current: "2026-09-28",
      rankings_previous: "2026-08-30",
    });
    expect(r.rankings.keywords).toEqual([
      expect.objectContaining({
        keyword: "pontresina",
        position: 6,
        position_previous: 20,
        change: 14,
        search_volume: 4400,
        gsc_clicks: 5,
        gsc_impressions: 900,
      }),
      expect.objectContaining({ keyword: "hotel pontresina", position: null, lost: true }),
      expect.objectContaining({ keyword: "bernina hotel", brand: true, new: true }),
    ]);
    expect(r.rankings.distribution.current).toEqual({ top3: 5, top10: 15, top20: 38, top100: 84 });
    expect(r.backlinks.source).toBe("ahrefs");
    expect(r.backlinks.referring_domains).toMatchObject({
      current: 843,
      previous: 446,
      previous_year: 87,
      change: 397,
    });
    expect(r.gsc.current).toMatchObject({ clicks: 100, impressions: 2000 });
    expect(r.gsc.current.brand.clicks).toBe(95);
    expect(r.gsc.change.clicks_mom).toBe(0.25);
    expect(r.gsc.ranges.current).toEqual({ startDate: "2026-09-01", endDate: "2026-09-30" });
    expect(r.gsc.opportunity_keywords).toEqual([expect.objectContaining({ query: "pontresina" })]);
    expect(r.ga4.current.sessions).toBe(400);
    expect(r.meta).toMatchObject({ dataforseo_cost: 0.0103, ahrefs_units: 18, errors: [] });
    expect(q.aufrufe).toEqual(["dataforseo_labs/google/historical_rank_overview/live"]);
    expect(JSON.stringify(r)).not.toMatch(/sistrix|traffic"/i);
  });

  it("Ahrefs-Fehler: Rückweg DataForSEO, Quelle im JSON", async () => {
    const q = quellen({
      ahrefs: async () => ({ ok: false, error: "Ahrefs HTTP 429: limit", units: 0 }),
    });
    const r: any = await berechneSeoReport(BERNINA, "2026-09", q, opts);
    expect(r.backlinks.source).toBe("dataforseo");
    expect(r.backlinks.referring_domains).toMatchObject({
      current: 93,
      previous: 85,
      previous_year: 70,
    });
    expect(r.meta.errors).toEqual([{ source: "ahrefs", message: "Ahrefs HTTP 429: limit" }]);
  });

  it("ohne Ahrefs-Key und DFS-Fehler: Feld null, Fehler gemeldet, Rest bleibt", async () => {
    const q = quellen({
      ahrefs: null,
      dfs: async (pfad) =>
        pfad.startsWith("backlinks")
          ? { ok: false, leer: false, error: "Payment required", cost: 0 }
          : { ok: true, items: LABS, cost: 0.01 },
    });
    const r: any = await berechneSeoReport(BERNINA, "2026-09", q, opts);
    expect(r.backlinks.source).toBe("dataforseo");
    expect(r.backlinks.referring_domains.current).toBeNull();
    expect(r.meta.errors).toEqual([
      { source: "dataforseo.backlinks", message: "Payment required" },
    ]);
    expect(r.visibility.current).toBe(1283.4);
  });

  it("lost nur mit DataForSEO-Position im Vormonat (GSC-Wert zählt nicht)", async () => {
    const r: any = await berechneSeoReport(
      BERNINA,
      "2026-09",
      quellen({
        rankZeilen: async () => [
          z("2026-08-30", "pontresina", 20, null, { search_volume: 4400 }),
          z("2026-08-31", "engadin hotel", 9, "gsc", { search_volume: 900 }),
          z("2026-09-28", "pontresina", 6, "crawl", { search_volume: 4400 }),
        ],
      }),
      opts,
    );
    expect(r.rankings.keywords.map((k: any) => k.keyword)).toEqual(["pontresina"]);
    expect(r.rankings.keywords.some((k: any) => k.lost)).toBe(false);
  });

  it("ohne Google-Anbindung: gsc null mit Fehler, ga4-Feld fehlt", async () => {
    const r: any = await berechneSeoReport(
      BERNINA,
      "2026-09",
      quellen({ googleToken: async () => null }),
      opts,
    );
    expect(r.gsc).toBeNull();
    expect("ga4" in r).toBe(false);
    expect(r.meta.errors).toEqual([{ source: "gsc", message: "Google nicht verbunden" }]);
    expect(r.rankings.keywords[0].gsc_clicks).toBeNull();
  });

  it("ohne Vormonats-Historie: Snapshot, sonst erster Monat ohne Vergleich", async () => {
    const nurSept = async () => [
      z("2026-09-28", "pontresina", 6, "crawl", { search_volume: 4400 }),
    ];
    const a: any = await berechneSeoReport(
      BERNINA,
      "2026-09",
      quellen({
        rankZeilen: nurSept,
        snapshotVormonat: async () => ({
          rankings: { keywords: [{ keyword: "pontresina", position: 9 }] },
        }),
      }),
      opts,
    );
    expect(a.rankings.previous_source).toBe("snapshot");
    expect(a.rankings.keywords[0]).toMatchObject({ change: 3 });
    const b: any = await berechneSeoReport(
      BERNINA,
      "2026-09",
      quellen({ rankZeilen: nurSept }),
      opts,
    );
    expect(b.rankings.previous_source).toBeNull();
    expect(b.rankings.keywords[0]).toMatchObject({ change: null, position_previous: null });
  });

  it("laufender Monat: GSC endet 3 Tage vor heute (partial)", async () => {
    const r: any = await berechneSeoReport(BERNINA, "2026-10", quellen(), { heute: "2026-10-21" });
    expect(r.gsc.ranges.current).toEqual({ startDate: "2026-10-01", endDate: "2026-10-18" });
    expect(r.gsc.partial).toBe(true);
  });
});

describe("dfsTask / GA4", () => {
  it("Retry bei Netzfehler, Kosten aus der Antwort", async () => {
    let n = 0;
    const f = vi.fn(async () => {
      if (n++ === 0) throw new Error("timeout");
      return new Response(
        JSON.stringify({
          tasks: [{ status_code: 20000, cost: 0.0103, result: [{ items: [1, 2] }] }],
        }),
      );
    });
    const r = await dfsTask("x", {}, { auth: "Basic x", fetcher: f as any });
    expect(f).toHaveBeenCalledTimes(2);
    expect(r).toEqual({ ok: true, items: [1, 2], cost: 0.0103 });
  });
  it("«No Search Results» ist leer, kein Fehler", async () => {
    const f = async () =>
      new Response(JSON.stringify({ tasks: [{ status_code: 40102, cost: 0.01 }] }));
    expect(await dfsTask("x", {}, { auth: "a", fetcher: f as any })).toEqual({
      ok: false,
      leer: true,
      cost: 0.01,
    });
  });
  it("GA4-Zeilen je Zeitraum", () => {
    const j = {
      rows: [
        {
          dimensionValues: [{ value: "date_range_1" }],
          metricValues: [{ value: "320" }, { value: "0.58" }, { value: "5" }],
        },
        {
          dimensionValues: [{ value: "date_range_0" }],
          metricValues: [{ value: "400" }, { value: "0.612345" }, { value: "7" }],
        },
      ],
    };
    expect(ga4WerteAus(j, 3)).toEqual([
      { sessions: 400, engagement_rate: 0.6123, key_events: 7 },
      { sessions: 320, engagement_rate: 0.58, key_events: 5 },
      { sessions: 0, engagement_rate: null, key_events: 0 },
    ]);
  });
});
