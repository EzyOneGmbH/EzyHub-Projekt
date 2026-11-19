// Tageswechsel im offenen Tab (19.11.2026): «letzte N Tage» rücken nach.
import { describe, expect, it } from "vitest";
import { isoDay, letzteTage, rolleZeitraum } from "./rangeStore";

describe("rolleZeitraum", () => {
  const gesternMittag = new Date(2026, 10, 18, 12, 0, 0); // 18.11.2026 lokal
  const heuteFrueh = new Date(2026, 10, 19, 0, 30, 0); // 19.11.2026 00:30 lokal
  const preset = (days: number, now: Date) => ({
    label: `Letzte ${days} Tage`,
    days,
    preset: "30d",
    ...letzteTage(days, now),
  });

  it("gleicher Tag: dasselbe Objekt (kein Re-Render, kein neuer Abruf)", () => {
    const r = preset(30, gesternMittag);
    expect(rolleZeitraum(r, new Date(2026, 10, 18, 23, 59, 0))).toBe(r);
  });

  it("nach Mitternacht: Ende = gestern, Länge und Bezeichnung bleiben", () => {
    const r = preset(30, gesternMittag);
    expect(isoDay(r.end)).toBe("2026-11-17");
    const neu = rolleZeitraum(r, heuteFrueh);
    expect(neu).not.toBe(r);
    expect(isoDay(neu.end as Date)).toBe("2026-11-18");
    expect(isoDay(neu.start as Date)).toBe("2026-10-20");
    expect(neu.days).toBe(30);
    expect(neu.label).toBe("Letzte 30 Tage");
  });

  it("mehrere Tage offen: springt direkt auf gestern", () => {
    const r = preset(7, new Date(2026, 10, 14, 9, 0, 0));
    const neu = rolleZeitraum(r, heuteFrueh);
    expect(isoDay(neu.end as Date)).toBe("2026-11-18");
    expect(isoDay(neu.start as Date)).toBe("2026-11-12");
  });

  it("eigener Zeitraum bleibt unverändert", () => {
    const r = {
      label: "Eigener Zeitraum",
      days: 10,
      preset: "custom",
      start: new Date(2026, 9, 1),
      end: new Date(2026, 9, 10),
    };
    expect(rolleZeitraum(r, heuteFrueh)).toBe(r);
  });

  it("Ende als ISO-Text (aus dem Speicher) wird verstanden", () => {
    const r = { days: 30, preset: "30d", end: new Date(2026, 10, 18, 8).toISOString() };
    expect(rolleZeitraum(r, heuteFrueh)).toBe(r);
  });
});
