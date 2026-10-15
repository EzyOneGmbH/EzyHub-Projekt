import { describe, expect, it } from "vitest";
import { ctrBeiPosition, strikingDistance } from "./strikingDistance";

describe("strikingDistance", () => {
  it("nimmt nur Position 5–20 und sortiert nach Potenzial", () => {
    const rows = [
      { query: "hotel bern", position: 2, impressions: 5000, clicks: 700 }, // zu gut
      { query: "spa bern", position: 7.4, impressions: 1000, clicks: 30, pageUrl: "/spa" },
      { query: "seminar bern", position: 15, impressions: 3000, clicks: 20 },
      { query: "Spa Bern", position: 8, impressions: 999, clicks: 1 }, // Duplikat
      { query: "weit weg", position: 35, impressions: 9000, clicks: 0 },
    ];
    const r = strikingDistance(rows, new Set(["spa bern"]));
    expect(r.map((x) => x.query)).toEqual(["seminar bern", "spa bern"]);
    expect(r[0].potenzial).toBe(270); // 3000 × (0.10 − 0.01)
    expect(r[1]).toMatchObject({ potenzial: 70, getrackt: true, pageUrl: "/spa", position: 7.4 });
  });

  it("CTR-Kurve", () => {
    expect(ctrBeiPosition(3)).toBe(0.1);
    expect(ctrBeiPosition(12.6)).toBe(0.01);
    expect(ctrBeiPosition(40)).toBe(0.005);
  });
});
