import { describe, it, expect } from "vitest";
import {
  checkBudgetPacing,
  checkPolicyStatus,
  checkImpressionsCrash,
  checkTracking,
  overallStatus,
  markKnown,
  type GuardianFinding,
} from "./google-ads-guardian.server";

// Phase-1-Abnahme: je Check ein simulierter Ausloesefall (+ Gegenprobe).
// Die Checks sind pure functions - DB-/API-Pfade werden hier nicht beruehrt.

const anchor = (chf: number | null, source: "client" | "account" | "historical" | "none" = "client") => ({
  monthlyBudgetChf: chf,
  source,
  detail: "test",
});

describe("checkBudgetPacing", () => {
  // Monatsbudget 3000 (Quelle client), Tag 15 von 30 -> Soll 1500
  it("warn bei > +20% Abweichung, critical bei > +40% (Quelle client)", () => {
    expect(checkBudgetPacing(1950, anchor(3000), 15, 30)?.severity).toBe("warn"); // +30%
    expect(checkBudgetPacing(2250, anchor(3000), 15, 30)?.severity).toBe("critical"); // +50%
    expect(checkBudgetPacing(2250, anchor(3000), 15, 30)?.message).toContain("ausgeschoepft");
  });
  it("critical bei < -40% (Unterpacing = etwas laeuft nicht)", () => {
    const f = checkBudgetPacing(750, anchor(3000), 15, 30); // -50%
    expect(f?.severity).toBe("critical");
    expect(f?.message).toContain("unter Plan");
  });
  it("still bei +/-20% und inaktiv ohne Anker", () => {
    expect(checkBudgetPacing(1650, anchor(3000), 15, 30)).toBeNull(); // +10%
    expect(checkBudgetPacing(9999, anchor(0), 15, 30)).toBeNull();
    expect(checkBudgetPacing(9999, anchor(null, "none"), 15, 30)).toBeNull();
  });

  // Quellenabhaengige Sprache - eine abgeleitete Quelle wird NIE als Budget dargestellt.
  it("Quelle client: 'Budget-Ueberschreitung', kein Ableitungs-Hinweis, budgetSource gesetzt", () => {
    const f = checkBudgetPacing(2250, anchor(3000, "client"), 15, 30)!;
    expect(f.budgetSource).toBe("client");
    expect(f.message).toContain("Budget-Ueberschreitung");
    expect(f.message).not.toContain("ABGELEITET");
  });
  it("Quelle account: 'weicht von Konto-Konfiguration ab' + Ableitungs-Hinweis; critical bleibt erlaubt", () => {
    const f = checkBudgetPacing(2250, anchor(3000, "account"), 15, 30)!;
    expect(f.budgetSource).toBe("account");
    expect(f.severity).toBe("critical");
    expect(f.message).toContain("Konto-Konfiguration");
    expect(f.message).toContain("ABGELEITET");
  });
  it("Quelle historical: 'Ausgabemuster-Anomalie (Beobachtung...)' und NIE critical (auf warn gekappt)", () => {
    const f = checkBudgetPacing(2250, anchor(3000, "historical"), 15, 30)!; // +50% -> waere critical
    expect(f.budgetSource).toBe("historical");
    expect(f.severity).toBe("warn"); // Beobachtung -> nie Sofort-Alarm
    expect(f.message).toContain("Ausgabemuster-Anomalie");
    expect(f.message).toContain("kein bestaetigtes Budget");
  });
});

describe("checkPolicyStatus", () => {
  it("warn bei einzelner betroffener Anzeige, critical ab > 50% der Ad-Group", () => {
    const warn = checkPolicyStatus([
      { campaign: "K", adGroup: "AG1", adId: "1", approvalStatus: "DISAPPROVED" },
      { campaign: "K", adGroup: "AG1", adId: "2", approvalStatus: "APPROVED" },
      { campaign: "K", adGroup: "AG1", adId: "3", approvalStatus: "APPROVED" },
    ]);
    expect(warn).toHaveLength(1);
    expect(warn[0].severity).toBe("warn");

    const crit = checkPolicyStatus([
      { campaign: "K", adGroup: "AG2", adId: "4", approvalStatus: "DISAPPROVED" },
      { campaign: "K", adGroup: "AG2", adId: "5", approvalStatus: "APPROVED_LIMITED" },
      { campaign: "K", adGroup: "AG2", adId: "6", approvalStatus: "APPROVED" },
    ]);
    expect(crit[0].severity).toBe("critical");
    expect(crit[0].message).toContain("nicht voll auslieferbar");
  });
  it("still ohne Policy-Probleme", () => {
    expect(checkPolicyStatus([{ campaign: "K", adGroup: "AG", adId: "1", approvalStatus: "APPROVED" }])).toEqual([]);
  });
});

describe("checkImpressionsCrash", () => {
  it("critical wenn gestern < 20% des 7T-Schnitts (nur ab Schnitt >= 50)", () => {
    const f = checkImpressionsCrash([
      { campaign: "Absturz", yesterday: 5, avg7d: 200 },
      { campaign: "Normal", yesterday: 180, avg7d: 200 },
      { campaign: "Kleinstbasis", yesterday: 0, avg7d: 30 }, // < 50 -> Rauschen, still
    ]);
    expect(f).toHaveLength(1);
    expect(f[0].entity).toBe("Absturz");
    expect(f[0].severity).toBe("critical");
    expect(f[0].message).toContain("sofort pruefen");
  });
});

describe("checkTracking", () => {
  it("critical bei Spend ohne Conversions trotz intakter Baseline (BROKEN)", () => {
    const f = checkTracking(500, 0, 40, 3);
    expect(f?.severity).toBe("critical");
    expect(f?.message).toContain("Tracking-Ausfall");
    expect(f?.message).toContain("blockiert");
  });
  it("still bei OK/NO_BASELINE", () => {
    expect(checkTracking(500, 12, 40, 3)).toBeNull();
    expect(checkTracking(500, 0, 1, 3)).toBeNull();
  });
});

describe("overallStatus + markKnown (Zustell-Logik-Basis)", () => {
  const f = (over: Partial<GuardianFinding>): GuardianFinding => ({
    check: "budget_pacing", severity: "warn", entity: "Konto", metric: "", message: "", ...over,
  });
  it("Status = hoechste Severity, ok ohne Findings", () => {
    expect(overallStatus([])).toBe("ok");
    expect(overallStatus([f({})])).toBe("warn");
    expect(overallStatus([f({}), f({ severity: "critical" })])).toBe("critical");
  });
  it("markKnown setzt knownSince aus dem ERSTEN frueheren Auftreten (ab Tag 2 nur Sammelpost)", () => {
    const today = markKnown(
      [f({ check: "tracking", entity: "Konto" }), f({ check: "impressions_crash", entity: "Neu" })],
      [
        { checkedAt: "2026-07-09T07:30:00Z", findings: [f({ check: "tracking", entity: "Konto" })] },
        { checkedAt: "2026-07-08T07:30:00Z", findings: [f({ check: "tracking", entity: "Konto" })] },
      ],
    );
    expect(today[0].knownSince).toBe("2026-07-08"); // erstes Auftreten, nicht letztes
    expect(today[1].knownSince).toBeUndefined(); // neues Finding -> Sofort-Meldung erlaubt
  });
});
