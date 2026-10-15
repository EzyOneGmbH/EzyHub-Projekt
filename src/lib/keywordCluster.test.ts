import { describe, expect, it } from "vitest";
import { clusterEingabe, clusterKennzahlen, parseKiCluster } from "./keywordCluster";

describe("keywordCluster", () => {
  const eingabe = clusterEingabe(
    [
      { kw: "Hotel Davos", pos: 3, url: "https://x.ch/", volume: 900 },
      { kw: "hotel davos spa", pos: 8, url: "https://x.ch/spa", volume: 200 },
      { kw: "wellness davos", pos: 15, url: "https://x.ch/wellness", volume: 300 },
      { kw: "seminarhotel davos", pos: null, url: null, volume: 150 },
    ],
    [
      { query: "hotel davos", impressions: 5000, clicks: 300, position: 2.6 },
      {
        query: "seminarraum davos",
        impressions: 400,
        clicks: 2,
        position: 34,
        pageUrl: "https://x.ch/seminar",
      },
    ],
  );

  it("vereint Ranking und GSC ohne Duplikate", () => {
    expect(eingabe.map((e) => e.kw)).toContain("seminarraum davos");
    expect(eingabe.filter((e) => e.kw === "hotel davos")).toHaveLength(1);
    expect(eingabe.find((e) => e.kw === "hotel davos")).toMatchObject({
      pos: 3,
      impressions: 5000,
    });
  });

  it("liest KI-Antwort robust", () => {
    const ki = parseKiCluster(
      'Hier die Cluster:\n```json\n[{"name":"Wellness","intent":"Commercial","keywords":["Hotel Davos Spa","wellness davos"]},{"name":"Leer","intent":"x","keywords":[]}]\n```',
    );
    expect(ki).toEqual([
      {
        name: "Wellness",
        intent: "commercial",
        keywords: ["hotel davos spa", "wellness davos"],
        hinweis: undefined,
      },
    ]);
    expect(parseKiCluster("kein json")).toEqual([]);
  });

  it("rechnet Kannibalisierung und Luecken selbst", () => {
    const c = clusterKennzahlen(
      [
        {
          name: "Wellness",
          intent: "commercial",
          keywords: ["hotel davos spa", "wellness davos", "erfunden"],
        },
        {
          name: "Seminar",
          intent: "transactional",
          keywords: ["seminarhotel davos", "seminarraum davos"],
        },
        { name: "Doppelt", intent: "local", keywords: ["wellness davos"] },
      ],
      eingabe,
    );
    expect(c).toHaveLength(2); // «Doppelt» hat kein freies Keyword mehr
    const w = c.find((x) => x.name === "Wellness")!;
    expect(w).toMatchObject({
      anzahl: 2,
      volumen: 500,
      bestePos: 8,
      kannibalisierung: true,
      luecke: false,
    });
    const s = c.find((x) => x.name === "Seminar")!;
    expect(s).toMatchObject({ luecke: true, kannibalisierung: false, bestePos: 34 });
  });
});
