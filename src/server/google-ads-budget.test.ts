import { describe, it, expect } from "vitest";
import {
  sumDedupedDailyBudgets,
  seasonalHistoricalEstimate,
  budgetSourceLanguage,
  resolveBudgetAnchor,
} from "./google-ads-budget.server";

// Budget-Anker: dreistufige Aufloesung mit Herkunftsnachweis. Reine Helfer +
// die Aufloesung mit gemocktem Query-Fn (kein Netz).

describe("sumDedupedDailyBudgets", () => {
  it("zaehlt shared budgets (gleiche id) nur einmal", () => {
    const r = sumDedupedDailyBudgets([
      { budgetId: "b1", amountChf: 20 },
      { budgetId: "b1", amountChf: 20 }, // shared -> nicht doppelt
      { budgetId: "b2", amountChf: 15 },
    ]);
    expect(r.dailyChf).toBe(35);
    expect(r.budgetCount).toBe(2);
  });
  it("ignoriert leere ids und Nullbetraege", () => {
    const r = sumDedupedDailyBudgets([
      { budgetId: "", amountChf: 99 },
      { budgetId: "b1", amountChf: 0 },
      { budgetId: "b2", amountChf: 10 },
    ]);
    expect(r.dailyChf).toBe(10);
    expect(r.budgetCount).toBe(1);
  });
});

describe("seasonalHistoricalEstimate (saisonal, NICHT Jahresdurchschnitt)", () => {
  // aktueller Monat: 2026-07
  it("Vorjahresmonat x Jahrestrend, wenn Vorjahr + 3 Vergleichsmonate vorliegen", () => {
    const cost: Record<string, number> = {
      "2025-07": 1000, // Vorjahresmonat
      // letzte 3 abgeschlossene Monate 2026 und ihr Vorjahr (Trend = 1.2)
      "2026-06": 1200, "2025-06": 1000,
      "2026-05": 1200, "2025-05": 1000,
      "2026-04": 1200, "2025-04": 1000,
    };
    const est = seasonalHistoricalEstimate(cost, 2026, 7);
    expect(est.value).toBeCloseTo(1200, 0); // 1000 * 1.2
    expect(est.reason).toContain("Jahrestrend");
  });
  it("ohne Vorjahresmonat: Mittel der letzten Monate, ausdruecklich NICHT saisonal", () => {
    const cost: Record<string, number> = { "2026-06": 800, "2026-05": 1000, "2026-04": 1200 };
    const est = seasonalHistoricalEstimate(cost, 2026, 7);
    expect(est.value).toBe(1000); // Mittel 800/1000/1200
    expect(est.reason).toContain("NICHT saisonal");
  });
  it("liefert null ohne jede Historie", () => {
    expect(seasonalHistoricalEstimate({}, 2026, 7).value).toBeNull();
  });
});

describe("budgetSourceLanguage (keine abgeleitete Quelle als bestaetigtes Budget)", () => {
  it("client hat volle Autoritaet, abgeleitete Quellen nicht", () => {
    expect(budgetSourceLanguage("client").head).toContain("Budget-Ueberschreitung");
    expect(budgetSourceLanguage("client").capWarn).toBe(false);
    expect(budgetSourceLanguage("account").head).toContain("Konto-Konfiguration");
    expect(budgetSourceLanguage("account").capWarn).toBe(false);
    expect(budgetSourceLanguage("historical").head).toContain("kein bestaetigtes Budget");
    expect(budgetSourceLanguage("historical").capWarn).toBe(true);
  });
});

describe("resolveBudgetAnchor (Reihenfolge client -> account -> historical -> none)", () => {
  const now = new Date("2026-07-15T00:00:00Z");
  const okRows = (rows: any[]) => async () => ({ ok: true, rows });

  it("client hat Vorrang und fragt das Konto gar nicht ab", async () => {
    let called = false;
    const a = await resolveBudgetAnchor(async () => { called = true; return { ok: true, rows: [] }; }, 5000, now);
    expect(a.source).toBe("client");
    expect(a.monthlyBudgetChf).toBe(5000);
    expect(called).toBe(false);
  });

  it("account: Summe aktiver Tagesbudgets x 30.4 (shared dedupe)", async () => {
    const q = okRows([
      { campaign: { name: "A" }, campaignBudget: { id: "b1", amountMicros: 20_000_000 } },
      { campaign: { name: "B" }, campaignBudget: { id: "b1", amountMicros: 20_000_000 } }, // shared
      { campaign: { name: "C" }, campaignBudget: { id: "b2", amountMicros: 15_000_000 } },
    ]);
    const a = await resolveBudgetAnchor(q, 0, now);
    expect(a.source).toBe("account");
    expect(a.monthlyBudgetChf).toBeCloseTo(35 * 30.4, 1); // 1064
  });

  it("historical: wenn keine aktiven Tagesbudgets, saisonal aus der Historie", async () => {
    const q = async (gaql: string) => {
      if (gaql.includes("campaign_budget.amount_micros")) return { ok: true, rows: [] }; // account leer
      // historical-Query: Monatskosten aktiver Kampagnen
      return {
        ok: true,
        rows: [
          { campaign: { name: "A" }, segments: { month: "2025-07-01" }, metrics: { costMicros: 1000_000000 } },
          { campaign: { name: "A" }, segments: { month: "2026-06-01" }, metrics: { costMicros: 1200_000000 } },
          { campaign: { name: "A" }, segments: { month: "2025-06-01" }, metrics: { costMicros: 1000_000000 } },
          { campaign: { name: "A" }, segments: { month: "2026-05-01" }, metrics: { costMicros: 1200_000000 } },
          { campaign: { name: "A" }, segments: { month: "2025-05-01" }, metrics: { costMicros: 1000_000000 } },
          { campaign: { name: "A" }, segments: { month: "2026-04-01" }, metrics: { costMicros: 1200_000000 } },
          { campaign: { name: "A" }, segments: { month: "2025-04-01" }, metrics: { costMicros: 1000_000000 } },
        ],
      };
    };
    const a = await resolveBudgetAnchor(q, 0, now);
    expect(a.source).toBe("historical");
    expect(a.monthlyBudgetChf).toBeCloseTo(1200, 0); // 1000 * 1.2
  });

  it("none, wenn nichts ableitbar", async () => {
    const a = await resolveBudgetAnchor(okRows([]), 0, now);
    expect(a.source).toBe("none");
    expect(a.monthlyBudgetChf).toBeNull();
  });
});
