import { describe, expect, it } from "vitest";
import {
  aggregiereAnteile,
  aggregiereGeo,
  benenneGeo,
  ladeAdsReport,
  parseAssetGroups,
  parseConvActions,
  parseImpressionShare,
  parseSuchbegriffe,
} from "./google-ads-report.server";

const conv = (name: string, cat: string, m: Record<string, number>) => ({
  segments: { conversionActionName: name, conversionActionCategory: cat },
  metrics: m,
});

describe("parseConvActions", () => {
  it("trennt Hauptziel (Buchung) und Soft Conversions, fuehrt Vorperiode zusammen", () => {
    const a = parseConvActions(
      [
        conv("Buchung abgeschlossen", "PURCHASE", {
          conversions: 23,
          conversionsValue: 9256,
          allConversions: 25,
          allConversionsValue: 9900,
        }),
        conv("Klick auf Telefon", "PHONE_CALL_LEAD", { conversions: 0, allConversions: 18 }),
        conv("Ladenbesuche", "STORE_VISIT", { conversions: 0, allConversions: 0 }),
      ],
      [conv("Buchung abgeschlossen", "PURCHASE", { conversions: 20, conversionsValue: 8380 })],
    );
    expect(a.map((x) => x.name)).toEqual(["Buchung abgeschlossen", "Klick auf Telefon"]);
    expect(a[0]).toMatchObject({ booking: true, count: 23, value: 9256, prevCount: 20 });
    expect(a[1]).toMatchObject({ booking: false, count: 18, prevCount: 0 });
  });
  it("Buchung ohne primaere Conversions zaehlt alle Conversions", () => {
    const [b] = parseConvActions(
      [
        conv("Booking", "PURCHASE", {
          conversions: 0,
          allConversions: 4,
          allConversionsValue: 800,
        }),
      ],
      [],
    );
    expect(b).toMatchObject({ count: 4, value: 800 });
  });
  it("sekundaere Buchungsaktion neben primaerer faellt weg (keine Doppelzaehlung)", () => {
    const a = parseConvActions(
      [
        conv("Buchung", "PURCHASE", {
          conversions: 46.5,
          conversionsValue: 29350,
          allConversions: 46.5,
        }),
        conv("Engstligenalp - Buchung", "PURCHASE", {
          conversions: 0,
          allConversions: 20.1,
          allConversionsValue: 10841,
        }),
        conv("YouTube follow-on views", "YOUTUBE_FOLLOW_ON_VIEWS", { allConversions: 25 }),
      ],
      [conv("Engstligenalp - Buchung", "PURCHASE", { conversions: 0, allConversions: 18 })],
    );
    expect(a.map((x) => x.name)).toEqual(["Buchung", "YouTube follow-on views"]);
    expect(a[0]).toMatchObject({ booking: true, count: 46.5, value: 29350 });
  });
});

describe("parseImpressionShare", () => {
  it("rechnet Anteile in Prozent, fehlende Werte = null", () => {
    expect(
      parseImpressionShare([
        { metrics: { topImpressionPercentage: 0.7712, absoluteTopImpressionPercentage: 0.2 } },
      ]),
    ).toEqual({ top: 77.1, absTop: 20 });
    expect(parseImpressionShare([])).toEqual({ top: null, absTop: null });
  });
});

