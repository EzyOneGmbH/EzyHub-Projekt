import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("@/server/integrations.server", () => ({ isProviderEnabled: vi.fn() }));
vi.mock("@/server/google-ads.server", () => ({ fetchAdsSnapshot: vi.fn() }));

import { standardPresets, syncFenster, syncPresets, zuercherHeute } from "./google-ads-sync.server";

const ms = (iso: string) => Date.parse(iso);

describe("zuercherHeute", () => {
  it("nimmt das Schweizer Kalenderdatum (Sommerzeit)", () => {
    expect(zuercherHeute(ms("2026-10-06T21:30:00Z"))).toBe("2026-10-06");
    expect(zuercherHeute(ms("2026-10-06T22:30:00Z"))).toBe("2026-10-07");
  });
  it("nimmt das Schweizer Kalenderdatum (Winterzeit)", () => {
    expect(zuercherHeute(ms("2026-12-01T22:30:00Z"))).toBe("2026-12-01");
    expect(zuercherHeute(ms("2026-12-01T23:30:00Z"))).toBe("2026-12-02");
  });
});

describe("syncFenster", () => {
  it("entspricht dem Dashboard-Standard (30 Tage + Vorperiode)", () => {
    expect(syncFenster(30, ms("2026-10-06T13:20:00Z"))).toEqual({
      days: 30,
      startDate: "2026-09-07",
      endDate: "2026-10-06",
      compareStart: "2026-08-08",
      compareEnd: "2026-09-06",
    });
  });
  it("7 Tage inklusive heute", () => {
    const f = syncFenster(7, ms("2026-10-06T05:20:00Z"))!;
    expect([f.startDate, f.endDate, f.compareStart, f.compareEnd]).toEqual([
      "2026-09-30",
      "2026-10-06",
      "2026-09-23",
      "2026-09-29",
    ]);
  });
  it("liefert null, wenn der Schweizer Tag dem UTC-Tag voraus ist", () => {
    expect(syncFenster(30, ms("2026-10-06T22:30:00Z"))).toBeNull();
  });
  it("lehnt ungueltige Tage ab", () => {
    expect(syncFenster(0)).toBeNull();
    expect(syncFenster(1.5)).toBeNull();
    expect(syncFenster(400)).toBeNull();
  });
});

describe("syncPresets", () => {
  it("Standard: 30 + 7 immer, dazu abwechselnd 14 bzw. 90 Tage", () => {
    const a = standardPresets(ms("2026-10-06T17:20:00Z"));
    const b = standardPresets(ms("2026-10-06T21:20:00Z"));
    expect(a.slice(0, 2)).toEqual([30, 7]);
    expect(b.slice(0, 2)).toEqual([30, 7]);
    expect([a[2], b[2]].sort((x, y) => x - y)).toEqual([14, 90]);
    expect(syncPresets(undefined, ms("2026-10-06T17:20:00Z"))).toEqual(a);
    expect(syncPresets([], ms("2026-10-06T21:20:00Z"))).toEqual(b);
  });
  it("filtert Duplikate und Unsinn", () => {
    expect(syncPresets([30, "30", 7, -1, "x", 1000, 90])).toEqual([30, 7, 90]);
  });
});
