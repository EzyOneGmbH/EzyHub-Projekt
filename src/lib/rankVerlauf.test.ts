import { describe, expect, it } from "vitest";
import { rankVerlauf, tagZuerich, waehleLaeufe } from "./rankVerlauf";

describe("waehleLaeufe", () => {
  it("nimmt je Tag den letzten Rankings-Lauf und den GSC-Lauf davor", () => {
    const rankings = [
      { id: "r1", created_at: "2026-10-01T05:00:00Z" },
      { id: "r2", created_at: "2026-10-01T15:00:00Z" },
      { id: "r3", created_at: "2026-10-03T05:00:00Z" },
    ];
    const gsc = [
      { id: "g2", created_at: "2026-10-02T04:00:00Z" },
      { id: "g1", created_at: "2026-10-01T04:00:00Z" },
    ];
    expect(waehleLaeufe(rankings, gsc)).toEqual([
      { date: "2026-10-01", rankingId: "r2", gscId: "g1" },
      { date: "2026-10-03", rankingId: "r3", gscId: "g2" },
    ]);
  });

  it("ohne früheren GSC-Lauf: gscId null", () => {
    const r = waehleLaeufe(
      [{ id: "r1", created_at: "2026-10-01T05:00:00Z" }],
      [{ id: "g1", created_at: "2026-10-05T05:00:00Z" }],
    );
    expect(r[0].gscId).toBeNull();
  });

  it("Tag in Zürcher Zeit", () => {
    expect(tagZuerich("2026-10-01T23:30:00Z")).toBe("2026-10-02");
  });
});

describe("rankVerlauf", () => {
  it("zählt wie die Kacheln (getrackt + nicht getrackte GSC-Queries)", () => {
    const pkt = rankVerlauf(
      [
        { date: "2026-10-01", rankingId: "r1", gscId: "g1" },
        { date: "2026-10-02", rankingId: "leer", gscId: null },
      ],
      new Map([
        [
          "r1",
          [
            { kw: "hotel bern", pos: 2 },
            { kw: "spa bern", pos: 8 },
          ],
        ],
        ["leer", []],
      ]),
      new Map([
        [
          "g1",
          [
            { query: "hotel bern", position: 9 },
            { query: "wellness bern", position: 3 },
          ],
        ],
      ]),
    );
    expect(pkt).toEqual([{ date: "2026-10-01", top3: 2, top10: 3 }]);
  });
});
