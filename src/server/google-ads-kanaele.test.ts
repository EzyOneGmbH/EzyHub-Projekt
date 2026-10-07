import { describe, expect, it } from "vitest";
import { adsKanalVonTyp, parseAdsKanaele } from "./google-ads-kanaele.server";

describe("google-ads-kanaele", () => {
  it("Search → Paid Search, alles andere → Cross-network", () => {
    expect(adsKanalVonTyp("SEARCH")).toBe("paidSearch");
    expect(adsKanalVonTyp("PERFORMANCE_MAX")).toBe("crossNetwork");
    expect(adsKanalVonTyp("DEMAND_GEN")).toBe("crossNetwork");
    expect(adsKanalVonTyp(undefined)).toBe("crossNetwork");
  });

  it("summiert Kennzahlen und Buchungen je Kanal", () => {
    const k = parseAdsKanaele(
      [
        {
          campaign: { advertisingChannelType: "SEARCH" },
          metrics: { clicks: "10", costMicros: "5000000", conversions: 3, conversionsValue: 900 },
        },
        {
          campaign: { advertisingChannelType: "SEARCH" },
          metrics: { clicks: "5", costMicros: "1000000", conversions: 1, conversionsValue: 100 },
        },
        {
          campaign: { advertisingChannelType: "PERFORMANCE_MAX" },
          metrics: {
            clicks: "20",
            costMicros: "8000000",
            conversions: 2.5,
            conversionsValue: 1500,
          },
        },
      ],
      [
        {
          campaign: { advertisingChannelType: "SEARCH" },
          segments: { conversionActionCategory: "PURCHASE", conversionActionName: "Buchung" },
          metrics: { conversions: 2, conversionsValue: 900 },
        },
        {
          campaign: { advertisingChannelType: "SEARCH" },
          segments: { conversionActionCategory: "PHONE_CALL_LEAD", conversionActionName: "Anruf" },
          metrics: { conversions: 2, conversionsValue: 100 },
        },
        {
          campaign: { advertisingChannelType: "PERFORMANCE_MAX" },
          segments: { conversionActionCategory: "PURCHASE", conversionActionName: "Mews" },
          metrics: { conversions: 2.5, conversionsValue: 1500 },
        },
      ],
    );
    expect(k.paidSearch).toEqual({
      clicks: 15,
      cost: 6,
      conversions: 4,
      conversionValue: 1000,
      bookings: 2,
      bookingValue: 900,
    });
    expect(k.crossNetwork).toEqual({
      clicks: 20,
      cost: 8,
      conversions: 2.5,
      conversionValue: 1500,
      bookings: 2.5,
      bookingValue: 1500,
    });
  });
});
