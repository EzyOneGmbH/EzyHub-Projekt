import { describe, expect, it } from "vitest";
import { besucheLand, landName, laenderMitTraffic, type SeoHistMonat } from "./seoHistLaender";

const months: SeoHistMonat[] = [
  { month: "2026-08", ga4Organic: 100, ga4OrganicCH: 60, ga4ByCountry: { CH: 60, DE: 30, FR: 10 } },
  { month: "2026-09", ga4Organic: 120, ga4OrganicCH: 70, ga4ByCountry: { CH: 70, DE: 20, IT: 30 } },
];

describe("seoHistLaender", () => {
  it("sortiert Laender nach Traffic", () => {
    expect(laenderMitTraffic(months).map((l) => l.code)).toEqual(["CH", "DE", "IT", "FR"]);
  });
  it("Monat ohne Land = 0, nicht null", () => {
    expect(besucheLand(months[0], "IT")).toBe(0);
    expect(besucheLand(months[1], "IT")).toBe(30);
  });
  it("alte Laeufe nur mit ga4OrganicCH", () => {
    const alt = [{ month: "2026-09", ga4Organic: 50, ga4OrganicCH: 40 }];
    expect(laenderMitTraffic(alt)).toEqual([{ code: "CH", total: 40 }]);
    expect(besucheLand(alt[0], "CH")).toBe(40);
    expect(besucheLand(alt[0], "DE")).toBeNull();
  });
  it("deutscher Landesname", () => {
    expect(landName("DE")).toBe("Deutschland");
  });
});
