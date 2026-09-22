// First-Party GEO (22.09.2026): reine Aufbereitung mit Fixtures —
// Referrals (Klassifikation, Tagesluecken, Top-Landingpages), Zitate-Abgleich
// (URL-Normalisierung, Schwellen, Zusammenfassung), Brand-Wochen + Trend,
// DiD-Fenster und Kontrollgruppe (Sektion vs. sitewide), robots.txt fail-soft.
import { describe, it, expect, vi } from "vitest";
import {
  aggregiereReferrals,
  bereiteDid,
  brandBegriffeAus,
  brandWochen,
  crawlerBlock,
  didFenster,
  DidParamFehler,
  erstesPfadsegment,
  hostAusDomain,
  kreuzeZitate,
  ladeRobots,
  normalisiereUrl,
  REFERRAL_HINWEIS,
  zitierteUrlsAusReports,
  type KiReferralZeile,
  type SeiteTagZeile,
} from "./first-party-geo.server";

describe("URL-Hilfen", () => {
  it("normalisiereUrl: Protokoll, www, utm, Fragment, Schluss-Slash egal", () => {
    const k = normalisiereUrl("https://www.A.ch/Blog/x/?utm_source=chatgpt.com#top");
    expect(k).toBe("a.ch/Blog/x");
    expect(normalisiereUrl("http://a.ch/Blog/x")).toBe(k);
    expect(normalisiereUrl("a.ch/Blog/x/")).toBe(k);
    expect(normalisiereUrl("https://a.ch/p?b=2&utm_medium=x&a=1")).toBe("a.ch/p?b=2&a=1");
    expect(normalisiereUrl("https://a.ch/")).toBe("a.ch");
    expect(normalisiereUrl("")).toBe("");
  });

  it("erstesPfadsegment und hostAusDomain", () => {
    expect(erstesPfadsegment("https://a.ch/blog/x")).toBe("blog");
    expect(erstesPfadsegment("https://a.ch/")).toBe("");
    expect(erstesPfadsegment("https://a.ch/angebot")).toBe("angebot");
    expect(hostAusDomain("https://www.a.ch/x")).toBe("www.a.ch");
    expect(hostAusDomain("a.ch")).toBe("a.ch");
    expect(hostAusDomain("")).toBeNull();
    expect(hostAusDomain(null)).toBeNull();
  });

  it("brandBegriffeAus: konfigurierte Begriffe, sonst Domain-Stamm in drei Varianten", () => {
    expect(brandBegriffeAus({ brand_terms: [" Faith ", "FIH", "faith"], domain: "x.ch" })).toEqual([
      "faith",
      "fih",
    ]);
    expect(brandBegriffeAus({ brand_terms: [], domain: "https://www.hotel-ava.ch/" })).toEqual([
      "hotel ava",
      "hotel-ava",
      "hotelava",
    ]);
    expect(brandBegriffeAus({ brand_terms: null, domain: "" })).toEqual([]);
  });
});

