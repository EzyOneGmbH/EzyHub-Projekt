import { describe, it, expect } from "vitest";
import {
  computeVerdict,
  checkAutonomy,
  campaignFromEntity,
  termFromAfterValue,
  type ScoreRow,
} from "./google-ads-outcome.server";

// Phase-4-Abnahme: deterministische Verdict- und Freischalt-Logik (pure functions).

describe("computeVerdict (4.1)", () => {
  it("positive bei CPA-Verbesserung > 5%", () => {
    expect(computeVerdict({ cost: 500, conversions: 10 }, { cost: 450, conversions: 10 })).toBe(
      "positive",
    ); // 50 -> 45 = -10%
  });
  it("negative bei Verschlechterung > 10%", () => {
    expect(computeVerdict({ cost: 500, conversions: 10 }, { cost: 600, conversions: 10 })).toBe(
      "negative",
    ); // 50 -> 60 = +20%
  });
  it("neutral in der Totzone (-5%..+10%)", () => {
    expect(computeVerdict({ cost: 500, conversions: 10 }, { cost: 520, conversions: 10 })).toBe(
      "neutral",
    ); // +4%
    expect(computeVerdict({ cost: 500, conversions: 10 }, { cost: 490, conversions: 10 })).toBe(
      "neutral",
    ); // -2%
  });
  it("inconclusive bei zu wenig Daten", () => {
    expect(computeVerdict({ cost: 100, conversions: 1 }, { cost: 100, conversions: 2 })).toBe(
      "inconclusive",
    ); // < 5 Conv. gesamt
    expect(computeVerdict({ cost: 0, conversions: 0 }, { cost: 100, conversions: 10 })).toBe(
      "inconclusive",
    ); // kein Vorher-Spend
    expect(computeVerdict({ cost: 100, conversions: 8 }, { cost: 100, conversions: 0 })).toBe(
      "inconclusive",
    ); // CPA nachher undefiniert
  });
});

const row = (over: Partial<ScoreRow>): ScoreRow => ({
  action_type: "add_negative",
  n_total: 0,
  n_positive: 0,
  n_neutral: 0,
  n_negative: 0,
  n_inconclusive: 0,
  hit_rate: null,
  avoided_waste_chf_sum: 0,
  ...over,
});

describe("checkAutonomy (4.3 Freischaltkriterien)", () => {
  it("Level 0->1 erst ab n>=15, hit>=90%, 0 negative", () => {
    const ok = checkAutonomy(
      [row({ n_total: 16, n_positive: 12, n_neutral: 3, n_inconclusive: 1 })],
      false,
    );
    expect(ok.negativesReadyForL1).toBe(true); // 15/15 entschieden = 100%
    const tooFew = checkAutonomy([row({ n_total: 14, n_positive: 14 })], false);
    expect(tooFew.negativesReadyForL1).toBe(false);
    const hasNegative = checkAutonomy(
      [row({ n_total: 20, n_positive: 18, n_neutral: 1, n_negative: 1 })],
      false,
    );
    expect(hasNegative.negativesReadyForL1).toBe(false); // n_negative muss 0 sein
  });
  it("Level 1->2 nur mit bid_writes_enabled UND Bid-Scorecard", () => {
    const rows = [
      row({
        action_type: "bid_adjustment",
        n_total: 12,
        n_positive: 8,
        n_neutral: 2,
        n_inconclusive: 2,
      }),
    ];
    expect(checkAutonomy(rows, false).bidsReadyForL2).toBe(false); // Flag aus
    expect(checkAutonomy(rows, true).bidsReadyForL2).toBe(true); // 10/10 = 100%
  });
  it("meldet Datenproblem bei >50% inconclusive", () => {
    const r = checkAutonomy([row({ n_total: 10, n_inconclusive: 6, n_positive: 4 })], false);
    expect(r.dataProblems.length).toBe(1);
    expect(r.dataProblems[0]).toContain("inconclusive");
  });
});

describe("Parsing-Helfer", () => {
  it("extrahiert Kampagne aus Changelog-Entity", () => {
    expect(campaignFromEntity("SN - DE - Brand | AG Zimmer")).toBe("SN - DE - Brand");
    expect(campaignFromEntity("Nur Kampagne")).toBe("Nur Kampagne");
  });
  it("extrahiert Negative-Term aus after_value", () => {
    expect(termFromAfterValue('+ "billige unterkunft" (negative exact)')).toBe(
      "billige unterkunft",
    );
    expect(termFromAfterValue("CHF 22.00/Tag")).toBeNull();
  });
});
