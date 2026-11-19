import { describe, expect, it } from "vitest";
import { normSuche, passtZurSuche } from "@/lib/kundenSuche";

describe("kundenSuche", () => {
  it("normalisiert Gross-/Kleinschreibung und Umlaute", () => {
    expect(normSuche("  Zürich ")).toBe("zurich");
    expect(normSuche(null)).toBe("");
  });

  it("leere Suche passt immer", () => {
    expect(passtZurSuche("", "Dialoghotel")).toBe(true);
    expect(passtZurSuche("   ", null)).toBe(true);
  });

  it("findet nach Name oder Domain", () => {
    expect(passtZurSuche("eckstein", "Dialoghotel Eckstein", "dialoghotel-eckstein.ch")).toBe(true);
    expect(passtZurSuche(".ch", "Beispiel AG", "beispiel.ch")).toBe(true);
    expect(passtZurSuche("zurich", "Praxis Zürich", null)).toBe(true);
    expect(passtZurSuche("xyz", "Beispiel AG", "beispiel.ch")).toBe(false);
  });

  it("verlangt jedes Suchwort, über die Felder hinweg", () => {
    expect(passtZurSuche("hotel ch", "Dialoghotel Eckstein", "eckstein.ch")).toBe(true);
    expect(passtZurSuche("hotel de", "Dialoghotel Eckstein", "eckstein.ch")).toBe(false);
  });
});
