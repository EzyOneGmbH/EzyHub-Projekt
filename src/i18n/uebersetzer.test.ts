// Sprach-Umschaltung (05.10.2026): Kern der Übersetzung + Vollständigkeit der Wörterbücher.
import { describe, expect, it } from "vitest";
import { baueWoerterbuch, uebersetze } from "./uebersetzer";
import quellen from "./quellen.json";
import en from "./en.json";
import fr from "./fr.json";

const wb = baueWoerterbuch({
  "Alle Kunden": "All clients",
  "{0} Kunden": "{0} clients",
  "{0} von {1} Kunden": "{0} of {1} clients",
  "Kunde {0} hat {1} Fehler": "{1} errors for client {0}",
  "{0} %": "{0} %",
  Dashboard: "Dashboard",
});

describe("Übersetzungs-Kern", () => {
  it("übersetzt exakte Oberflächentexte und erhält Leerzeichen", () => {
    expect(uebersetze("Alle Kunden", wb)).toBe("All clients");
    expect(uebersetze("  Alle   Kunden ", wb)).toBe("  All clients ");
  });

  it("Muster mit Platzhaltern, auch in anderer Reihenfolge", () => {
    expect(uebersetze("17 Kunden", wb)).toBe("17 clients");
    expect(uebersetze("3 von 17 Kunden", wb)).toBe("3 of 17 clients");
    expect(uebersetze("Kunde Alpha hat 3 Fehler", wb)).toBe("3 errors for client Alpha");
  });

  it("lässt Kundendaten und Unbekanntes unberührt", () => {
    expect(uebersetze("Hotel Bären Langnau", wb)).toBeNull();
    expect(uebersetze("hotel zürich", wb)).toBeNull();
    expect(uebersetze("1'234", wb)).toBeNull();
    // Muster ohne genug festen Text werden nicht angelegt
    expect(uebersetze("12 %", wb)).toBeNull();
    // bereits übersetzt → kein zweiter Durchgang
    expect(uebersetze("All clients", wb)).toBeNull();
  });
});

describe("Wörterbücher vollständig", () => {
  const ph = (t: string) => (t.match(/\{\d+\}/g) || []).sort().join(",");
  for (const [name, dict] of [
    ["en", en],
    ["fr", fr],
  ] as const) {
    const d = dict as Record<string, string>;
    it(`${name}: jeder Quelltext hat eine Übersetzung mit denselben Platzhaltern`, () => {
      const fehlt = (quellen as string[]).filter((q) => typeof d[q] !== "string");
      expect(fehlt.slice(0, 10)).toEqual([]);
      const falsch = (quellen as string[]).filter((q) => d[q] != null && ph(q) !== ph(d[q]));
      expect(falsch.slice(0, 10)).toEqual([]);
    });
  }
});
