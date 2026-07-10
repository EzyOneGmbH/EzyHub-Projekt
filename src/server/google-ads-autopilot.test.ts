import { describe, it, expect } from "vitest";
import {
  computeTrackingHealth,
  activeSeasonWindow,
  planActions,
  grams,
  normalizeTerm,
  computeGeoDeviceFindings,
  computeBrandOtaFindings,
  computeStructureFindings,
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
  adGroupPerformance: [],
  keywordQuality: [],
  monthComparison: [],
  pmaxSearchThemes: [],
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

  // ── Phase 0.1: explizite Ziel-Pruefkette (ROAS -> CPA -> report-only) ──────
  it("La-Campagnola-Regression: Conversions ohne Wert (ROAS 0.0) -> CPA-Zweig, kein ROAS-Vorschlag", () => {
    // Exakt der Fall vom 08.07.: budgetlimitiert, 12 Conversions, conversion_value 0
    // -> ROAS 0.0. target_roas null, target_cpa 50 -> CPA-Pruefung: 300/12 = 25 <= 50.
    const d = data({
      campaigns: [
        { name: "SN - DE - Hotel - ZH + SG + TG", status: "ENABLED", dailyBudgetChf: 10, costChf: 300, conversions: 12, conversionValue: 0, roas: 0, budgetLostIs: 0.25, biddingSystemStatus: "ENABLED", learning: false },
      ],
    });
    const acts = planActions(d, cfg({ target_roas: null, target_cpa_chf: 50 }));
    const budget = acts.filter((a) => a.type === "budget_change");
    expect(budget).toHaveLength(1);
    expect(budget[0].actionClass).toBe("approval-needed");
    expect(budget[0].rationale).toContain("CPA");
    expect(budget[0].rationale).toContain("Ziel-CPA");
    expect(budget[0].rationale).not.toContain("ROAS 0.0");
  });

  it("CPA ueber Ziel-CPA -> kein Budget-Vorschlag (weder approval noch report-only)", () => {
    const d = data({
      campaigns: [
        { name: "Teuer", status: "ENABLED", dailyBudgetChf: 10, costChf: 900, conversions: 6, conversionValue: 0, roas: 0, budgetLostIs: 0.3, biddingSystemStatus: "ENABLED", learning: false },
      ],
    });
    // CPA 150 > Ziel-CPA 50 -> Ziel gesetzt, nicht erfuellt -> gar kein budget_change
    const acts = planActions(d, cfg({ target_roas: null, target_cpa_chf: 50 }));
    expect(acts.filter((a) => a.type === "budget_change")).toHaveLength(0);
  });

  it("kein Ziel gesetzt -> report-only mit Hinweis 'kein Ziel definiert', nie approval", () => {
    const d = data({
      campaigns: [
        { name: "OhneZiel", status: "ENABLED", dailyBudgetChf: 20, costChf: 500, conversions: 27, conversionValue: 4000, roas: 8, budgetLostIs: 0.4, biddingSystemStatus: "ENABLED", learning: false },
      ],
    });
    const acts = planActions(d, cfg({ target_roas: null, target_cpa_chf: null }));
    const budget = acts.filter((a) => a.type === "budget_change");
    expect(budget).toHaveLength(1);
    expect(budget[0].actionClass).toBe("report-only");
    expect(budget[0].rationale).toContain("kein Ziel definiert");
    expect(budget[0].exec).toBeUndefined();
  });

  it("target_roas gesetzt -> ROAS-Pruefung hat Vorrang (CPA irrelevant)", () => {
    const d = data({
      campaigns: [
        // ROAS 2.0 < Ziel 4.0 -> kein Vorschlag, obwohl CPA (500/25=20) unter target_cpa 50 laege
        { name: "RoasZiel", status: "ENABLED", dailyBudgetChf: 20, costChf: 500, conversions: 25, conversionValue: 1000, roas: 2, budgetLostIs: 0.4, biddingSystemStatus: "ENABLED", learning: false },
      ],
    });
    expect(planActions(d, cfg({ target_roas: 4, target_cpa_chf: 50 })).filter((a) => a.type === "budget_change")).toHaveLength(0);
    // ROAS 2.0 >= Ziel 1.5 -> Vorschlag mit ROAS-Beleg
    const ok = planActions(d, cfg({ target_roas: 1.5, target_cpa_chf: 50 })).filter((a) => a.type === "budget_change");
    expect(ok).toHaveLength(1);
    expect(ok[0].rationale).toContain("ROAS 2.0 >= Ziel 1.5");
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

describe("computeStructureFindings (Struktur-Review, report-only)", () => {
  it("qs_weakness: QS <= 4 mit Kosten wird gemeldet, mit Komponenten-Hebel; QS 5+ nicht", () => {
    const d = data({
      keywordQuality: [
        { campaign: "K", adGroup: "AG", keyword: "hotel tessin", matchType: "PHRASE", qualityScore: 3, expectedCtr: "AVERAGE", adRelevance: "BELOW_AVERAGE", landingPageExperience: "BELOW_AVERAGE", costChf: 120, conversions: 1 },
        { campaign: "K", adGroup: "AG", keyword: "gutes keyword", matchType: "EXACT", qualityScore: 8, expectedCtr: "ABOVE_AVERAGE", adRelevance: "AVERAGE", landingPageExperience: "AVERAGE", costChf: 200, conversions: 5 },
        { campaign: "K", adGroup: "AG", keyword: "unbewertet", matchType: "BROAD", qualityScore: null, expectedCtr: "UNKNOWN", adRelevance: "UNKNOWN", landingPageExperience: "UNKNOWN", costChf: 90, conversions: 0 },
      ],
    });
    const f = computeStructureFindings(d).filter((x) => x.type === "qs_weakness");
    expect(f).toHaveLength(1);
    expect(f[0].entity).toContain("hotel tessin");
    expect(f[0].rationale).toContain("Quality Score 3/10");
    expect(f[0].rationale).toContain("Ad Relevance");
    expect(f[0].rationale).toContain("Landing Page");
    expect(f[0].actionClass).toBe("report-only");
  });

  it("adgroup_anomaly: CPA-Ausreisser (>30%) und Kostenfresser ohne Conversions", () => {
    const d = data({
      adGroupPerformance: [
        { campaign: "K", adGroup: "Teuer", costChf: 500, conversions: 5, convValue: 0 },   // CPA 100 = +100%
        { campaign: "K", adGroup: "Normal", costChf: 250, conversions: 5, convValue: 0 },  // CPA 50 = 0%
        { campaign: "K", adGroup: "Fresser", costChf: 200, conversions: 0, convValue: 0 }, // > 3x CPA, 0 Conv.
        { campaign: "K", adGroup: "Klein", costChf: 40, conversions: 0, convValue: 0 },    // unter Schwelle
      ],
      meta: { customerId: "1", costSumChf: 0, avgCpaChf: 50 },
    });
    const f = computeStructureFindings(d).filter((x) => x.type === "adgroup_anomaly");
    expect(f.map((x) => x.entity)).toEqual(["K | Teuer", "K | Fresser"]);
    for (const x of f) expect(x.actionClass).toBe("report-only");
  });

  it("mom_regression: ROAS-Einbruch > 20% MoM wird gemeldet (alle Kampagnentypen), stabile nicht", () => {
    const d = data({
      monthComparison: [
        { campaign: "PMax A", channelType: "PERFORMANCE_MAX", cost: 1000, costPrev: 1000, conversions: 20, conversionsPrev: 22, convValue: 3000, convValuePrev: 8000, roas: 3, roasPrev: 8 },
        { campaign: "Search B", channelType: "SEARCH", cost: 500, costPrev: 480, conversions: 10, conversionsPrev: 11, convValue: 2600, convValuePrev: 2500, roas: 5.2, roasPrev: 5.2 },
        { campaign: "Duenn C", channelType: "SEARCH", cost: 100, costPrev: 90, conversions: 1, conversionsPrev: 2, convValue: 0, convValuePrev: 400, roas: 0, roasPrev: 4.4 }, // Vormonat < 5 Conv. -> keine Meldung
      ],
    });
    const f = computeStructureFindings(d).filter((x) => x.type === "mom_regression");
    expect(f).toHaveLength(1);
    expect(f[0].entity).toBe("PMax A");
    expect(f[0].rationale).toContain("PERFORMANCE_MAX");
    expect(f[0].actionClass).toBe("report-only");
  });

  it("mom_regression: Kampagne lief im Vormonat, jetzt ohne Spend -> Hinweis", () => {
    const d = data({
      monthComparison: [
        { campaign: "Pausiert", channelType: "SEARCH", cost: 0, costPrev: 300, conversions: 0, conversionsPrev: 8, convValue: 0, convValuePrev: 1200, roas: null, roasPrev: 4 },
      ],
    });
    const f = computeStructureFindings(d).filter((x) => x.type === "mom_regression");
    expect(f).toHaveLength(1);
    expect(f[0].rationale).toContain("ohne Spend");
  });

  it("liefert NIE etwas anderes als report-only", () => {
    const d = data({
      keywordQuality: [{ campaign: "K", adGroup: "A", keyword: "x", matchType: "EXACT", qualityScore: 2, expectedCtr: "BELOW_AVERAGE", adRelevance: "BELOW_AVERAGE", landingPageExperience: "BELOW_AVERAGE", costChf: 500, conversions: 0 }],
      adGroupPerformance: [{ campaign: "K", adGroup: "A", costChf: 900, conversions: 0, convValue: 0 }],
      monthComparison: [{ campaign: "K", channelType: "SEARCH", cost: 100, costPrev: 500, conversions: 1, conversionsPrev: 20, convValue: 100, convValuePrev: 4000, roas: 1, roasPrev: 8 }],
      meta: { customerId: "1", costSumChf: 0, avgCpaChf: 50 },
    });
    const f = computeStructureFindings(d);
    expect(f.length).toBeGreaterThan(0);
    expect(f.every((x) => x.actionClass === "report-only" && x.exec === undefined)).toBe(true);
  });
});

describe("computeBrandOtaFindings (Hotel-Playbook)", () => {
  it("brand_is_alert: Brand-IS < 90% aus oeffentlichen IS-Metriken (Ersatz fuer Auction Insights)", () => {
    const d = data({
      campaigns: [
        { name: "SN - DE - Brand - X", status: "ENABLED", dailyBudgetChf: 20, costChf: 500, conversions: 30, conversionValue: 9000, roas: 18, budgetLostIs: 0.3, biddingSystemStatus: "ENABLED", learning: false, searchImpressionShare: 0.62, searchAbsTopImpressionShare: 0.5, rankLostIs: 0.08 },
        { name: "SN - DE - Brand - OK", status: "ENABLED", dailyBudgetChf: 20, costChf: 100, conversions: 10, conversionValue: 3000, roas: 30, budgetLostIs: 0, biddingSystemStatus: "ENABLED", learning: false, searchImpressionShare: 0.95, searchAbsTopImpressionShare: 0.9 },
        { name: "Non-Brand Y", status: "ENABLED", dailyBudgetChf: 20, costChf: 100, conversions: 5, conversionValue: 500, roas: 5, budgetLostIs: 0.5, biddingSystemStatus: "ENABLED", learning: false, searchImpressionShare: 0.3, searchAbsTopImpressionShare: 0.1 },
      ],
    });
    const f = computeBrandOtaFindings(d, cfg({ industry: "hotel" })).filter((x) => x.type === "brand_is_alert");
    expect(f).toHaveLength(1);
    expect(f[0].entity).toBe("SN - DE - Brand - X");
    expect(f[0].rationale).toContain("62%");
    // IS-Verlust-Aufteilung: Budget vs. Rang, mit klarer Hebel-Aussage
    expect(f[0].rationale).toContain("30 Prozentpunkte auf ein zu knappes Budget");
    expect(f[0].rationale).toContain("8 Prozentpunkte auf einen zu tiefen Rang");
    expect(f[0].rationale).toContain("der Hebel ist hier also das Budget");
    expect(f[0].actionClass).toBe("report-only");
    expect(computeBrandOtaFindings(d, cfg({ industry: "kmu-local" }))).toEqual([]);
  });

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
