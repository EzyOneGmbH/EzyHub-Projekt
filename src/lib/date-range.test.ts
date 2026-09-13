// Zeitraum-Vereinheitlichung (13.09.2026): inklusive Kalendertage, kein
// Off-by-one, Monats-/Jahresgrenzen, Schaltjahre, exakte Custom-Ranges.
import { describe, it, expect } from "vitest";
import {
  zeitraum,
  zeitraumAusParams,
  vorperiode,
  tageInklusiv,
  addDays,
  istYmd,
  gaqlBetween,
  ga4DateRange,
  ZeitraumFehler,
} from "./date-range";

const T = (ymd: string) => Date.parse(`${ymd}T12:00:00Z`);

describe("«letzte N Tage» = genau N Kalendertage (inklusiv)", () => {
  it.each([
    [1, "2026-09-13", "2026-09-13"],
    [7, "2026-09-07", "2026-09-13"],
    [28, "2026-08-17", "2026-09-13"],
    [30, "2026-08-15", "2026-09-13"],
  ])("days=%i → %s..%s", (days, start, end) => {
    const z = zeitraum({ days, jetztMs: T("2026-09-13") });
    expect(z).toEqual({ startDate: start, endDate: end, days, quelle: "days" });
    expect(tageInklusiv(z.startDate, z.endDate)).toBe(days);
  });

  it("frueheres «heute minus N» haette N+1 Tage geliefert — jetzt nicht mehr", () => {
    const z = zeitraum({ days: 28, jetztMs: T("2026-09-13") });
    // 2026-08-16 waere der 29. Tag (alte Berechnung); er ist NICHT enthalten.
    expect(z.startDate > "2026-08-16").toBe(true);
    expect(tageInklusiv("2026-08-16", "2026-09-13")).toBe(29);
  });

  it("Monatsgrenze: 1. des Monats", () => {
    expect(zeitraum({ days: 1, jetztMs: T("2026-03-01") })).toMatchObject({
      startDate: "2026-03-01",
      endDate: "2026-03-01",
    });
    expect(zeitraum({ days: 2, jetztMs: T("2026-03-01") })).toMatchObject({
      startDate: "2026-02-28",
      endDate: "2026-03-01",
    });
    expect(zeitraum({ days: 31, jetztMs: T("2026-05-31") }).startDate).toBe("2026-05-01");
    expect(zeitraum({ days: 30, jetztMs: T("2026-04-30") }).startDate).toBe("2026-04-01");
  });

  it("Jahresgrenze", () => {
    expect(zeitraum({ days: 7, jetztMs: T("2027-01-03") })).toMatchObject({
      startDate: "2026-12-28",
      endDate: "2027-01-03",
    });
  });

  it("Schaltjahr: 29. Februar wird korrekt gezaehlt", () => {
    expect(zeitraum({ days: 2, jetztMs: T("2024-03-01") })).toMatchObject({
      startDate: "2024-02-29",
      endDate: "2024-03-01",
    });
    expect(zeitraum({ days: 2, jetztMs: T("2023-03-01") })).toMatchObject({
      startDate: "2023-02-28",
      endDate: "2023-03-01",
    });
    expect(tageInklusiv("2024-02-01", "2024-02-29")).toBe(29);
    expect(tageInklusiv("2024-01-01", "2024-12-31")).toBe(366);
    expect(tageInklusiv("2023-01-01", "2023-12-31")).toBe(365);
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2023-02-28", 1)).toBe("2023-03-01");
    expect(istYmd("2023-02-29")).toBe(false);
    expect(istYmd("2024-02-29")).toBe(true);
  });

  it("Datenpuffer (GSC-Lag 3 Tage): Ende = heute-3, trotzdem genau N Tage", () => {
    const z = zeitraum({ days: 28, endLagDays: 3, jetztMs: T("2026-09-13") });
    expect(z.endDate).toBe("2026-09-10");
    expect(z.startDate).toBe("2026-08-14");
    expect(z.days).toBe(28);
  });

  it("Default und Grenzen", () => {
    expect(zeitraum({ jetztMs: T("2026-09-13") }).days).toBe(28);
    expect(zeitraum({ defaultDays: 30, jetztMs: T("2026-09-13") }).days).toBe(30);
    expect(() => zeitraum({ days: 0 })).toThrow(ZeitraumFehler);
    expect(() => zeitraum({ days: 400 })).toThrow(ZeitraumFehler);
    expect(() => zeitraum({ days: 91, maxDays: 90 })).toThrow(/zwischen 1 und 90/);
    expect(() => zeitraum({ days: "abc" })).toThrow(ZeitraumFehler);
  });
});

