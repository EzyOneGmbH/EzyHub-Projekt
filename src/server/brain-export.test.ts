// EzyBrain-Spiegel: Markdown-Aufbau, Zahlenformat und was bewusst nicht im Vault landet.
import { describe, it, expect } from "vitest";
import { baueBrainSeiten, zahl, zelle, type BrainDaten } from "./brain-export";

const leer = (): BrainDaten => ({
  client: { id: "11111111-1111-4111-8111-111111111111", name: "Muster AG", domain: "muster.ch" },
  audits: {},
  rankDatum: null,
  rank: [],
  rankVorDatum: null,
  rankVor: [],
  opportunities: [],
  convEvents: [],
  convValues: [],
  convLabels: [],
  convLogDaten: [],
  aivReports: [],
  aivModels: [],
  aivSov: [],
  aivSources: [],
  aivCompetitors: [],
  aivAttribution: [],
  blogTopics: [],
  blogArticles: [],
  contentItems: [],
  siteHealth: null,
  facts: [],
});

const STAND = "2026-11-20T10:00:00.000Z";

describe("zahl / zelle", () => {
  it("setzt Schweizer Tausendertrennung", () => {
    expect(zahl(1234567)).toBe("1'234'567");
    expect(zahl(-1234.5, 1)).toBe("-1'234.5");
    expect(zahl("372695")).toBe("372'695");
    expect(zahl(null)).toBe("–");
    expect(zahl("abc")).toBe("–");
  });
  it("macht Zellen einzeilig und entschärft Pipes und Wiki-Links", () => {
    expect(zelle("a|b\nc")).toBe("a/b c");
    expect(zelle("[[system/geheim]]")).toBe("[ [system/geheim] ]");
    expect(zelle("x".repeat(200), 10)).toHaveLength(10);
    expect(zelle("")).toBe("–");
  });
});

describe("baueBrainSeiten", () => {
  it("liefert ohne Daten keine Seiten", () => {
    expect(baueBrainSeiten(leer(), STAND)).toEqual([]);
  });

  it("baut die Keyword-Seite mit Vergleich zum Vorwert", () => {
    const d = leer();
    d.rankDatum = "2026-11-20";
    d.rankVorDatum = "2026-10-23";
    d.rank = [
      { keyword: "seminarhotel", position: 4, url: "https://muster.ch/a", search_volume: 1900 },
      { keyword: "tagung zug", position: null, url: null, search_volume: 90, is_money: true },
      { keyword: "hotel baar", position: 2, url: "https://muster.ch/", search_volume: 320 },
    ];
    d.rankVor = [{ keyword: "seminarhotel", position: 9 }];
    const [s] = baueBrainSeiten(d, STAND);
    expect(s.key).toBe("keywords");
    expect(s.markdown).toContain("type: daten");
    expect(s.markdown).toContain("stand: 2026-11-20");
    expect(s.markdown).toContain("# Keywords: Muster AG");
    expect(s.markdown).toContain("Top 3: 1, Top 10: 2, Top 30: 2, ohne Platzierung: 1.");
    expect(s.markdown).toContain("| seminarhotel | 4 | 9 | +5 | 1'900 |  | https://muster.ch/a |");
    // Sortierung: beste Position zuerst, ohne Platzierung zuletzt.
    expect(s.markdown.indexOf("hotel baar")).toBeLessThan(s.markdown.indexOf("seminarhotel"));
    expect(s.markdown.indexOf("seminarhotel")).toBeLessThan(s.markdown.indexOf("tagung zug"));
  });

  it("baut Traffic und Conversions aus den Audit-Läufen", () => {
    const d = leer();
    d.audits.gsc_summary = {
      finished_at: null,
      result: {
        range: { from: "2026-10-18", to: "2026-11-14" },
        metrics: { clicks: 6810, impressions: 372695, ctr: 0.0183, position: 9.83 },
        topQueries: [
          { query: "muster", clicks: 272, impressions: 1980, ctr: 0.137, position: 1.7 },
        ],
      },
    };
    d.audits.ga4_conversions = {
      finished_at: null,
      result: {
        range: { from: "2026-10-20", to: "2026-11-16" },
        breakdown: { contact: 12, phone: 3, mail: 1, maps: 0 },
        events: [{ eventName: "lead", count: 12 }],
      },
    };
    const seiten = baueBrainSeiten(d, STAND);
    expect(seiten.map((s) => s.key)).toEqual(["traffic", "conversions"]);
    expect(seiten[0].markdown).toContain("Zeitraum 18.10.2026 bis 14.11.2026.");
    expect(seiten[0].markdown).toContain("| 6'810 | 372'695 | 1.83 % | 9.8 |");
    expect(seiten[1].markdown).toContain("| Kontakt | 12 |");
    expect(seiten[1].markdown).toContain("| lead | 12 |");
  });

  it("zählt das Conversion-Log nur pro Monat", () => {
    const d = leer();
    d.convLogDaten = ["2026-11-03", "2026-11-18", "2026-10-02"];
    const [s] = baueBrainSeiten(d, STAND);
    expect(s.key).toBe("conversions");
    expect(s.markdown).toContain("| 11.2026 | 2 |");
    expect(s.markdown).toContain("| 10.2026 | 1 |");
  });

  it("nimmt je Markt den neuesten KI-Bericht und nur dessen Detailzeilen", () => {
    const d = leer();
    d.aivReports = [
      {
        id: "r2",
        market: "CH",
        snapshot_date: "2026-11-20",
        score: 41,
        score_delta: 3,
        mentions: 12,
      },
      { id: "r1", market: "CH", snapshot_date: "2026-11-13", score: 38, mentions: 9 },
    ];
    d.aivModels = [
      { report_id: "r2", model_name: "Grok", mentions: 12, sov: 20 },
      { report_id: "r1", model_name: "Altmodell", mentions: 99, sov: 50 },
    ];
    d.aivAttribution = [{ report_id: "r2", engine: "chatgpt", sessions: 14, conversions: 2 }];
    const [s] = baueBrainSeiten(d, STAND);
    expect(s.key).toBe("ki-sichtbarkeit");
    expect(s.markdown).toContain("| CH | 20.11.2026 | 41 | +3 | 12 |");
    expect(s.markdown).toContain("Grok");
    expect(s.markdown).not.toContain("Altmodell");
    expect(s.markdown).toContain("| CH | chatgpt | 14 | 2 |");
    expect(s.markdown).toContain("## Verlauf (CH)");
  });

  it("schreibt Inhalte und Kundenfakten ohne Artikeltext", () => {
    const d = leer();
    d.blogArticles = [
      { title: "Seminar planen", status: "published", focus_keyword: "seminar", word_count: 1800 },
    ];
    d.facts = [{ label: "Zimmer", value: "39 Zimmer | im Haus", verified_at: "2026-11-01" }];
    const [s] = baueBrainSeiten(d, STAND);
    expect(s.key).toBe("content");
    expect(s.markdown).toContain("| Seminar planen | published | seminar | 1'800 |");
    expect(s.markdown).toContain("| Zimmer | 39 Zimmer / im Haus | 01.11.2026 |");
  });
});
