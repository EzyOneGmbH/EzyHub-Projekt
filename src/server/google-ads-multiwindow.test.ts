import { describe, it, expect } from "vitest";
import { detectStrategyChanges, periodRanges, windowMetrics } from "./google-ads-autopilot.server";

// Phase A (Advisory-Vertiefung): Abnahme-Belege fuer die Mehrfenster-Basis.
// (1) Strategiewechsel werden aus der Aenderungshistorie erkannt und
// (2) das L90-Fenster wird am Wechsel in zwei Perioden getrennt -
// nie ueber den Wechsel hinweg gemittelt.

const idToName = new Map([
  ["111", "SN - DE - Brand"],
  ["222", "PMax - DE - Ferienhotel"],
]);

describe("detectStrategyChanges (Strategie-Segmentierung, pure)", () => {
  it("erkennt Gebotsstrategie-Wechsel an CAMPAIGN-Events mit bidding-Feldern", () => {
    const out = detectStrategyChanges(
      [
        {
          at: "2026-07-10 11:55:00",
          resourceType: "CAMPAIGN",
          fields: "maximize_conversion_value.target_roas",
          campaignRef: "customers/1/campaigns/111",
        },
        {
          at: "2026-07-09 09:00:00",
          resourceType: "AD_GROUP_CRITERION",
          fields: "cpc_bid_micros",
          campaignRef: "customers/1/campaigns/111",
        },
        {
          at: "2026-07-08 08:00:00",
          resourceType: "CAMPAIGN",
          fields: "name",
          campaignRef: "customers/1/campaigns/222",
        },
      ],
      idToName,
    );
    expect(out).toEqual([
      {
        campaign: "SN - DE - Brand",
        at: "2026-07-10 11:55:00",
        fields: "maximize_conversion_value.target_roas",
      },
    ]);
  });

  it("nimmt nur den JUENGSTEN Wechsel je Kampagne (Historie ist DESC sortiert)", () => {
    const out = detectStrategyChanges(
      [
        {
          at: "2026-07-12 10:00:00",
          resourceType: "CAMPAIGN",
          fields: "bidding_strategy_type",
          campaignRef: "customers/1/campaigns/222",
        },
        {
          at: "2026-07-01 10:00:00",
          resourceType: "CAMPAIGN",
          fields: "bidding_strategy_type",
          campaignRef: "customers/1/campaigns/222",
        },
      ],
      idToName,
    );
    expect(out).toHaveLength(1);
    expect(out[0].at).toBe("2026-07-12 10:00:00");
  });

  it("ignoriert Events ohne aufloesbare Kampagne", () => {
    const out = detectStrategyChanges(
      [
        {
          at: "2026-07-12 10:00:00",
          resourceType: "CAMPAIGN",
          fields: "bidding_strategy_type",
          campaignRef: "customers/1/campaigns/999",
        },
      ],
      idToName,
    );
    expect(out).toHaveLength(0);
  });
});

describe("periodRanges (L90 wird am Wechsel getrennt, pure)", () => {
  it("liefert zwei anschlusslose Perioden: vor dem Wechsel / ab dem Wechsel", () => {
    const r = periodRanges("2026-07-01 12:30:00", "2026-07-13");
    expect(r).not.toBeNull();
    expect(r!.before.to).toBe("2026-06-30"); // Tag VOR dem Wechsel
    expect(r!.after.from).toBe("2026-07-01"); // Wechseltag beginnt die neue Periode
    expect(r!.after.to).toBe("2026-07-13");
    expect(r!.before.days + r!.after.days).toBe(91); // volles Fenster, keine Doppelzaehlung
  });

  it("liefert null, wenn der Wechsel ausserhalb des Fensters liegt", () => {
    expect(periodRanges("2026-01-01 00:00:00", "2026-07-13")).toBeNull();
  });
});

describe("windowMetrics (Fenster-Kennzahlen, pure)", () => {
  it("berechnet ROAS/CPA und rundet; ohne Kosten/Conversions -> null statt Division", () => {
    expect(windowMetrics(200, 8, 1000)).toEqual({
      costChf: 200,
      conversions: 8,
      conversionValue: 1000,
      roas: 5,
      cpaChf: 25,
    });
    expect(windowMetrics(0, 0, 0)).toEqual({
      costChf: 0,
      conversions: 0,
      conversionValue: 0,
      roas: null,
      cpaChf: null,
    });
  });
});