describe("aggregiereReferrals", () => {
  const rows: KiReferralZeile[] = [
    {
      date: "2026-09-01",
      session_source: "chatgpt.com",
      session_medium: "referral",
      landing_page: "/a",
      sessions: 10,
      engaged_sessions: 6,
      key_events: 1,
    },
    {
      date: "2026-09-01",
      session_source: "chat.openai.com",
      session_medium: "referral",
      landing_page: "/a",
      sessions: 5,
      engaged_sessions: 2,
      key_events: 0.5,
    },
    {
      date: "2026-09-02",
      session_source: "perplexity.ai",
      session_medium: "referral",
      landing_page: "/b",
      sessions: 4,
      engaged_sessions: 4,
      key_events: 0,
    },
    {
      date: "2026-09-03",
      session_source: "newsletter",
      session_medium: "ai-assistant",
      landing_page: "/c",
      sessions: 1,
      engaged_sessions: 1,
      key_events: 0,
    },
    // Vorfilter-Treffer, die TS verwirft (kein KI-Host, kein KI-Medium)
    {
      date: "2026-09-03",
      session_source: "box.ai",
      session_medium: "referral",
      landing_page: "/d",
      sessions: 99,
      engaged_sessions: 99,
      key_events: 9,
    },
  ];

  it("verdichtet je Engine mit Anteil, fuellt alle Tage, Top-Landingpages je Engine", () => {
    const r = aggregiereReferrals(rows, { from: "2026-09-01", to: "2026-09-04" });
    expect(r.engines).toEqual([
      { engine: "ChatGPT", sessions: 15, engaged: 8, keyEvents: 1.5, anteilProzent: 75 },
      { engine: "Perplexity", sessions: 4, engaged: 4, keyEvents: 0, anteilProzent: 20 },
      { engine: "KI-Assistent (Kanal)", sessions: 1, engaged: 1, keyEvents: 0, anteilProzent: 5 },
    ]);
    expect(r.tage).toEqual([
      { date: "2026-09-01", sessions: 15, engaged: 8, keyEvents: 1.5 },
      { date: "2026-09-02", sessions: 4, engaged: 4, keyEvents: 0 },
      { date: "2026-09-03", sessions: 1, engaged: 1, keyEvents: 0 },
      { date: "2026-09-04", sessions: 0, engaged: 0, keyEvents: 0 },
    ]);
    expect(r.landingpages[0]).toEqual({
      engine: "ChatGPT",
      landingPage: "/a",
      sessions: 15,
      keyEvents: 1.5,
    });
    expect(r.landingpages).toHaveLength(3);
    expect(r.hinweis).toBe(REFERRAL_HINWEIS);
    expect(r.hinweis).toContain("~70 % der KI-Referrals kommen als Direct an");
  });

  it("Top-20-Deckel fuer Landingpages; leere Eingabe → leere Listen, Tage trotzdem gefuellt", () => {
    const viele: KiReferralZeile[] = Array.from({ length: 30 }, (_, i) => ({
      date: "2026-09-01",
      session_source: "chatgpt.com",
      session_medium: "referral",
      landing_page: `/p${i}`,
      sessions: 30 - i,
      engaged_sessions: 0,
      key_events: 0,
    }));
    expect(
      aggregiereReferrals(viele, { from: "2026-09-01", to: "2026-09-01" }).landingpages,
    ).toHaveLength(20);
    const leer = aggregiereReferrals([], { from: "2026-09-01", to: "2026-09-02" });
    expect(leer.engines).toEqual([]);
    expect(leer.tage).toHaveLength(2);
  });
});

describe("kreuzeZitate", () => {
  const seiten = [
    { page: "https://www.a.ch/blog/x/", impressions: 500, clicks: 40, pos: 4.2 },
    { page: "https://a.ch/blog/y", impressions: 300, clicks: 10, pos: 9.1 },
    { page: "https://a.ch/blog/z", impressions: 20, clicks: 1, pos: 30 },
    { page: "https://a.ch/", impressions: 1000, clicks: 200, pos: 1.5 },
  ];
  const zitiert = [
    "https://a.ch/blog/x?utm_source=chatgpt.com",
    "https://a.ch/blog/z",
    "https://a.ch/neu",
  ];

  it("kreuzt normalisiert; Schwellen; Zusammenfassung", () => {
    const r = kreuzeZitate(zitiert, seiten, "2026-09-20");
    expect(r.standVom).toBe("2026-09-20");
    expect(r.zitiert).toEqual([
      { page: "https://www.a.ch/blog/x/", impressions: 500, clicks: 40, pos: 4.2, zitiert: true },
      { page: "https://a.ch/blog/z", impressions: 20, clicks: 1, pos: 30, zitiert: true },
      { page: "https://a.ch/neu", impressions: 0, clicks: 0, pos: null, zitiert: true },
    ]);
    expect(r.organischNichtZitiert.map((s) => s.page)).toEqual([
      "https://a.ch/",
      "https://a.ch/blog/y",
    ]);
    expect(r.zitiertOhneSichtbarkeit).toEqual([
      { page: "https://a.ch/blog/z", impressions: 20, clicks: 1 },
      { page: "https://a.ch/neu", impressions: 0, clicks: 0 },
    ]);
    expect(r.zusammenfassung).toEqual({
      zitierteSeiten: 3,
      davonMitOrganik: 2,
      organischeSeitenOhneZitat: 2,
    });
  });

  it("Top-15-Deckel bei organischNichtZitiert, Zaehler bleibt vollstaendig", () => {
    const viele = Array.from({ length: 20 }, (_, i) => ({
      page: `https://a.ch/p${i}`,
      impressions: 100 + i,
      clicks: 1,
      pos: 5,
    }));
    const r = kreuzeZitate([], viele, null);
    expect(r.organischNichtZitiert).toHaveLength(15);
    expect(r.organischNichtZitiert[0].page).toBe("https://a.ch/p19");
    expect(r.zusammenfassung.organischeSeitenOhneZitat).toBe(20);
    expect(r.zitiert).toEqual([]);
  });

  it("zitierteUrlsAusReports: neuester Report mit parts.br.urls ∪ parts.sa.urls, dedupliziert", () => {
    const r = zitierteUrlsAusReports([
      { snapshot_date: "2026-09-21", parts: { pr: { selfShare: 10 } } }, // kein br/sa → weiter
      {
        snapshot_date: "2026-09-14",
        parts: {
          br: { urls: ["https://a.ch/x", "https://a.ch/y"] },
          sa: { urls: ["https://a.ch/y", ""] },
        },
      },
      { snapshot_date: "2026-09-07", parts: { br: { urls: ["https://a.ch/alt"] } } },
    ]);
    expect(r).toEqual({ standVom: "2026-09-14", urls: ["https://a.ch/x", "https://a.ch/y"] });
    expect(zitierteUrlsAusReports([])).toEqual({ standVom: null, urls: [] });
  });
});

