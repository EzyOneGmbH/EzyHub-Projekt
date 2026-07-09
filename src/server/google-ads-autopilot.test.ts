import { describe, it, expect } from "vitest";
import {
  computeTrackingHealth,
  activeSeasonWindow,
  planActions,
  grams,
  normalizeTerm,
  computeGeoDeviceFindings,
  computeBrandOtaFindings,
  type AutopilotConfig,
  type AutopilotData,
} from "./google-ads-autopilot.server";

// Phase-1-Abnahme: deterministische Kern-Logik (Tracking-Gate, Saison, N-Gram,
// Mindestbasis, Konfliktcheck) als Unit-Tests. Netz-/DB-Pfade werden hier nicht
// beruehrt — nur die exportierten pure functions.

const cfg = (over: Partial<AutopilotConfig> = {}): AutopilotConfig => ({
  client_id: "c1",
  industry: "hotel",
  kill_switch: false,
  observe_only: true,
  autonomy_level: 1,
  monthly_budget_chf: 1000,
  target_cpa_chf: 50,
  target_roas: null,
  season_high: [],
  season_low: [],
  no_touch_campaigns: [],
  languages: ["de"],
  notes: null,
  notes_updated_at: null,
  min_conversions_baseline: 3,
  conversion_lag_days: 14,
  min_conversions_for_budget_rec: 5,
  ...over,
});

const data = (over: Partial<AutopilotData> = {}): AutopilotData => ({
  campaigns: [],
  searchTerms: [],
  termWindow: { from: "2026-05-26", to: "2026-06-25", lagDays: 14 },
  trackingHealth: { status: "OK", spend7d: 100, conversions7d: 5, conversionsBaseline30d: 50 },
  auctionInsights: [],
  geoPerformance: [],
  devicePerformance: [],
  assetIssues: [],
  pmaxAssetGroups: [],
  changeHistory: [],
  dataSourceErrors: [],
  meta: { customerId: "123", costSumChf: 0, avgCpaChf: null },
  error: null,
  ...over,
});

describe("computeTrackingHealth (Abnahme 1.1: simulierter Tracking-Ausfall)", () => {
  it("meldet BROKEN bei Spend ohne Conversions trotz intakter Baseline", () => {
    expect(computeTrackingHealth(500, 0, 40, 3)).toBe("BROKEN");
  });
  it("bleibt OK bei laufenden Conversions", () => {
    expect(computeTrackingHealth(500, 12, 40, 3)).toBe("OK");
  });
  it("NO_BASELINE statt BROKEN, wenn das Konto nie genug Conversions hatte", () => {
    expect(computeTrackingHealth(500, 0, 1, 3)).toBe("NO_BASELINE");
  });
  it("kein BROKEN ohne Spend (pausiertes Konto)", () => {
    expect(computeTrackingHealth(0, 0, 40, 3)).toBe("OK");
  });
});

describe("activeSeasonWindow (Abnahme 1.5)", () => {
  it("findet Hochsaison-Fenster inkl. Jahreswechsel", () => {
    const c = cfg({ season_high: ["12-20..01-06"] });
    expect(activeSeasonWindow(c, new Date("2026-12-25"))).toEqual({ kind: "high", window: "12-20..01-06" });
    expect(activeSeasonWindow(c, new Date("2027-01-03"))).toEqual({ kind: "high", window: "12-20..01-06" });
    expect(activeSeasonWindow(c, new Date("2026-03-15"))).toBeNull();
  });
  it("findet Nebensaison", () => {
    const c = cfg({ season_low: ["11-01..12-19"] });
    expect(activeSeasonWindow(c, new Date("2026-11-15"))?.kind).toBe("low");
  });
});

describe("grams / Stoppwoerter (Fix aus Abnahme-Lauf: 'mit' darf kein Kandidat sein)", () => {
  it("filtert Stoppwoerter als Unigram, behaelt sie in Bigrams", () => {
    const g = grams("hotel mit pool");
    expect(g).not.toContain("mit");
    expect(g).toContain("hotel");
    expect(g).toContain("hotel mit");
    expect(g).toContain("mit pool");
  });
  it("verwirft reine Stoppwort-Bigrams", () => {
    expect(grams("mit der")).toEqual([]);
  });
  it("normalisiert Sonderzeichen", () => {
    expect(normalizeTerm("Hôtel? Zürich!")).toBe("hôtel zürich");
  });
});

