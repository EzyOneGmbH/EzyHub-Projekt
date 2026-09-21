import { describe, it, expect } from "vitest";
import {
  adsApiBase,
  googleAdsApiVersion,
  GOOGLE_ADS_API_VERSION_DEFAULT,
} from "./google-ads-api.server";

// API-Stand 09/2026: v25 ist Default, Env-Override nur im Format vNN.
describe("googleAdsApiVersion / adsApiBase", () => {
  it("Default ist v25", () => {
    expect(GOOGLE_ADS_API_VERSION_DEFAULT).toBe("v25");
    expect(googleAdsApiVersion({})).toBe("v25");
    expect(adsApiBase({})).toBe("https://googleads.googleapis.com/v25");
  });

  it("Env-Override GOOGLE_ADS_API_VERSION wird uebernommen (Notfall-Rueckfall auf v24)", () => {
    expect(googleAdsApiVersion({ GOOGLE_ADS_API_VERSION: "v24" })).toBe("v24");
    expect(googleAdsApiVersion({ GOOGLE_ADS_API_VERSION: " V26 " })).toBe("v26");
    expect(adsApiBase({ GOOGLE_ADS_API_VERSION: "v24" })).toBe(
      "https://googleads.googleapis.com/v24",
    );
  });

  it("ungueltige Overrides fallen auf den Default zurueck", () => {
    expect(googleAdsApiVersion({ GOOGLE_ADS_API_VERSION: "25" })).toBe("v25");
    expect(googleAdsApiVersion({ GOOGLE_ADS_API_VERSION: "latest" })).toBe("v25");
    expect(googleAdsApiVersion({ GOOGLE_ADS_API_VERSION: "" })).toBe("v25");
  });
});