describe("historische Custom-Ranges werden EXAKT uebernommen", () => {
  it("Start und Ende bleiben unveraendert, Tage inklusiv gezaehlt", () => {
    const z = zeitraum({
      startDate: "2025-05-10",
      endDate: "2025-06-09",
      jetztMs: T("2026-09-13"),
    });
    expect(z).toEqual({
      startDate: "2025-05-10",
      endDate: "2025-06-09",
      days: 31,
      quelle: "custom",
    });
  });

  it("eintaegiger Custom-Range", () => {
    expect(zeitraum({ startDate: "2025-02-28", endDate: "2025-02-28" }).days).toBe(1);
  });

  it("Custom-Range ueber Schaltjahr-Februar", () => {
    expect(zeitraum({ startDate: "2024-02-01", endDate: "2024-03-01" }).days).toBe(30);
    expect(zeitraum({ startDate: "2023-02-01", endDate: "2023-03-01" }).days).toBe(29);
  });

  it("Custom hat Vorrang vor days — days wird NICHT stillschweigend genutzt", () => {
    const z = zeitraum({ startDate: "2025-01-01", endDate: "2025-01-31", days: 7 });
    expect(z.days).toBe(31);
    expect(z.quelle).toBe("custom");
  });

  it("Fehler statt Naeherung: nur ein Ende, verdreht, Zukunft, zu lang, kaputt", () => {
    expect(() => zeitraum({ startDate: "2025-01-01" })).toThrow(ZeitraumFehler);
    expect(() => zeitraum({ startDate: "2025-02-01", endDate: "2025-01-01" })).toThrow(
      /nach endDate/,
    );
    expect(() =>
      zeitraum({ startDate: "2026-09-10", endDate: "2026-09-20", jetztMs: T("2026-09-13") }),
    ).toThrow(/Zukunft/);
    expect(() =>
      zeitraum({ startDate: "2024-01-01", endDate: "2025-01-05", maxDays: 366 }),
    ).toThrow(/zu lang/);
    expect(() => zeitraum({ startDate: "2025-13-01", endDate: "2025-13-02" })).toThrow(
      ZeitraumFehler,
    );
    expect(() => zeitraum({ startDate: "2025-02-30", endDate: "2025-03-01" })).toThrow(
      ZeitraumFehler,
    );
  });

  it("URL-Parameter: startDate/endDate, start/end, from/to; sonst days", () => {
    const sp = new URLSearchParams("start=2025-03-01&end=2025-03-31&days=7");
    expect(zeitraumAusParams(sp)).toMatchObject({
      startDate: "2025-03-01",
      endDate: "2025-03-31",
      days: 31,
    });
    expect(zeitraumAusParams(new URLSearchParams("from=2025-03-01&to=2025-03-02")).days).toBe(2);
    expect(
      zeitraumAusParams(new URLSearchParams("days=7"), { jetztMs: T("2026-09-13") }),
    ).toMatchObject({
      startDate: "2026-09-07",
      endDate: "2026-09-13",
    });
    expect(zeitraumAusParams({ days: 30 }, { jetztMs: T("2026-09-13") }).days).toBe(30);
  });
});

describe("Vorperiode und API-Formate", () => {
  it("Vorperiode ist gleich lang und schliesst nahtlos an", () => {
    const z = zeitraum({ days: 7, jetztMs: T("2026-09-13") });
    const v = vorperiode(z);
    expect(v).toMatchObject({ startDate: "2026-08-31", endDate: "2026-09-06", days: 7 });
    expect(addDays(v.endDate, 1)).toBe(z.startDate);
    // 28 Tage ueber die Monatsgrenze
    const v28 = vorperiode(zeitraum({ days: 28, jetztMs: T("2026-09-13") }));
    expect(v28).toMatchObject({ startDate: "2026-07-20", endDate: "2026-08-16", days: 28 });
  });

  it("GA4 bekommt explizite Daten (nie NdaysAgo/today), GAQL ein BETWEEN", () => {
    const z = zeitraum({ startDate: "2025-01-01", endDate: "2025-01-31" });
    expect(ga4DateRange(z)).toEqual({ startDate: "2025-01-01", endDate: "2025-01-31" });
    expect(gaqlBetween(z)).toBe("segments.date BETWEEN '2025-01-01' AND '2025-01-31'");
  });
});
