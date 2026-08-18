// Tests für die Datenstatus-Helfer (2026-08-18).
import { describe, expect, it } from "vitest";
import { fmtStand, runStatusItem, stateFromDate } from "./dataStatus";

describe("stateFromDate", () => {
  it("liefert none ohne Zeitstempel (nie erfundene Werte)", () => {
    expect(stateFromDate(null)).toBe("none");
    expect(stateFromDate(undefined)).toBe("none");
    expect(stateFromDate("kein datum")).toBe("none");
  });
  it("liefert ok innerhalb von staleDays", () => {
    const gestern = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(stateFromDate(gestern, 3)).toBe("ok");
  });
  it("liefert stale nach Ablauf von staleDays", () => {
    const vor10Tagen = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(stateFromDate(vor10Tagen, 8)).toBe("stale");
    expect(stateFromDate(vor10Tagen, 30)).toBe("ok");
  });
});

describe("fmtStand", () => {
  it("liefert null ohne oder mit ungültigem Datum", () => {
    expect(fmtStand(null)).toBeNull();
    expect(fmtStand("quatsch")).toBeNull();
  });
  it("zeigt reine Datums-Strings ohne Uhrzeit", () => {
    expect(fmtStand("2026-08-17")).toBe("17.08.2026");
  });
  it("zeigt ISO-Zeitstempel mit Uhrzeit", () => {
    const s = fmtStand("2026-08-17T09:30:00.000Z");
    expect(s).toMatch(/^17\.08\.2026, \d{2}:\d{2}$/);
  });
});

describe("runStatusItem", () => {
  it("übernimmt created_at der audit_runs-Zeile", () => {
    const item = runStatusItem("GSC", { created_at: "2026-08-17T05:00:00Z" }, { staleDays: 3 });
    expect(item.lastAt).toBe("2026-08-17T05:00:00Z");
    expect(item.staleDays).toBe(3);
  });
  it("liefert lastAt null ohne Lauf — Status wird dann none", () => {
    expect(runStatusItem("GA4", null).lastAt).toBeNull();
  });
});