describe("brandWochen", () => {
  const woche = (i: number, brand: number) => ({
    woche_ab: `2026-0${i < 3 ? 7 : 8}-${String(i < 3 ? 13 + i * 7 : (i - 3) * 7 + 3).padStart(2, "0")}`,
    brand_impressions: brand,
    brand_clicks: Math.round(brand / 10),
    nonbrand_impressions: 400,
    nonbrand_clicks: 20,
  });
  // 8 Montage: 13.07., 20.07., 27.07., 03.08., 10.08., 17.08., 24.08., 31.08.
  const rows = [100, 100, 100, 100, 120, 130, 110, 140].map((b, i) => woche(i, b));

  it("Wochen mit Anteil, Trend letzte 4 vs. vorherige 4 = +25 %", () => {
    const r = brandWochen(rows, ["fih"], { from: "2026-07-13", to: "2026-09-06" });
    expect(r.begriffe).toEqual(["fih"]);
    expect(r.wochen).toHaveLength(8);
    expect(r.wochen[0]).toEqual({
      wocheAb: "2026-07-13",
      brandImpressions: 100,
      brandClicks: 10,
      nonbrandImpressions: 400,
      nonbrandClicks: 20,
      brandAnteilProzent: 20,
    });
    expect(r.trendProzent).toBe(25);
  });

  it("unvollstaendige Randwochen zaehlen nicht fuer den Trend; < 8 Wochen → null", () => {
    // Zeitraum endet mitten in der letzten Woche → nur 7 vollstaendige Wochen
    expect(brandWochen(rows, [], { from: "2026-07-13", to: "2026-09-03" }).trendProzent).toBeNull();
    expect(brandWochen(rows.slice(0, 7), []).trendProzent).toBeNull();
    expect(brandWochen([], []).wochen).toEqual([]);
  });

  it("Trend null, wenn die Vorperiode keine Brand-Impressionen hat", () => {
    const r = brandWochen(
      [0, 0, 0, 0, 1, 2, 3, 4].map((b, i) => woche(i, b)),
      [],
    );
    expect(r.trendProzent).toBeNull();
  });
});

describe("didFenster", () => {
  it("Defaults 56/7/28: Prae endet am Vortag, Post beginnt nach dem Washout", () => {
    const f = didFenster("2026-08-01", undefined, undefined, undefined, "2026-09-22");
    expect(f).toEqual({
      prae: { from: "2026-06-06", to: "2026-07-31" },
      post: { from: "2026-08-08", to: "2026-09-04" },
      ladeVon: "2026-06-06",
      ladeBis: "2026-09-04",
    });
  });

  it("Post wird auf heute gekappt; Post-Beginn in der Zukunft → DidParamFehler", () => {
    const f = didFenster("2026-09-10", 14, 3, 28, "2026-09-22");
    expect(f.post).toEqual({ from: "2026-09-13", to: "2026-09-22" });
    expect(() => didFenster("2026-09-20", 14, 7, 28, "2026-09-22")).toThrow(DidParamFehler);
    expect(() => didFenster("20.09.2026")).toThrow(DidParamFehler);
  });
});

