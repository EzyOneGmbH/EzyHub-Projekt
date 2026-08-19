import { describe, expect, it } from "vitest";
import {
  canConfigureAutopilot,
  computeBudgetPacing,
  computeEffectiveDryRun,
  describeConfigChange,
  executionGate,
  sanitizeConfigPatch,
} from "./adsAutopilotPolicy";

describe("canConfigureAutopilot (Rollen)", () => {
  it("erlaubt nur owner und admin", () => {
    expect(canConfigureAutopilot("owner")).toBe(true);
    expect(canConfigureAutopilot("admin")).toBe(true);
    expect(canConfigureAutopilot("member")).toBe(false);
    expect(canConfigureAutopilot("viewer")).toBe(false);
    expect(canConfigureAutopilot(null)).toBe(false);
    expect(canConfigureAutopilot(undefined)).toBe(false);
    expect(canConfigureAutopilot("")).toBe(false);
  });
});

describe("computeEffectiveDryRun (observe_only-Invariante)", () => {
  it("observe_only erzwingt Dry-Run unabhaengig von Autonomie und Request", () => {
    expect(
      computeEffectiveDryRun({ requestedDryRun: false, observeOnly: true, autonomyLevel: 2 }),
    ).toBe(true);
  });
  it("autonomy_level 0 erzwingt Dry-Run auch ohne observe_only", () => {
    expect(
      computeEffectiveDryRun({ requestedDryRun: false, observeOnly: false, autonomyLevel: 0 }),
    ).toBe(true);
  });
  it("Tracking-BROKEN erzwingt Dry-Run", () => {
    expect(
      computeEffectiveDryRun({
        requestedDryRun: false,
        observeOnly: false,
        autonomyLevel: 2,
        trackingBroken: true,
      }),
    ).toBe(true);
  });
  it("nur wenn ALLE Gates offen sind, ist ein echter Write moeglich", () => {
    expect(
      computeEffectiveDryRun({ requestedDryRun: false, observeOnly: false, autonomyLevel: 1 }),
    ).toBe(false);
    expect(
      computeEffectiveDryRun({ requestedDryRun: true, observeOnly: false, autonomyLevel: 1 }),
    ).toBe(true);
  });
});

describe("executionGate (Freigabe-Ausfuehrung)", () => {
  it("Kill-Switch blockiert die Ausfuehrung einer Freigabe", () => {
    const g = executionGate({ observeOnly: false, killSwitch: true });
    expect(g.allowed).toBe(false);
    expect(g.reason).toMatch(/Kill-Switch/);
  });
  it("Beobachtungsmodus blockiert die Ausfuehrung einer Freigabe", () => {
    const g = executionGate({ observeOnly: true, killSwitch: false });
    expect(g.allowed).toBe(false);
    expect(g.reason).toMatch(/Beobachtungsmodus/);
  });
  it("Kill-Switch hat Vorrang vor observe_only (klarste Meldung zuerst)", () => {
    const g = executionGate({ observeOnly: true, killSwitch: true });
    expect(g.reason).toMatch(/Kill-Switch/);
  });
  it("Tracking-BROKEN blockiert", () => {
    const g = executionGate({ observeOnly: false, killSwitch: false, trackingBroken: true });
    expect(g.allowed).toBe(false);
  });
  it("ohne Gates ist die Ausfuehrung erlaubt", () => {
    expect(executionGate({ observeOnly: false, killSwitch: false }).allowed).toBe(true);
  });
});