describe("Geo", () => {
  it("aggregiert je ID und setzt Namen aus geo_target_constant", () => {
    const rows = [
      {
        geographicView: { countryCriterionId: "2756" },
        metrics: { clicks: 10, conversions: 3, conversionsValue: 900 },
      },
      {
        geographicView: { countryCriterionId: "2756" },
        metrics: { clicks: 5, conversions: 1, conversionsValue: 100 },
      },
      { geographicView: { countryCriterionId: "2276" }, metrics: { clicks: 2, conversions: 0 } },
      { geographicView: { countryCriterionId: "9999" }, metrics: { clicks: 1 } },
    ];
    const agg = aggregiereGeo(rows, (r) => r.geographicView.countryCriterionId);
    const benannt = benenneGeo(agg, [
      {
        geoTargetConstant: {
          resourceName: "geoTargetConstants/2756",
          name: "Switzerland",
          countryCode: "CH",
        },
      },
      {
        geoTargetConstant: {
          resourceName: "geoTargetConstants/2276",
          name: "Germany",
          countryCode: "DE",
        },
      },
    ]);
    expect(benannt).toHaveLength(2);
    expect(benannt.find((r) => r.id === "2756")).toMatchObject({
      name: "Switzerland",
      countryCode: "CH",
      clicks: 15,
      conversions: 4,
      value: 1000,
    });
  });
  it("Stadt-Segmente sind Ressourcennamen", () => {
    const [s] = aggregiereGeo(
      [{ segments: { geoTargetCity: "geoTargetConstants/1004237" }, metrics: { conversions: 2 } }],
      (r) => r.segments.geoTargetCity,
    );
    expect(s).toMatchObject({ id: "1004237", conversions: 2 });
  });
});

describe("aggregiereAnteile / Suchbegriffe / Asset-Gruppen", () => {
  it("summiert Alter je Typ", () => {
    const a = aggregiereAnteile(
      [
        {
          adGroupCriterion: { ageRange: { type: "AGE_RANGE_35_44" } },
          metrics: { conversions: 2, clicks: 10 },
        },
        {
          adGroupCriterion: { ageRange: { type: "AGE_RANGE_35_44" } },
          metrics: { conversions: 1, clicks: 5 },
        },
      ],
      (r) => r.adGroupCriterion.ageRange.type,
    );
    expect(a).toEqual([{ key: "AGE_RANGE_35_44", conversions: 3, clicks: 15 }]);
  });
  it("fasst Suchbegriffe ueber Anzeigengruppen zusammen und gewichtet Absolute-Top", () => {
    const [t] = parseSuchbegriffe([
      {
        searchTermView: { searchTerm: "hotel lugano" },
        metrics: {
          impressions: 100,
          clicks: 10,
          costMicros: 5_000_000,
          conversions: 1,
          conversionsValue: 400,
          absoluteTopImpressionPercentage: 0.1,
        },
      },
      {
        searchTermView: { searchTerm: "hotel lugano" },
        metrics: {
          impressions: 300,
          clicks: 20,
          costMicros: 10_000_000,
          absoluteTopImpressionPercentage: 0.5,
        },
      },
    ]);
    expect(t).toMatchObject({
      term: "hotel lugano",
      impressions: 400,
      clicks: 30,
      cost: 15,
      conversions: 1,
      value: 400,
      absTop: 40,
    });
  });
  it("Asset-Gruppen nach Impressionen", () => {
    const g = parseAssetGroups([
      {
        assetGroup: { name: "Kunst", status: "ENABLED" },
        campaign: { name: "PMax" },
        metrics: { impressions: 7022, costMicros: 59_980_000 },
      },
      {
        assetGroup: { name: "Kombi", status: "ENABLED" },
        campaign: { name: "PMax" },
        metrics: { impressions: 9044 },
      },
    ]);
    expect(g.map((x) => x.name)).toEqual(["Kombi", "Kunst"]);
    expect(g[1].cost).toBeCloseTo(59.98);
  });
});

describe("ladeAdsReport", () => {
  it("ist fail-soft: ein fehlschlagender Teil fuellt errors, der Rest bleibt", async () => {
    const z = {
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      days: 30,
      quelle: "custom" as const,
    };
    const query = async (gaql: string) => {
      if (gaql.includes("search_term_view")) throw new Error("HTTP 400");
      if (gaql.includes("FROM asset_group"))
        return [{ results: [{ assetGroup: { name: "A" }, metrics: { impressions: 1 } }] }];
      return [{ results: [] }];
    };
    const r = await ladeAdsReport(query, z, z);
    expect(r.searchTerms).toBeNull();
    expect(r.errors.some((e) => e.startsWith("search_terms"))).toBe(true);
    expect(r.assetGroups).toHaveLength(1);
    expect(r.geo).not.toBeNull();
  });
});
