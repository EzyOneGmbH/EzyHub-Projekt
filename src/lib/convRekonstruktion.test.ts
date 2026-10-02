import { describe, expect, it } from "vitest";
import { monatLabel, rekonstruktionVon } from "./convRekonstruktion";

describe("rekonstruktionVon", () => {
  it("ohne Eintrag oder mit kaputten Daten: nichts anzeigen", () => {
    expect(rekonstruktionVon(null)).toBeNull();
    expect(rekonstruktionVon({})).toBeNull();
    expect(rekonstruktionVon({ conv_rekonstruktion: [] })).toBeNull();
    expect(rekonstruktionVon({ conv_rekonstruktion: { zeilen: [{ monat: "Sept" }] } })).toBeNull();
  });
  it("liest Zeilen tolerant, neueste zuerst, Standardtitel und CHF", () => {
    const r = rekonstruktionVon({
      ads_package: "medium",
      conv_rekonstruktion: {
        methode: "Herkunft minus Google Ads",
        zeilen: [
          { monat: "2026-08", buchungen: "12", umsatz: 9000 },
          { monat: "2026-09", buchungen: 55, umsatz: 47500, detail: "Google ≈36, Bing 18" },
        ],
      },
    });
    expect(r?.titel).toMatch(/Schätzung/);
    expect(r?.methode).toBe("Herkunft minus Google Ads");
    expect(r?.zeilen.map((z) => z.monat)).toEqual(["2026-09", "2026-08"]);
    expect(r?.zeilen[1]).toMatchObject({
      buchungen: 12,
      umsatz: 9000,
      waehrung: "CHF",
      detail: null,
    });
  });
});

describe("monatLabel", () => {
  it("schreibt den Monat aus", () => {
    expect(monatLabel("2026-09")).toBe("September 2026");
    expect(monatLabel("kaputt")).toBe("kaputt");
  });
});