describe("planActions (Abnahme 1.4)", () => {
  it("Budget-Empfehlung erst ab Mindestbasis (5 Conv.)", () => {
    const d = data({
      campaigns: [
        { name: "A", status: "ENABLED", dailyBudgetChf: 20, costChf: 500, conversions: 3, conversionValue: 4000, roas: 8, budgetLostIs: 0.4, biddingSystemStatus: "ENABLED", learning: false },
        { name: "B", status: "ENABLED", dailyBudgetChf: 20, costChf: 500, conversions: 27, conversionValue: 4000, roas: 8, budgetLostIs: 0.4, biddingSystemStatus: "ENABLED", learning: false },
      ],
    });
    const acts = planActions(d, cfg());
    const budget = acts.filter((a) => a.type === "budget_change");
    expect(budget).toHaveLength(1);
    expect(budget[0].entity).toBe("B");
    expect(budget[0].rationale).toContain("Mindestbasis 5");
  });

  it("Cross-Kampagnen-Konflikt: konvertierender Begriff wird NICHT ausgeschlossen", () => {
    const d = data({
      searchTerms: [
        { term: "wellness wochenende", campaign: "Kampagne X", adGroup: "AG1", costChf: 400, conversions: 0 },
        { term: "wellness wochenende", campaign: "Kampagne Y", adGroup: "AG2", costChf: 90, conversions: 2 },
      ],
    });
    const acts = planActions(d, cfg());
    expect(acts.some((a) => a.type === "add_negative" && a.rationale.includes("wellness wochenende"))).toBe(false);
    expect(acts.some((a) => a.type === "negative_conflict")).toBe(true);
  });

  it("Learning-Kampagne stuft auto-execute auf approval-needed herab", () => {
    const d = data({
      campaigns: [
        { name: "L", status: "ENABLED", dailyBudgetChf: 20, costChf: 100, conversions: 10, conversionValue: 500, roas: 5, budgetLostIs: 0, biddingSystemStatus: "LEARNING_BUDGET_CHANGE", learning: true },
      ],
      searchTerms: [{ term: "teurer quatsch begriff", campaign: "L", adGroup: "AG", costChf: 200, conversions: 0 }],
    });
    const acts = planActions(d, cfg({ autonomy_level: 1 }));
    const neg = acts.find((a) => a.type === "add_negative");
    expect(neg?.actionClass).toBe("approval-needed");
    expect(neg?.rationale).toContain("Learning Phase aktiv");
  });

  it("Nebensaison annotiert Budget-Erhoehungen", () => {
    const d = data({
      campaigns: [
        { name: "B", status: "ENABLED", dailyBudgetChf: 20, costChf: 500, conversions: 27, conversionValue: 4000, roas: 8, budgetLostIs: 0.4, biddingSystemStatus: "ENABLED", learning: false },
      ],
    });
    const now = new Date();
    const mmdd = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const acts = planActions(d, cfg({ season_low: [`${mmdd}..${mmdd}`] }));
    expect(acts.find((a) => a.type === "budget_change")?.rationale).toContain("Nebensaison");
  });

  it("N-Gram-Kandidat entsteht nur bei >=5 Begriffen, 0 Conv., Kosten > 2x CPA - und nie als Stoppwort", () => {
    const terms = Array.from({ length: 6 }, (_, i) => ({
      term: `billige unterkunft variante ${i}`,
      campaign: "K", adGroup: "AG", costChf: 30, conversions: 0,
    }));
    const acts = planActions(data({ searchTerms: terms }), cfg());
    const phrases = acts.filter((a) => a.type === "add_negative_phrase");
    expect(phrases.length).toBeGreaterThan(0);
    for (const p of phrases) expect(p.actionClass).toBe("approval-needed");
    expect(phrases.some((p) => /"(mit|und|der)"/.test(p.after))).toBe(false);
  });
});

