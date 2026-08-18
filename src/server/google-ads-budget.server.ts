// Budget-Anker mit Herkunftsnachweis (rein lesend). Dreistufige Aufloesung mit
// Quellenkennzeichnung - eine ABGELEITETE Quelle wird NIE als bestaetigtes
// Budget dargestellt (die Sprache des Waechters richtet sich nach der Quelle).
//
//   client     - manuell gesetzt (Soll-Budget), Vorrang vor allem.
//   account    - Summe der Tagesbudgets ALLER AKTIVEN Kampagnen x 30.4
//                (shared budgets nur einmal gezaehlt).
//   historical - Erwartungswert aus der 12-Monats-Serie, SAISONAL NORMALISIERT
//                (Vorjahresmonat x Jahrestrend, NICHT Jahresdurchschnitt),
//                NUR aus aktiven Kampagnen (pausierte/geloeschte sind per
//                status='ENABLED' ausgeschlossen; Messluecken betreffen den
//                Conversion-WERT, nicht die Kosten -> Budget bleibt belastbar).
//   none       - nichts ableitbar.

export type BudgetSource = "client" | "account" | "historical" | "none";

export type BudgetAnchor = {
  monthlyBudgetChf: number | null;
  source: BudgetSource;
  detail: string; // menschlich lesbarer Herkunftsnachweis
};

export const DAYS_PER_MONTH = 30.4;

type QueryFn = (
  gaql: string,
) => Promise<{ ok: boolean; rows?: Array<Record<string, any>>; error?: string; skipped?: string }>;

const round2 = (n: number) => Math.round(n * 100) / 100;
const monthKey = (y: number, m1: number) => `${y}-${String(m1).padStart(2, "0")}`;

// Tagesbudgets aktiver Kampagnen summieren, shared budgets via budget-id nur
// EINMAL zaehlen (pure, testbar).
export function sumDedupedDailyBudgets(rows: Array<{ budgetId: string; amountChf: number }>): {
  dailyChf: number;
  budgetCount: number;
} {
  const byBudget = new Map<string, number>();
  for (const r of rows) {
    if (!r.budgetId || !(r.amountChf > 0)) continue;
    byBudget.set(r.budgetId, r.amountChf); // gleiche id -> selber Wert, einmal gezaehlt
  }
  let daily = 0;
  for (const v of byBudget.values()) daily += v;
  return { dailyChf: round2(daily), budgetCount: byBudget.size };
}

// Saisonal normalisierter Erwartungswert fuer den AKTUELLEN Monat (pure, testbar):
// Vorjahresmonat x Jahrestrend (letzte 3 abgeschlossene Monate gegen dieselben
// 3 Monate ein Jahr zuvor). Ohne Vorjahresdaten degradiert es ehrlich auf den
// Mittelwert der letzten Monate und kennzeichnet das als NICHT saisonal.
export function seasonalHistoricalEstimate(
  monthCost: Record<string, number>, // 'YYYY-MM' -> CHF, nur aktive Kampagnen
  year: number,
  month1: number, // aktueller Monat 1..12
): { value: number | null; reason: string } {
  const shift = (y: number, m: number, back: number): [number, number] => {
    let mm = m - back;
    let yy = y;
    while (mm <= 0) {
      mm += 12;
      yy -= 1;
    }
    return [yy, mm];
  };
  const priorYear = monthCost[monthKey(year - 1, month1)];
  const recent = [1, 2, 3].map((b) => shift(year, month1, b));
  const recentVals = recent
    .map(([y, m]) => monthCost[monthKey(y, m)])
    .filter((v): v is number => v != null);
  const priorOfRecent = recent
    .map(([y, m]) => monthCost[monthKey(y - 1, m)])
    .filter((v): v is number => v != null);
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

  if (
    priorYear != null &&
    priorYear > 0 &&
    recentVals.length === 3 &&
    priorOfRecent.length === 3 &&
    sum(priorOfRecent) > 0
  ) {
    const trend = sum(recentVals) / sum(priorOfRecent);
    if (isFinite(trend) && trend > 0)
      return {
        value: round2(priorYear * trend),
        reason: `Vorjahresmonat CHF ${priorYear.toFixed(0)} x Jahrestrend ${trend.toFixed(2)}`,
      };
  }
  if (priorYear != null && priorYear > 0)
    return {
      value: round2(priorYear),
      reason: `Vorjahresmonat CHF ${priorYear.toFixed(0)} (kein belastbarer Jahrestrend)`,
    };
  if (recentVals.length)
    return {
      value: round2(sum(recentVals) / recentVals.length),
      reason: `kein Vorjahresmonat (Konto < 13 Monate) - Mittel der letzten ${recentVals.length} Monate, NICHT saisonal`,
    };
  return { value: null, reason: "keine Historie aktiver Kampagnen" };
}

