import { describe, it, expect } from "vitest";
import {
  checkSemanticProposals,
  MAX_SEMANTIC_PER_RUN,
  SEMANTIC_ACTION_TYPE,
  type SemanticProposal,
  type SemanticCheckContext,
} from "./google-ads-semantic.server";
import { planActions, type AutopilotConfig, type AutopilotData } from "./google-ads-autopilot.server";

// Phase-2-Abnahme: Klassifizierungs-Leitplanken (semantisch landet NIE in
// auto-execute, auch bei autonomy_level >= 1), Konfliktcheck, Limit, Dedupe.

const prop = (over: Partial<SemanticProposal> = {}): SemanticProposal => ({
  term: "hotel job tessin", campaign: "SN - DE - Suche", adGroup: "AG",
  kategorie: "jobs", begruendung: "Stellensuche, kein Buchungsinteresse",
  matchType: "EXACT", costChf: 24, clicks: 9, ...over,
});

const ctx = (over: Partial<SemanticCheckContext> = {}): SemanticCheckContext => ({
  noTouch: new Set(), convertingTerms: [], existingNegatives: new Set(), pendingKeys: new Set(), ...over,
});

describe("checkSemanticProposals (deterministische Nachpruefung)", () => {
  it("queued gueltige Vorschlaege, verwirft no_touch / Duplikate / bestehende Negatives", () => {
    const d = checkSemanticProposals(
      [
        prop(),
        prop({ term: "hotel job tessin" }), // Duplikat im Run
        prop({ term: "gesperrt", campaign: "NoTouch-Kampagne" }),
        prop({ term: "schon negativ" }),
      ],
      ctx({ noTouch: new Set(["NoTouch-Kampagne"]), existingNegatives: new Set(["schon negativ"]) }),
    );
    expect(d[0].action).toBe("queue");
    expect(d[1]).toMatchObject({ action: "reject", reason: "Duplikat im selben Run" });
    expect(d[2].action).toBe("reject");
    expect(d[3]).toMatchObject({ action: "reject", reason: "bereits als Negative vorhanden" });
  });

  it("Konfliktcheck: EXACT nur bei exakt konvertierendem Begriff, PHRASE bei enthaltenem Muster", () => {
    const c = ctx({ convertingTerms: [{ term: "familienhotel tessin pool", campaign: "K2" }] });
    expect(checkSemanticProposals([prop({ term: "tessin", matchType: "EXACT" })], c)[0].action).toBe("queue");
    const phrase = checkSemanticProposals([prop({ term: "tessin", matchType: "PHRASE" })], c)[0];
    expect(phrase.action).toBe("reject");
    expect((phrase as any).reason).toContain("Konflikt");
  });

  it("Limit: maximal 15 pro Run, Rest wird mit Begruendung verworfen", () => {
    const many = Array.from({ length: 20 }, (_, i) => prop({ term: `irrelevanter begriff ${i}` }));
    const d = checkSemanticProposals(many, ctx());
    expect(d.filter((x) => x.action === "queue")).toHaveLength(MAX_SEMANTIC_PER_RUN);
    expect(d.filter((x) => x.action === "reject" && (x as any).reason.includes("Limit"))).toHaveLength(20 - MAX_SEMANTIC_PER_RUN);
  });

  it("Dedupe gegen offene Approvals (pendingKeys)", () => {
    const c = ctx({ pendingKeys: new Set([`${SEMANTIC_ACTION_TYPE}::SN - DE - Suche | hotel job tessin`]) });
    expect(checkSemanticProposals([prop()], c)[0]).toMatchObject({ action: "reject" });
  });
});

describe("Leitplanke: semantisch landet NIE in auto-execute", () => {
  it("planActions (deterministische Engine) kennt den semantischen Typ nicht - auch bei autonomy_level >= 1 existiert kein auto-execute-Pfad fuer LLM-Urteile", () => {
    // Die semantische Pipeline laeuft ausschliesslich ueber queueSemanticNegatives,
    // das action_class hart auf 'approval-needed' setzt. Die einzige auto-execute-
    // Quelle ist planActions (Kostenregel) - sie erzeugt nie den semantischen Typ.
    const cfg: AutopilotConfig = {
      client_id: "c1", industry: "hotel", kill_switch: false, observe_only: false,
      autonomy_level: 2, monthly_budget_chf: 1000, target_cpa_chf: 50, target_roas: null,
      season_high: [], season_low: [], no_touch_campaigns: [], languages: ["de"],
      notes: null, notes_updated_at: null, min_conversions_baseline: 3,
      conversion_lag_days: 7, min_conversions_for_budget_rec: 5,
    };
    const data: AutopilotData = {
      campaigns: [], termWindow: { from: "a", to: "b", lagDays: 7 },
      searchTerms: [{ term: "teurer job begriff", campaign: "K", adGroup: "AG", costChf: 400, conversions: 0, clicks: 20 }],
      trackingHealth: { status: "OK", spend7d: 1, conversions7d: 1, conversionsBaseline30d: 30 },
      auctionInsights: [], adGroupPerformance: [], keywordQuality: [], monthComparison: [],
      pmaxSearchThemes: [], geoPerformance: [], devicePerformance: [], assetIssues: [],
      pmaxAssetGroups: [], changeHistory: [], dataSourceErrors: [],
      meta: { customerId: "1", costSumChf: 0, avgCpaChf: 50 }, error: null,
    };
    const acts = planActions(data, cfg);
    expect(acts.some((a) => a.type === SEMANTIC_ACTION_TYPE)).toBe(false);
    // Und die Kostenregel selbst darf bei Level 2 auto-executen - der semantische
    // Typ taucht dort trotzdem nirgends auf.
    expect(acts.filter((a) => a.actionClass === "auto-execute").every((a) => a.type === "add_negative")).toBe(true);
  });
});