describe("computeBudgetPacing", () => {
  // 15. Tag eines 30-Tage-Monats (Juni) - halber Monat vorbei.
  const midJune = new Date(2026, 5, 15, 12, 0, 0);

  it("meldet no_budget ohne gepflegtes Monatsbudget (Setup-Hinweis-Fall)", () => {
    const p = computeBudgetPacing({
      monthlyBudgetChf: 0,
      budgetSource: "none",
      mtdSpendChf: 500,
      today: midJune,
    });
    expect(p.status).toBe("no_budget");
    expect(p.monthlyBudgetChf).toBeNull();
    expect(p.expectedToDateChf).toBeNull();
    // Prognose bleibt moeglich (linear aus Ist-Spend)
    expect(p.forecastEomChf).toBe(1000);
  });

  it("on_track bei planmaessigem Spend", () => {
    const p = computeBudgetPacing({
      monthlyBudgetChf: 3000,
      budgetSource: "client",
      mtdSpendChf: 1500,
      today: midJune,
    });
    expect(p.status).toBe("on_track");
    expect(p.expectedToDateChf).toBe(1500);
    expect(p.forecastEomChf).toBe(3000);
    expect(p.pacingRatio).toBe(1);
  });

  it("under bei deutlichem Unterpacing", () => {
    const p = computeBudgetPacing({
      monthlyBudgetChf: 3000,
      budgetSource: "client",
      mtdSpendChf: 900,
      today: midJune,
    });
    expect(p.status).toBe("under");
    expect(p.pacingRatio).toBeLessThan(0.8);
  });

  it("over bei deutlichem Ueberpacing inkl. Prognose ueber Budget", () => {
    const p = computeBudgetPacing({
      monthlyBudgetChf: 3000,
      budgetSource: "client",
      mtdSpendChf: 2100,
      today: midJune,
    });
    expect(p.status).toBe("over");
    expect(p.forecastEomChf).toBe(4200);
  });

  it("rechnet mit der echten Monatslaenge (Februar)", () => {
    const p = computeBudgetPacing({
      monthlyBudgetChf: 2800,
      budgetSource: "client",
      mtdSpendChf: 700,
      today: new Date(2026, 1, 7, 12, 0, 0), // 7. Februar 2026 (28 Tage)
    });
    expect(p.daysInMonth).toBe(28);
    expect(p.expectedToDateChf).toBe(700);
    expect(p.status).toBe("on_track");
  });
});

describe("sanitizeConfigPatch", () => {
  it("akzeptiert einen gueltigen Patch und normalisiert no_touch", () => {
    const r = sanitizeConfigPatch({
      observe_only: false,
      autonomy_level: 1,
      target_cpa_chf: "45.5",
      target_roas: null,
      monthly_budget_chf: 3000,
      no_touch_campaigns: [" Brand CH ", "Brand CH", "", 42],
    });
    expect(r.ok).toBe(true);
    expect(r.patch).toEqual({
      observe_only: false,
      autonomy_level: 1,
      target_cpa_chf: 45.5,
      target_roas: null,
      monthly_budget_chf: 3000,
      no_touch_campaigns: ["Brand CH", "42"],
    });
  });
  it("lehnt ungueltige Autonomie-Level ab", () => {
    expect(sanitizeConfigPatch({ autonomy_level: 3 }).ok).toBe(false);
    expect(sanitizeConfigPatch({ autonomy_level: -1 }).ok).toBe(false);
    expect(sanitizeConfigPatch({ autonomy_level: 1.5 }).ok).toBe(false);
  });
  it("lehnt Nicht-Boolean fuer observe_only/kill_switch ab", () => {
    expect(sanitizeConfigPatch({ observe_only: "false" }).ok).toBe(false);
    expect(sanitizeConfigPatch({ kill_switch: 1 }).ok).toBe(false);
  });
  it("lehnt negative Zielwerte und leere Patches ab", () => {
    expect(sanitizeConfigPatch({ target_cpa_chf: -5 }).ok).toBe(false);
    expect(sanitizeConfigPatch({}).ok).toBe(false);
    expect(sanitizeConfigPatch(null).ok).toBe(false);
  });
});

describe("describeConfigChange", () => {
  it("beschreibt nur echte Aenderungen, menschlich lesbar", () => {
    const lines = describeConfigChange(
      { observe_only: true, autonomy_level: 0, no_touch_campaigns: [] },
      { observe_only: false, autonomy_level: 0, no_touch_campaigns: ["Brand CH"] },
    );
    expect(lines).toContain("Beobachtungsmodus: an → aus");
    expect(lines.some((l) => l.startsWith("Autonomie-Level"))).toBe(false);
    expect(lines).toContain("Geschuetzte Kampagnen: keine → Brand CH");
  });
});