describe("bereiteDid", () => {
  const fenster = didFenster("2026-08-01", 7, 0, 7, "2026-09-22"); // prae 25.07–31.07, post 01.08–07.08
  const tag = (page: string, date: string, clicks: number): SeiteTagZeile => ({
    page,
    date,
    clicks,
    impressions: clicks * 10,
  });
  // Behandelt /blog/x: prae 100, post 150. Kontrolle wie in did.test (Ratios 1.2, 0.9, 1.1, 1.1)
  const zeilen: SeiteTagZeile[] = [
    tag("https://a.ch/blog/x", "2026-07-25", 60),
    tag("https://a.ch/blog/x", "2026-07-31", 40),
    tag("https://a.ch/blog/x", "2026-08-01", 150),
    tag("https://a.ch/blog/x", "2026-08-08", 999), // ausserhalb Post → ignoriert
    tag("https://a.ch/blog/a", "2026-07-26", 10),
    tag("https://a.ch/blog/a", "2026-08-02", 12),
    tag("https://a.ch/blog/b", "2026-07-26", 20),
    tag("https://a.ch/blog/b", "2026-08-02", 18),
    tag("https://a.ch/blog/c", "2026-07-26", 10),
    tag("https://a.ch/blog/c", "2026-08-02", 11),
    tag("https://a.ch/blog/d", "2026-07-26", 40),
    tag("https://a.ch/blog/d", "2026-08-02", 44),
    // andere Sektion: Ratio 3 — darf bei Sektions-Kontrolle NICHT einfliessen
    tag("https://a.ch/angebot/p", "2026-07-26", 100),
    tag("https://a.ch/angebot/p", "2026-08-02", 300),
    tag("https://a.ch/", "2026-07-26", 500),
    tag("https://a.ch/", "2026-08-02", 500),
  ];

  it("Kontrollgruppe = gleiches erstes Pfadsegment (sektion), gerundete Werte", () => {
    const r = bereiteDid({ pages: ["https://www.a.ch/blog/x/"], zeilen, fenster });
    expect(r.behandelt).toEqual({ seiten: 1, praeClicks: 100, postClicks: 150 });
    expect(r.kontrolle).toEqual({
      seiten: 4,
      quelle: "sektion",
      ratioMittel: 1.075,
      ratioSe: 0.0629,
    });
    expect(r.counterfactual).toBe(107.5);
    expect(r.lift).toBe(42.5);
    expect(r.liftLo).toBe(30.2);
    expect(r.liftHi).toBe(54.8);
    expect(r.verdikt).toBe("likely_positive");
    expect(r.fenster).toEqual({ prae: fenster.prae, post: fenster.post });
  });

  it("zu wenige Sektions-Kontrollen → sitewide (quelle site)", () => {
    const wenig = zeilen.filter((z) => !/blog\/(b|c|d)$/.test(z.page));
    const r = bereiteDid({ pages: ["https://a.ch/blog/x"], zeilen: wenig, fenster });
    expect(r.kontrolle.quelle).toBe("site");
    expect(r.kontrolle.seiten).toBe(3); // /blog/a, /angebot/p, /
    expect(r.verdikt).not.toBe("insufficient_control");
  });

  it("behandelte Seite ohne Daten → insufficient_data; Seiten zaehlen trotzdem", () => {
    const r = bereiteDid({
      pages: ["https://a.ch/gibt-es-nicht", "https://a.ch/auch-nicht"],
      zeilen,
      fenster,
    });
    expect(r.behandelt).toEqual({ seiten: 2, praeClicks: 0, postClicks: 0 });
    expect(r.verdikt).toBe("insufficient_data");
    expect(r.lift).toBeNull();
  });
});

describe("robots.txt", () => {
  it("ladeRobots: Erfolg liefert Text, Nicht-2xx/Fehler/Timeout sind fail-soft", async () => {
    const ok = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response("User-agent: *\nDisallow: /x\n", { status: 200 }),
    );
    expect(await ladeRobots("https://a.ch/robots.txt", ok)).toEqual({
      geladen: true,
      text: "User-agent: *\nDisallow: /x\n",
    });
    expect(ok.mock.calls[0][0]).toBe("https://a.ch/robots.txt");
    const nf = async () => new Response("nope", { status: 404 });
    expect(await ladeRobots("https://a.ch/robots.txt", nf)).toEqual({ geladen: false, text: "" });
    const kaputt = async () => {
      throw new Error("ECONNREFUSED");
    };
    expect(await ladeRobots("https://a.ch/robots.txt", kaputt)).toEqual({
      geladen: false,
      text: "",
    });
  });

  it("crawlerBlock: alle Bots, Status aus robots.txt; ohne Ladung alles unbestimmt", () => {
    const b = crawlerBlock("https://a.ch/robots.txt", true, "User-agent: GPTBot\nDisallow: /\n");
    expect(b.robotsUrl).toBe("https://a.ch/robots.txt");
    expect(b.geladen).toBe(true);
    expect(b.bots.length).toBeGreaterThanOrEqual(20);
    const gpt = b.bots.find((x) => x.name === "GPTBot")!;
    expect(gpt).toMatchObject({
      betreiber: "OpenAI",
      zweck: "training",
      status: "gesperrt",
      regel: "Disallow: /",
    });
    expect(gpt.empfehlung).toBeTruthy();
    expect(b.bots.find((x) => x.name === "OAI-SearchBot")!.status).toBe("unbestimmt");
    const ohne = crawlerBlock(null, false, "");
    expect(ohne.geladen).toBe(false);
    expect(new Set(ohne.bots.map((x) => x.status))).toEqual(new Set(["unbestimmt"]));
    expect(ohne.bots.every((x) => x.regel === null)).toBe(true);
  });
});
