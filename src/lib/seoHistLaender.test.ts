import { describe, expect, it } from "vitest";
import { besucheLand, landName, laenderImZeitraum, laenderMitTraffic, type SeoHistMonat } from "./seoHistLaender";

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

describe("laenderImZeitraum", () => {
  const verlauf = [
    { code: "CH", total: 1000 },
    { code: "FR", total: 500 },
    { code: "US", total: 100 },
  ];
  it("Zahlen und Reihenfolge aus dem Zeitraum", () => {
    const zr = [
      { country: "Switzerland", countryId: "CH", sessions: 80 },
      { country: "United States", countryId: "US", sessions: 90 },
      { country: "France", countryId: "FR", sessions: 0 },
      { country: "Peru", countryId: "PE", sessions: 5 },
    ];
    expect(laenderImZeitraum(zr, verlauf)).toEqual([
      { code: "US", total: 90, zeitraum: true },
      { code: "CH", total: 80, zeitraum: true },
    ]);
  });
  it("ohne countryId → Verlaufssummen", () => {
    const alt = [{ country: "Switzerland", sessions: 80 }];
    expect(laenderImZeitraum(alt, verlauf).map((l) => [l.code, l.total, l.zeitraum])).toEqual([
      ["CH", 1000, false],
      ["FR", 500, false],
      ["US", 100, false],
    ]);
  });
});
