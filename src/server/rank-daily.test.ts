// rank_daily-Mapper (Read-API, 28.09.2026): rankDailyZeilen() baut aus dem
// Snapshot-Result (baueSnapshotResult) die flachen rank_daily-Zeilen.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import { baueSnapshotResult, rankDailyZeilen } from "../routes/api/admin.rank-snapshot";

const CTX = {
  clientId: "11111111-1111-4111-8111-111111111111",
  organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  date: "2026-09-27",
};
const AGG = {
  tracked: 0,
  top3: 0,
  top10: 0,
  pos11to20: 0,
  notRanking: 0,
  improved7: 0,
  declined7: 0,
  avgPos: null,
};

describe("rankDailyZeilen", () => {
  it("mappt Keyword-Felder und Messkontext", () => {
    const result = baueSnapshotResult({
      date: CTX.date,
      aggregate: AGG,
      country: "DE",
      language: "de",
      device: "mobile",
      method: "hybrid",
      measuredAt: "2026-09-27T04:10:00Z",
      keywords: [
        {
          kw: " hotel luzern ",
          pos: 3,
          posSrc: "crawl",
          posLocal: 2,
          url: "https://a.ch/",
          volume: 1300,
          isMoney: true,
        },
        { kw: "seminar luzern", pos: null, posSrc: "gsc" },
      ],
    });
    const z = rankDailyZeilen(result, CTX);
    expect(z).toHaveLength(2);
    expect(z[0]).toEqual({
      client_id: CTX.clientId,
      organization_id: CTX.organizationId,
      date: CTX.date,
      keyword: "hotel luzern",
      position: 3,
      pos_src: "crawl",
      local_pos: 2,
      url: "https://a.ch/",
      search_volume: 1300,
      is_money: true,
      device: "mobile",
      country: "DE",
      language: "de",
      method: "hybrid",
      measured_at: "2026-09-27T04:10:00Z",
    });
    expect(z[1]).toMatchObject({
      keyword: "seminar luzern",
      position: null,
      pos_src: "gsc",
      local_pos: null,
      url: null,
      search_volume: null,
      is_money: false,
    });
  });

  it("setzt Defaults (desktop/CH) ohne Messkontext und ignoriert ungueltige Werte", () => {
    const z = rankDailyZeilen(
      {
        keywords: [
          { kw: "a", pos: 0, posSrc: "sonstwas", volume: -5, isMoney: "ja" },
          { kw: "b", pos: 12.345, volume: 99.6 },
          { kw: "", pos: 1 },
          { pos: 1 },
          null,
          "kaputt",
        ],
        measurement: { measuredAt: "kein-datum" },
      },
      CTX,
    );
    expect(z.map((r) => r.keyword)).toEqual(["a", "b"]);
    expect(z[0]).toMatchObject({
      position: null,
      pos_src: null,
      search_volume: null,
      is_money: false,
      device: "desktop",
      country: "CH",
      language: null,
      method: null,
      measured_at: null,
    });
    expect(z[1].position).toBe(12.35);
    expect(z[1].search_volume).toBe(100);
  });

  it("entfernt doppelte Keywords (erstes gewinnt) — Upsert trifft jede Zeile nur einmal", () => {
    const z = rankDailyZeilen(
      {
        keywords: [
          { kw: "x", pos: 4 },
          { kw: "x ", pos: 9 },
        ],
      },
      CTX,
    );
    expect(z).toHaveLength(1);
    expect(z[0].position).toBe(4);
  });

  it("liefert [] ohne keywords-Array", () => {
    expect(rankDailyZeilen({}, CTX)).toEqual([]);
    expect(rankDailyZeilen({ keywords: "nein" }, CTX)).toEqual([]);
  });
});

describe("rankDailyZeilen: Platzhalter", () => {
  it("ueberspringt Test-Platzhalter wie __format_test_kw__", () => {
    const z = rankDailyZeilen(
      {
        keywords: [
          { kw: "__format_test_kw__", pos: null },
          { kw: "echtes keyword", pos: 4 },
        ],
      } as any,
      { clientId: "c1", organizationId: "o1", date: "2026-09-28" },
    );
    expect(z.map((r) => r.keyword)).toEqual(["echtes keyword"]);
  });
});