describe("computeGeoDeviceFindings (Phase 3.2)", () => {
  it("meldet Geo-Anomalie bei >30% CPA-Abweichung und >=5 Conversions", () => {
    const d = data({
      geoPerformance: [
        { location: "Deutschland", costChf: 500, conversions: 5, convValue: 0 },  // CPA 100 = +100%
        { location: "Schweiz", costChf: 250, conversions: 5, convValue: 0 },      // CPA 50 = 0%
        { location: "Frankreich", costChf: 90, conversions: 2, convValue: 0 },    // <5 Conv -> keine Anomalie
      ],
      meta: { customerId: "1", costSumChf: 0, avgCpaChf: 50 },
    });
    const f = computeGeoDeviceFindings(d);
    expect(f.filter((x) => x.type === "geo_anomaly").map((x) => x.entity)).toEqual(["Deutschland"]);
    expect(f[0].actionClass).toBe("report-only");
  });
  it("meldet Geo-Kostenfresser ohne Conversions (> 3x CPA)", () => {
    const d = data({
      geoPerformance: [{ location: "USA", costChf: 200, conversions: 0, convValue: 0 }],
      meta: { customerId: "1", costSumChf: 0, avgCpaChf: 50 },
    });
    expect(computeGeoDeviceFindings(d).some((x) => x.entity === "USA" && /Streuverlust/.test(x.rationale))).toBe(true);
  });
  it("meldet Geraete-Anomalie aggregiert ueber Kampagnen", () => {
    const d = data({
      devicePerformance: [
        { campaign: "A", device: "MOBILE", costChf: 400, conversions: 3 },
        { campaign: "B", device: "MOBILE", costChf: 300, conversions: 4 },  // gesamt CPA 100 = +100%
        { campaign: "A", device: "DESKTOP", costChf: 250, conversions: 5 }, // CPA 50 = 0%
      ],
      meta: { customerId: "1", costSumChf: 0, avgCpaChf: 50 },
    });
    const f = computeGeoDeviceFindings(d).filter((x) => x.type === "device_anomaly");
    expect(f).toHaveLength(1);
    expect(f[0].entity).toBe("MOBILE");
    expect(f[0].rationale).toContain("Mobile-Landing");
  });
  it("meldet Asset-Schwaechen ab 2 LOW-Labels je Ad-Group", () => {
    const d = data({
      assetIssues: [
        { adGroup: "AG1", fieldType: "HEADLINE", text: "x", label: "LOW" },
        { adGroup: "AG1", fieldType: "DESCRIPTION", text: "y", label: "LOW" },
        { adGroup: "AG2", fieldType: "HEADLINE", text: "z", label: "LOW" },
      ],
      meta: { customerId: "1", costSumChf: 0, avgCpaChf: 50 },
    });
    const f = computeGeoDeviceFindings(d).filter((x) => x.type === "asset_weakness");
    expect(f.map((x) => x.entity)).toEqual(["AG1"]);
  });
});

describe("computeBrandOtaFindings (Hotel-Playbook)", () => {
  it("quantifiziert OTA-Druck auf Brand-Kampagnen (nur industry hotel)", () => {
    const d = data({
      auctionInsights: [
        { campaign: "SN - DE - Brand - X", domain: "booking.com", impressionShare: 0.3, overlapRate: 0.62, outrankingShare: 0.2 },
        { campaign: "SN - DE - Brand - X", domain: "eigenerandererhotelier.ch", impressionShare: 0.1, overlapRate: 0.2, outrankingShare: 0.05 },
        { campaign: "Non-Brand", domain: "booking.com", impressionShare: 0.4, overlapRate: 0.8, outrankingShare: 0.4 },
      ],
    });
    const f = computeBrandOtaFindings(d, cfg({ industry: "hotel" }));
    expect(f).toHaveLength(1);
    expect(f[0].entity).toContain("booking.com");
    expect(f[0].rationale).toContain("Overlap 62%");
    expect(computeBrandOtaFindings(d, cfg({ industry: "kmu-local" }))).toEqual([]);
  });
});
