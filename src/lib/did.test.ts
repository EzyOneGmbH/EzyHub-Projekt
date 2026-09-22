// Difference-in-Differences (22.09.2026): Beispielzahlen von Hand gerechnet.
//
// Kontrolle A 10→12 (1.2), B 20→18 (0.9), C 10→11 (1.1), D 40→44 (1.1)
//   mean = 4.3/4 = 1.075
//   Abweichungen 0.125, -0.175, 0.025, 0.025 → Quadratsumme 0.0475
//   var(n-1) = 0.0475/3 = 0.0158333, sd = 0.125831, se = sd/2 = 0.0629153
//   ratioLo = 1.075 - 1.96*0.0629153 = 0.951686, ratioHi = 1.198314
// Behandelt prae 100 → counterfactual 107.5, cfLo 95.1686, cfHi 119.8314
import { describe, it, expect } from "vitest";
import { differenceInDifferences, mittel, stdevStichprobe } from "./did";

const KONTROLLE = new Map([
  ["/blog/a", { prae: 10, post: 12 }],
  ["/blog/b", { prae: 20, post: 18 }],
  ["/blog/c", { prae: 10, post: 11 }],
  ["/blog/d", { prae: 40, post: 44 }],
]);

describe("Hilfsfunktionen", () => {
  it("mittel und Stichproben-Standardabweichung", () => {
    expect(mittel([1.2, 0.9, 1.1, 1.1])).toBeCloseTo(1.075, 10);
    expect(stdevStichprobe([1.2, 0.9, 1.1, 1.1])).toBeCloseTo(0.125831, 5);
    expect(stdevStichprobe([1])).toBe(0);
  });
});

describe("differenceInDifferences", () => {
  it("positiv: prae 100 → post 150 gegen Kontrolle x1.075", () => {
    const r = differenceInDifferences({
      behandelt: new Map([["/blog/x", { prae: 100, post: 150 }]]),
      kontrolle: KONTROLLE,
    });
    expect(r.behandelt).toEqual({ seiten: 1, praeClicks: 100, postClicks: 150 });
    expect(r.kontrolle.seiten).toBe(4);
    expect(r.kontrolle.ratioMittel).toBeCloseTo(1.075, 6);
    expect(r.kontrolle.ratioSe).toBeCloseTo(0.0629153, 5);
    expect(r.kontrolle.ratioLo).toBeCloseTo(0.951686, 4);
    expect(r.kontrolle.ratioHi).toBeCloseTo(1.198314, 4);
    expect(r.counterfactual).toBeCloseTo(107.5, 6);
    expect(r.lift).toBeCloseTo(42.5, 6);
    expect(r.liftLo).toBeCloseTo(30.1686, 3);
    expect(r.liftHi).toBeCloseTo(54.8314, 3);
    expect(r.verdikt).toBe("likely_positive");
  });

  it("negativ: post 80 → liftHi < 0", () => {
    const r = differenceInDifferences({
      behandelt: new Map([["/blog/x", { prae: 100, post: 80 }]]),
      kontrolle: KONTROLLE,
    });
    expect(r.lift).toBeCloseTo(-27.5, 6);
    expect(r.liftLo).toBeCloseTo(-39.8314, 3);
    expect(r.liftHi).toBeCloseTo(-15.1686, 3);
    expect(r.verdikt).toBe("likely_negative");
  });

  it("inconclusive: post 110 → Intervall schliesst 0 ein", () => {
    const r = differenceInDifferences({
      behandelt: new Map([["/blog/x", { prae: 100, post: 110 }]]),
      kontrolle: KONTROLLE,
    });
    expect(r.lift).toBeCloseTo(2.5, 6);
    expect(r.liftLo).toBeLessThan(0);
    expect(r.liftHi).toBeGreaterThan(0);
    expect(r.verdikt).toBe("inconclusive");
  });

  it("mehrere behandelte Seiten werden summiert", () => {
    const r = differenceInDifferences({
      behandelt: new Map([
        ["/x", { prae: 60, post: 90 }],
        ["/y", { prae: 40, post: 60 }],
      ]),
      kontrolle: KONTROLLE,
    });
    expect(r.behandelt).toEqual({ seiten: 2, praeClicks: 100, postClicks: 150 });
    expect(r.lift).toBeCloseTo(42.5, 6);
  });

  it("Kontrollseiten mit prae < minPraeClicks fallen weg (Ratio instabil)", () => {
    const k = new Map(KONTROLLE);
    k.set("/blog/klein", { prae: 3, post: 30 }); // Ratio 10 — wuerde alles verzerren
    const r = differenceInDifferences({
      behandelt: new Map([["/blog/x", { prae: 100, post: 150 }]]),
      kontrolle: k,
    });
    expect(r.kontrolle.seiten).toBe(4);
    expect(r.kontrolle.ratioMittel).toBeCloseTo(1.075, 6);
    // Schwelle konfigurierbar: mit minPraeClicks 3 zaehlt die Seite mit
    const r2 = differenceInDifferences({
      behandelt: new Map([["/blog/x", { prae: 100, post: 150 }]]),
      kontrolle: k,
      minPraeClicks: 3,
    });
    expect(r2.kontrolle.seiten).toBe(5);
  });

  it("insufficient_control bei weniger als 3 gueltigen Kontrollseiten", () => {
    const r = differenceInDifferences({
      behandelt: new Map([["/x", { prae: 100, post: 150 }]]),
      kontrolle: new Map([
        ["/a", { prae: 10, post: 12 }],
        ["/b", { prae: 2, post: 5 }],
        ["/c", { prae: 20, post: 18 }],
      ]),
    });
    expect(r.verdikt).toBe("insufficient_control");
    expect(r.kontrolle).toEqual({
      seiten: 2,
      ratioMittel: null,
      ratioSe: null,
      ratioLo: null,
      ratioHi: null,
    });
    expect(r.lift).toBeNull();
    expect(r.counterfactual).toBeNull();
    // minKontrollen konfigurierbar
    expect(
      differenceInDifferences({
        behandelt: new Map([["/x", { prae: 100, post: 150 }]]),
        kontrolle: new Map([
          ["/a", { prae: 10, post: 12 }],
          ["/c", { prae: 20, post: 18 }],
        ]),
        minKontrollen: 2,
      }).verdikt,
    ).not.toBe("insufficient_control");
  });

  it("insufficient_data ohne Prae-Klicks der behandelten Seiten (hat Vorrang vor Kontrolle)", () => {
    expect(
      differenceInDifferences({
        behandelt: new Map([["/x", { prae: 0, post: 50 }]]),
        kontrolle: KONTROLLE,
      }).verdikt,
    ).toBe("insufficient_data");
    expect(differenceInDifferences({ behandelt: new Map(), kontrolle: new Map() }).verdikt).toBe(
      "insufficient_data",
    );
  });

  it("identische Kontroll-Ratios → se 0, Intervall kollabiert auf den Mittelwert", () => {
    const r = differenceInDifferences({
      behandelt: new Map([["/x", { prae: 50, post: 60 }]]),
      kontrolle: new Map([
        ["/a", { prae: 10, post: 10 }],
        ["/b", { prae: 20, post: 20 }],
        ["/c", { prae: 30, post: 30 }],
      ]),
    });
    expect(r.kontrolle.ratioSe).toBe(0);
    expect(r.counterfactual).toBe(50);
    expect(r.lift).toBe(10);
    expect(r.liftLo).toBe(10);
    expect(r.verdikt).toBe("likely_positive");
  });
});