// Dreistufige Aufloesung gegen das Konto (rein lesend).
export async function resolveBudgetAnchor(
  q: QueryFn,
  clientMonthlyBudgetChf: number,
  now: Date,
): Promise<BudgetAnchor> {
  // 1) client - manuell gesetzt, Vorrang.
  if (clientMonthlyBudgetChf > 0)
    return {
      monthlyBudgetChf: round2(clientMonthlyBudgetChf),
      source: "client",
      detail: "manuell gesetzt (Soll-Budget)",
    };

  // 2) account - Summe der Tagesbudgets aktiver Kampagnen x 30.4 (shared dedupe).
  try {
    const r = await q(
      `SELECT campaign.name, campaign_budget.id, campaign_budget.amount_micros
       FROM campaign WHERE campaign.status = 'ENABLED'`,
    );
    if (r.ok) {
      const { dailyChf, budgetCount } = sumDedupedDailyBudgets(
        (r.rows ?? []).map((row) => ({
          budgetId: String(row.campaignBudget?.id ?? ""),
          amountChf: Number(row.campaignBudget?.amountMicros ?? 0) / 1_000_000,
        })),
      );
      if (dailyChf > 0)
        return {
          monthlyBudgetChf: round2(dailyChf * DAYS_PER_MONTH),
          source: "account",
          detail: `Summe der Tagesbudgets ${budgetCount} aktiver Budget(s) CHF ${dailyChf.toFixed(2)}/Tag x ${DAYS_PER_MONTH}`,
        };
    }
  } catch {
    /* account-Ableitung optional -> naechster Fallback */
  }

  // 3) historical - saisonal normalisiert, nur aktive Kampagnen.
  try {
    const start = new Date(now.getFullYear(), now.getMonth() - 16, 1);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const r = await q(
      `SELECT campaign.name, segments.month, metrics.cost_micros
       FROM campaign WHERE campaign.status = 'ENABLED' AND segments.date BETWEEN '${iso(start)}' AND '${iso(now)}'`,
    );
    if (r.ok) {
      const monthCost: Record<string, number> = {};
      for (const row of r.rows ?? []) {
        const mo = String(row.segments?.month ?? "").slice(0, 7);
        if (!mo) continue;
        monthCost[mo] = (monthCost[mo] ?? 0) + Number(row.metrics?.costMicros ?? 0) / 1_000_000;
      }
      const est = seasonalHistoricalEstimate(monthCost, now.getFullYear(), now.getMonth() + 1);
      if (est.value != null && est.value > 0)
        return { monthlyBudgetChf: est.value, source: "historical", detail: est.reason };
    }
  } catch {
    /* historical-Ableitung optional */
  }

  return {
    monthlyBudgetChf: null,
    source: "none",
    detail: "kein Budget ableitbar (keine aktiven Kampagnen-Budgets, keine Historie)",
  };
}

// Quellenabhaengige Sprache - eine abgeleitete Quelle wird NIE als bestaetigtes
// Budget dargestellt. head = Kurzbezeichnung der Meldung, budgetWord = wie der
// Vergleichswert im Fliesstext genannt werden darf, capWarn = kein critical
// (nur Beobachtung, keine Sofort-Autoritaet).
export function budgetSourceLanguage(source: BudgetSource): {
  head: string;
  budgetWord: string;
  capWarn: boolean;
} {
  switch (source) {
    case "client":
      return { head: "Budget-Ueberschreitung", budgetWord: "des Monatsbudgets", capWarn: false };
    case "account":
      return {
        head: "Ausgabe weicht von Konto-Konfiguration ab",
        budgetWord: "der hochgerechneten Konto-Konfiguration",
        capWarn: false,
      };
    case "historical":
      return {
        head: "Ausgabemuster-Anomalie (Beobachtung, kein bestaetigtes Budget)",
        budgetWord: "des saisonal erwarteten Ausgabewerts",
        capWarn: true,
      };
    default:
      return { head: "Ausgabemuster", budgetWord: "des Referenzwerts", capWarn: true };
  }
}
