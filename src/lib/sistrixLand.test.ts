import { describe, expect, it } from "vitest";
import { mitSistrixLand, sistrixLandLabel, sistrixLandVon } from "./sistrixLand";

describe("sistrixLandVon", () => {
  it("Standard ist Schweiz", () => {
    expect(sistrixLandVon(null)).toBe("ch");
    expect(sistrixLandVon({})).toBe("ch");
    expect(sistrixLandVon({ sistrix_country: "xx" })).toBe("ch");
  });
  it("liest das gesetzte Land tolerant", () => {
    expect(sistrixLandVon({ sistrix_country: "FR" })).toBe("fr");
    expect(sistrixLandVon({ sistrix_country: " de " })).toBe("de");
  });
});

describe("mitSistrixLand", () => {
  it("setzt das Land und laesst andere Felder unveraendert", () => {
    const m = mitSistrixLand({ ads_package: "starter", first_party_kpi: true }, "fr");
    expect(m).toEqual({ ads_package: "starter", first_party_kpi: true, sistrix_country: "fr" });
  });
  it("Standard «ch» entfernt das Feld", () => {
    expect(mitSistrixLand({ sistrix_country: "fr", x: 1 }, "ch")).toEqual({ x: 1 });
  });
  it("kaputtes metadata wird zu leerem Objekt", () => {
    expect(mitSistrixLand(null, "fr")).toEqual({ sistrix_country: "fr" });
    expect(mitSistrixLand([1, 2], "fr")).toEqual({ sistrix_country: "fr" });
  });
});

describe("sistrixLandLabel", () => {
  it("liefert lesbare Namen", () => {
    expect(sistrixLandLabel("fr")).toBe("Frankreich");
    expect(sistrixLandLabel(null)).toBe("Schweiz");
  });
});
