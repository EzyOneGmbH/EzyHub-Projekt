import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import { parseGa4Organisch, rankVergleichbar, stichtagIso } from "./seo-overview.server";

describe("rankVergleichbar (Methodenwechsel-Guard)", () => {
  const lauf = (basis: string | undefined, ort: string | null = "Zurich,Zurich,Switzerland") => ({
    wert: basis ? { top3: 1, top10: 2, basis } : { top3: 1, top10: 2 },
    ort,
  });
  it("gleiche Zaehlbasis und gleicher Standort → vergleichbar", () => {
    expect(rankVergleichbar(lauf("crawl"), lauf("crawl"))).toBe(true);
  });
  it("alter Lauf ohne basis (Hybrid-Zaehlung vor 14.09.) → nicht vergleichbar", () => {
    expect(rankVergleichbar(lauf("crawl"), lauf(undefined))).toBe(false);
  });
  it("anderer Crawl-Standort oder andere Basis → nicht vergleichbar", () => {
    expect(rankVergleichbar(lauf("crawl"), lauf("crawl", "Switzerland"))).toBe(false);
    expect(rankVergleichbar(lauf("crawl"), lauf("gsc"))).toBe(false);
  });
  it("fehlende Laeufe → nicht vergleichbar", () => {
    expect(rankVergleichbar(null, lauf("crawl"))).toBe(false);
  });
});

const zeile = (land: string, range: string | null, n: number) => ({
  dimensionValues: range ? [{ value: land }, { value: range }] : [{ value: land }],
  metricValues: [{ value: String(n) }],
});

describe("parseGa4Organisch", () => {
  it("summiert je Zeitraum und trennt die Schweiz ab", () => {
    const p = parseGa4Organisch({
      dimensionHeaders: [{ name: "countryId" }, { name: "dateRange" }],
      rows: [
        zeile("CH", "date_range_0", 120),
        zeile("DE", "date_range_0", 30),
        zeile("ch", "date_range_1", 90),
        zeile("AT", "date_range_1", 10),
      ],
    });
    expect(p.cur).toEqual({ total: 150, ch: 120 });
    expect(p.prev).toEqual({ total: 100, ch: 90 });
  });
  it("ohne dateRange-Dimension zaehlt alles zum aktuellen Zeitraum", () => {
    const p = parseGa4Organisch({
      dimensionHeaders: [{ name: "countryId" }],
      rows: [zeile("CH", null, 5), zeile("FR", null, 2)],
    });
    expect(p.cur).toEqual({ total: 7, ch: 5 });
    expect(p.prev).toEqual({ total: 0, ch: 0 });
  });
  it("leere oder kaputte Antwort ergibt Nullen statt Fehler", () => {
    expect(parseGa4Organisch({})).toEqual({ cur: { total: 0, ch: 0 }, prev: { total: 0, ch: 0 } });
    expect(parseGa4Organisch(null)).toEqual({
      cur: { total: 0, ch: 0 },
      prev: { total: 0, ch: 0 },
    });
  });
});

describe("stichtagIso", () => {
  const jetzt = Date.parse("2026-09-29T10:00:00Z");
  it("Sommerzeit: Tagesende Zuerich = 21:59:59.999 UTC", () => {
    expect(stichtagIso("2026-09-20", jetzt)).toBe("2026-09-20T21:59:59.999Z");
  });
  it("Winterzeit: Tagesende Zuerich = 22:59:59.999 UTC", () => {
    expect(stichtagIso("2026-01-15", jetzt)).toBe("2026-01-15T22:59:59.999Z");
  });
  it("heute oder spaeter = neuester Lauf (null)", () => {
    expect(stichtagIso("2026-09-29", jetzt)).toBeNull();
    expect(stichtagIso("2026-10-05", jetzt)).toBeNull();
  });
});
