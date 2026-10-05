import { describe, expect, it } from "vitest";
import { seoHistoryGuardAb } from "./seoHistoryGuard";

const lauf = (letzter: Date, jetzt: Date) =>
  letzter.getTime() >= seoHistoryGuardAb(jetzt).getTime();

describe("seoHistoryGuardAb", () => {
  it("Lauf vom 10.09. ist am 05.10. nicht mehr frisch (September fehlt sonst)", () => {
    expect(lauf(new Date(2026, 8, 10), new Date(2026, 9, 5))).toBe(false);
  });
  it("Lauf vom 03.10. ist im Oktober frisch", () => {
    expect(lauf(new Date(2026, 9, 3, 6), new Date(2026, 9, 28))).toBe(true);
  });
  it("am 01./02. gilt noch der Vormonats-Lauf (Daten noch nicht fertig)", () => {
    expect(lauf(new Date(2026, 8, 10), new Date(2026, 9, 2))).toBe(true);
    expect(lauf(new Date(2026, 8, 1), new Date(2026, 9, 2))).toBe(false);
  });
  it("Jahreswechsel", () => {
    expect(seoHistoryGuardAb(new Date(2027, 0, 1))).toEqual(new Date(2026, 11, 3));
  });
});
