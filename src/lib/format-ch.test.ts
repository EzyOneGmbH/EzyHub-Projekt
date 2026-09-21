// Schweizer Zahlenformat (First-Party-KPIs Phase 3): ASCII-Apostroph als
// Tausendertrennzeichen — NICHT das U+2019 von Intl «de-CH».
import { describe, it, expect } from "vitest";
import { fmtCH, fmtPct, KEIN_WERT } from "./format-ch";

describe("fmtCH", () => {
  it("gruppiert Tausender mit ASCII-Apostroph (nie U+2019)", () => {
    expect(fmtCH(1234567)).toBe("1'234'567");
    expect(fmtCH(1234)).toBe("1'234");
    expect(fmtCH(999)).toBe("999");
    expect(fmtCH(0)).toBe("0");
    expect(fmtCH(1234567)).not.toContain("’");
  });

  it("Dezimaltrennzeichen ist der Punkt, feste Nachkommastellen", () => {
    expect(fmtCH(1234.5678, 2)).toBe("1'234.57");
    expect(fmtCH(3, 1)).toBe("3.0");
    expect(fmtCH(0.1 + 0.2, 1)).toBe("0.3");
    expect(fmtCH(12.34)).toBe("12");
  });

  it("negative Werte, kein «-0»", () => {
    expect(fmtCH(-1234.5, 1)).toBe("-1'234.5");
    expect(fmtCH(-0.04, 1)).toBe("0.0");
  });

  it("null/undefined/leer/NaN → «–»; numerische Strings werden akzeptiert", () => {
    expect(fmtCH(null)).toBe(KEIN_WERT);
    expect(fmtCH(undefined)).toBe("–");
    expect(fmtCH("")).toBe("–");
    expect(fmtCH(Number.NaN)).toBe("–");
    expect(fmtCH("abc")).toBe("–");
    expect(fmtCH("12345")).toBe("12'345");
    expect(fmtCH("12.5", 1)).toBe("12.5");
  });
});

describe("fmtPct", () => {
  it("haengt « %» an (geschuetztes Leerzeichen), Default 1 Nachkommastelle", () => {
    expect(fmtPct(12.34)).toBe("12.3 %");
    expect(fmtPct(12.34, 1)).toBe("12.3 %");
    expect(fmtPct(0.5 * 100, 0)).toBe("50 %");
    expect(fmtPct(1234.56, 2)).toBe("1'234.56 %");
  });

  it("null/undefined → «–» ohne Prozentzeichen", () => {
    expect(fmtPct(null)).toBe("–");
    expect(fmtPct(undefined)).toBe("–");
    expect(fmtPct("x")).toBe("–");
  });
});
