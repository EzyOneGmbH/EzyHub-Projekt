import { describe, it, expect } from "vitest";
import {
  verdictFromWindows,
  parseCampaignFromEntity,
  matchImplementationSuggestions,
  type OutcomeWindowAgg,
} from "./google-ads-recommendations.server";

// Phase D (Advisory-Brief): deterministische Verdict-Regeln - Fenster, Metriken
// und Schwellen stehen im Code, nie beim LLM. Lieber ehrlich inconclusive als
// falsch kausal.

const W = (over: Partial<OutcomeWindowAgg> = {}): OutcomeWindowAgg => ({
  costChf: 500,
  conversions: 10,
  conversionValue: 2500,
  clicks: 400,
  impressions: 10000,
  ...over,
});

describe("verdictFromWindows (pure, deterministisch)", () => {
  it("ROAS-Typ: +>10% = improved, -<10% = worsened, Band = neutral", () => {
    expect(
      verdictFromWindows("bid_strategy_change", W(), W({ conversionValue: 3500 })).verdict,
    ).toBe("improved");
    expect(
      verdictFromWindows("bid_strategy_change", W(), W({ conversionValue: 1500 })).verdict,
    ).toBe("worsened");
    expect(
      verdictFromWindows("bid_strategy_change", W(), W({ conversionValue: 2600 })).verdict,
    ).toBe("neutral");
  });

  it("CPA-Typ: sinkender CPA = improved (Richtung invertiert)", () => {
    const v = verdictFromWindows("bid_signal_gap", W(), W({ conversions: 15 })); // CPA 50 -> 33
    expect(v.metric).toBe("cpa");
    expect(v.verdict).toBe("improved");
  });

  it("keyword_pause: Kosten -30% ohne Conversion-Verlust = improved; Conversion-Einbruch = worsened", () => {
    expect(verdictFromWindows("keyword_pause", W(), W({ costChf: 350 })).verdict).toBe("improved");
    expect(
      verdictFromWindows("keyword_pause", W(), W({ costChf: 350, conversions: 5 })).verdict,
    ).toBe("worsened");
  });

  it("inconclusive bei zu wenig Daten (Kosten beider Fenster < CHF 50)", () => {
    const v = verdictFromWindows(
      "bid_strategy_change",
      W({ costChf: 10, conversionValue: 5 }),
      W({ costChf: 12, conversionValue: 6 }),
    );
    expect(v.verdict).toBe("inconclusive");
    expect(v.reason).toContain("zu wenig Daten");
  });

  it("inconclusive, wenn die Primaermetrik nicht in beiden Fenstern berechenbar ist", () => {
    const v = verdictFromWindows("bid_signal_gap", W({ conversions: 0 }), W({ conversions: 0 })); // CPA nie berechenbar
    expect(v.verdict).toBe("inconclusive");
  });
});

describe("parseCampaignFromEntity (v1: Kampagnen-Ebene)", () => {
  it("nimmt das erste Segment als Kampagne, wenn es dem Konto-Schema entspricht", () => {
    expect(parseCampaignFromEntity("SN - DE - Brand - La Campagnola | DE Brand")).toBe(
      "SN - DE - Brand - La Campagnola",
    );
    expect(parseCampaignFromEntity("PMax - DE - Ferienhotel")).toBe("PMax - DE - Ferienhotel");
  });
  it("liefert null fuer nicht kampagnen-messbare Entitaeten (ehrlich inconclusive statt falsch)", () => {
    expect(parseCampaignFromEntity("kinderhotel schweiz")).toBeNull();
    expect(parseCampaignFromEntity("PMax Asset-Gruppe: Hotel-Restaurant La Campagnola")).toBeNull();
  });
});

describe("matchImplementationSuggestions (Vorschlag, Bestaetigung Mensch)", () => {
  const rec = {
    id: "r1",
    recommendation_type: "bid_strategy_change",
    entity: "SN - DE - Brand - La Campagnola",
    title: "T",
  };
  it("matcht Entitaet + plausible Aenderungsart (bidding-Event auf derselben Kampagne)", () => {
    const out = matchImplementationSuggestions(
      [rec],
      [
        {
          campaign: "SN - DE - Brand - La Campagnola",
          occurred_at: "2026-07-10",
          user_email: "x@y.ch",
          resource_type: "CAMPAIGN",
          is_bidding_change: true,
        },
      ],
    );
    expect(out).toHaveLength(1);
    expect(out[0].recommendationId).toBe("r1");
  });
  it("schlaegt NICHTS vor, wenn die Aenderungsart nicht plausibel ist", () => {
    const out = matchImplementationSuggestions(
      [rec],
      [
        {
          campaign: "SN - DE - Brand - La Campagnola",
          occurred_at: "2026-07-10",
          user_email: "x@y.ch",
          resource_type: "AD_GROUP_CRITERION",
          is_bidding_change: false,
        },
      ],
    );
    expect(out).toHaveLength(0);
  });
});
