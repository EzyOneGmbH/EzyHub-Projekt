import { describe, expect, it } from "vitest";
import {
  istBuchung,
  kombiniere,
  parseBuchungen,
  parseKontoTotals,
} from "./google-ads-overview.server";

describe("istBuchung", () => {
  it("zaehlt Kauf-Kategorien als Buchung", () => {
    expect(istBuchung("PURCHASE", "Mews Booking Engine")).toBe(true);
    expect(istBuchung("STORE_SALE", "x")).toBe(true);
  });
  it("sprechende Nicht-Kauf-Kategorien sind nie Buchungen — auch mit Buchungs-Namen", () => {
    expect(istBuchung("SUBMIT_LEAD_FORM", "Buchung")).toBe(false);
    expect(istBuchung("PHONE_CALL_LEAD", "Anruf")).toBe(false);
  });
  it("unspezifische Kategorie: Name entscheidet, Anfragen bleiben Allgemein", () => {
    expect(istBuchung("DEFAULT", "Hotelbuchung abgeschlossen")).toBe(true);
    expect(istBuchung("", "Booking")).toBe(true);
    expect(istBuchung("DEFAULT", "Buchungsanfrage")).toBe(false);
    expect(istBuchung("UNKNOWN", "Newsletter")).toBe(false);
  });
});

describe("parseKontoTotals / parseBuchungen / kombiniere", () => {
  it("rechnet Micros um und trennt Buchungen von Allgemein", () => {
    const totals = parseKontoTotals([
      {
        metrics: {
          costMicros: "2500000000",
          impressions: "1000",
          clicks: "50",
          conversions: 12,
          conversionsValue: 9000,
        },
      },
    ]);
    expect(totals.cost).toBe(2500);
    const b = parseBuchungen([
      {
        segments: { conversionActionCategory: "PURCHASE", conversionActionName: "Booking" },
        metrics: { conversions: 4, conversionsValue: 8000 },
      },
      {
        segments: { conversionActionCategory: "SUBMIT_LEAD_FORM", conversionActionName: "Kontakt" },
        metrics: { conversions: 8, conversionsValue: 1000 },
      },
    ]);
    const k = kombiniere(totals, b);
    expect(k.bookings).toBe(4);
    expect(k.bookingValue).toBe(8000);
    expect(k.general).toBe(8);
    expect(k.bookings + k.general).toBe(k.conversions);
  });
  it("Allgemein wird nie negativ", () => {
    const k = kombiniere(
      { cost: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 },
      { bookings: 3, bookingValue: 0 },
    );
    expect(k.general).toBe(0);
  });
});
