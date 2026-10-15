import { describe, expect, it } from "vitest";
import { rankTabellenPositionen, zaehleRankKacheln } from "./rankKacheln";

describe("zaehleRankKacheln", () => {
  it("zaehlt getrackte Positionen und nicht getrackte GSC-Queries", () => {
    const kws = [
      { kw: "Hotel Bern", pos: 2 },
      { kw: "spa bern", pos: 7 },
      { kw: "nicht gefunden", pos: null },
    ];
    const gsc = [
      { query: "hotel bern", position: 1 }, // schon getrackt -> ignoriert
      { query: "wellness bern", position: 3.4 },
      { query: "seminar bern", position: 12, dfsPos: 9 },
      { query: "  WELLNESS bern ", position: 2 }, // Duplikat
    ];
    expect(rankTabellenPositionen(kws, gsc)).toEqual([2, 7, null, 3.4, 9]);
    expect(zaehleRankKacheln(kws, gsc)).toEqual({ top3: 1, top10: 4 });
  });

  it("null ohne Daten", () => {
    expect(zaehleRankKacheln([], [])).toBeNull();
    expect(zaehleRankKacheln(null, undefined)).toBeNull();
  });
});
