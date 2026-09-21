import { describe, it, expect } from "vitest";
import {
  adsFenster,
  adsRows,
  parseCartProducts,
  parseConversionSplit,
  parseCampaignFlags,
} from "./google-ads.server";

// API-Stand v25 (21.09.2026): Parser der neuen Zusatzbloecke gegen Fake-
// searchStream-Antworten (camelCase-JSON, Micros-Betraege).

describe("adsRows (searchStream-Chunks)", () => {
  it("macht mehrere Chunks flach und uebersteht leere/fehlende Antworten", () => {
    expect(adsRows([{ results: [{ a: 1 }] }, { results: [{ a: 2 }] }, {}])).toEqual([
      { a: 1 },
      { a: 2 },
    ]);
    expect(adsRows(null)).toEqual([]);
  });
});

describe("parseCartProducts (cart_data_sales_view, v24+)", () => {
  it("liest Produkt-Segmente + Micros-Metriken und sortiert nach Umsatz", () => {
    const rows = [
      {
        segments: { productItemId: "sku-2", productTitle: "Zweitbestes" },
        metrics: {
          orders: "3",
          unitsSold: "4",
          revenueMicros: "120000000",
          grossProfitMicros: "40000000",
          allRevenueMicros: "150000000",
        },
      },
      {
        segments: { productItemId: "sku-1", productTitle: "Bestseller" },
        metrics: { orders: "10", unitsSold: "12", revenueMicros: "990500000" },
      },
      { segments: {}, metrics: { revenueMicros: "5" } }, // ohne Produkt → ignoriert
    ];
    expect(parseCartProducts(rows)).toEqual([
      {
        itemId: "sku-1",
        title: "Bestseller",
        orders: 10,
        unitsSold: 12,
        revenue: 990.5,
        grossProfit: 0,
        allRevenue: 0,
      },
      {
        itemId: "sku-2",
        title: "Zweitbestes",
        orders: 3,
        unitsSold: 4,
        revenue: 120,
        grossProfit: 40,
        allRevenue: 150,
      },
    ]);
  });
  it("leere Antwort → []", () => {
    expect(parseCartProducts([])).toEqual([]);
  });
});

describe("parseConversionSplit (biddable vs. nur Reporting)", () => {
  it("trennt nach include_in_conversions_metric und rechnet Summen", () => {
    const rows = [
      {
        conversionAction: { name: "Buchung", includeInConversionsMetric: true },
        metrics: { allConversions: "12", allConversionsValue: "2400" },
      },
      {
        conversionAction: { name: "Newsletter", includeInConversionsMetric: false },
        metrics: { allConversions: "30", allConversionsValue: "0" },
      },
      {
        conversionAction: { name: "Anruf" }, // Flag fehlt → nur Reporting
        metrics: { allConversions: "2", allConversionsValue: "100" },
      },
      { conversionAction: { name: "" }, metrics: { allConversions: "99" } }, // ohne Name
    ];
    const s = parseConversionSplit(rows);
    expect(s.all).toEqual({ count: 44, value: 2500 });
    expect(s.biddable).toEqual({ count: 12, value: 2400 });
    expect(s.reportingOnly).toEqual({ count: 32, value: 100 });
    expect(s.actions.map((a) => a.name)).toEqual(["Newsletter", "Buchung", "Anruf"]);
    expect(s.actions[1]).toEqual({ name: "Buchung", biddable: true, count: 12, value: 2400 });
  });
  it("aggregiert Mehrfachzeilen derselben Aktion", () => {
    const s = parseConversionSplit([
      {
        conversionAction: { name: "A", includeInConversionsMetric: true },
        metrics: { allConversions: 1 },
      },
      {
        conversionAction: { name: "A", includeInConversionsMetric: true },
        metrics: { allConversions: 2 },
      },
    ]);
    expect(s.actions).toEqual([{ name: "A", biddable: true, count: 3, value: 0 }]);
  });
});

describe("parseCampaignFlags (v25: brand_guidelines_enabled + campaign_goal_config)", () => {
  const camps = [
    {
      campaign: {
        id: "11",
        name: "PMax Sommer",
        advertisingChannelType: "PERFORMANCE_MAX",
        brandGuidelinesEnabled: true,
      },
    },
    { campaign: { id: "22", name: "Search Brand", advertisingChannelType: "SEARCH" } },
    { campaign: { id: "33", name: "" } },
  ];
  it("setzt Brand-Guidelines- und NCA-Flags je Kampagne", () => {
    const goals = [
      {
        campaignGoalConfig: {
          campaign: "customers/1/campaigns/22",
          goalType: "NEW_CUSTOMER_ACQUISITION",
        },
      },
      {
        campaignGoalConfig: { campaign: "customers/1/campaigns/11", goalType: "LOYALTY_RETENTION" },
      },
    ];
    expect(parseCampaignFlags(camps, goals)).toEqual([
      {
        id: "11",
        name: "PMax Sommer",
        channelType: "PERFORMANCE_MAX",
        brandGuidelinesEnabled: true,
        ncaGoalActive: false,
      },
      {
        id: "22",
        name: "Search Brand",
        channelType: "SEARCH",
        brandGuidelinesEnabled: false,
        ncaGoalActive: true,
      },
    ]);
  });
  it("erkennt NCA auch ueber campaign_new_customer_acquisition_settings; ohne Goal-Zeilen alles false", () => {
    const goals = [
      {
        campaignGoalConfig: {
          campaign: "customers/1/campaigns/11",
          campaignNewCustomerAcquisitionSettings: {},
        },
      },
    ];
    expect(parseCampaignFlags(camps, goals)[0].ncaGoalActive).toBe(true);
    expect(parseCampaignFlags(camps, []).every((f) => !f.ncaGoalActive)).toBe(true);
  });
});

describe("adsFenster (Zeitraum-Vertrag bleibt: exakt, inklusiv, gleich lang)", () => {
  it("exakter Range + Vorperiode nahtlos", () => {
    const { aktuell, vorher } = adsFenster({ startDate: "2026-09-01", endDate: "2026-09-14" });
    expect(aktuell.days).toBe(14);
    expect(vorher).toMatchObject({ startDate: "2026-08-18", endDate: "2026-08-31", days: 14 });
  });
});
