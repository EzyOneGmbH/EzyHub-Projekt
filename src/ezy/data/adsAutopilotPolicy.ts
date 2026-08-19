// Pure Policy- und Rechenlogik des Google-Ads-Autopiloten. Bewusst OHNE
// Supabase-/Server-Importe, damit UI (AdsAutopilotPanel), Server-Engine und
// Config-Route dieselben Sicherheitsregeln teilen und vitest sie direkt testet.

export type OrgRoleLike = string | null | undefined;

// Nur Owner/Admin duerfen die Autopilot-Policy eines Kunden aendern (RBAC:
// member = zugewiesene Kunden read/execute, viewer = Portal read-only).
export function canConfigureAutopilot(role: OrgRoleLike): boolean {
  return role === "owner" || role === "admin";
}

// Harte Invariante des Runs: observe_only erzwingt Dry-Run unabhaengig vom
// Autonomie-Level; autonomy_level < 1 und Tracking-BROKEN ebenso. Ein Write
// passiert nur, wenn KEIN Gate greift.
export function computeEffectiveDryRun(p: {
  requestedDryRun: boolean;
  observeOnly: boolean;
  autonomyLevel: number;
  trackingBroken?: boolean;
}): boolean {
  return p.requestedDryRun || p.observeOnly || p.autonomyLevel < 1 || !!p.trackingBroken;
}

// Gate fuer den Execute-Pfad einer Freigabe (Approve -> Google-Write). Der
// Kill-Switch blockiert hier genauso wie im Run selbst - eine Freigabe darf
// ihn nie umgehen.
export function executionGate(p: {
  observeOnly: boolean;
  killSwitch: boolean;
  trackingBroken?: boolean;
}): { allowed: boolean; reason?: string } {
  if (p.killSwitch)
    return {
      allowed: false,
      reason: "Kill-Switch aktiv - der Autopilot fuehrt fuer diesen Kunden keine Aenderungen aus.",
    };
  if (p.observeOnly)
    return {
      allowed: false,
      reason:
        "Beobachtungsmodus aktiv - Ausfuehrung deaktiviert. Erst observe_only=false setzen (nach Qualitaetspruefung).",
    };
  if (p.trackingBroken)
    return { allowed: false, reason: "Tracking-Verdacht (BROKEN) - alle Write-Ops blockiert" };
  return { allowed: true };
}

// ── Budget-Pacing ────────────────────────────────────────────────────────────
// Vergleicht Monats-Spend (MTD) mit dem anteiligen Soll bis heute und
// prognostiziert linear bis Monatsende. Ohne gepflegtes Monatsbudget wird
// ehrlich "no_budget" gemeldet (Setup-Hinweis statt Scheinwerte).

export type BudgetPacingStatus = "no_budget" | "under" | "on_track" | "over";

export type BudgetPacing = {
  status: BudgetPacingStatus;
  monthlyBudgetChf: number | null;
  budgetSource: string; // client | account | historical | none
  mtdSpendChf: number;
  elapsedDays: number;
  daysInMonth: number;
  expectedToDateChf: number | null;
  forecastEomChf: number | null;
  pacingRatio: number | null; // MTD-Spend / anteiliges Soll
};

export const PACING_UNDER_RATIO = 0.8;
export const PACING_OVER_RATIO = 1.15;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeBudgetPacing(p: {
  monthlyBudgetChf: number | null | undefined;
  budgetSource: string;
  mtdSpendChf: number;
  today: Date;
}): BudgetPacing {
  const daysInMonth = new Date(p.today.getFullYear(), p.today.getMonth() + 1, 0).getDate();
  const elapsedDays = Math.min(p.today.getDate(), daysInMonth);
  const mtd = Math.max(0, Number(p.mtdSpendChf) || 0);
  const forecast = elapsedDays > 0 ? round2((mtd / elapsedDays) * daysInMonth) : null;
  const budget = Number(p.monthlyBudgetChf ?? 0);
  const hasBudget = Number.isFinite(budget) && budget > 0 && p.budgetSource !== "none";
  if (!hasBudget) {
    return {
      status: "no_budget",
      monthlyBudgetChf: null,
      budgetSource: p.budgetSource || "none",
      mtdSpendChf: round2(mtd),
      elapsedDays,
      daysInMonth,
      expectedToDateChf: null,
      forecastEomChf: forecast,
      pacingRatio: null,
    };
  }
  const expected = round2((budget * elapsedDays) / daysInMonth);
  const ratio = expected > 0 ? Math.round((mtd / expected) * 1000) / 1000 : null;
  const status: BudgetPacingStatus =
    ratio == null
      ? "on_track"
      : ratio < PACING_UNDER_RATIO
        ? "under"
        : ratio > PACING_OVER_RATIO
          ? "over"
          : "on_track";
  return {
    status,
    monthlyBudgetChf: round2(budget),
    budgetSource: p.budgetSource,
    mtdSpendChf: round2(mtd),
    elapsedDays,
    daysInMonth,
    expectedToDateChf: expected,
    forecastEomChf: forecast,
    pacingRatio: ratio,
  };
}

// ── Konfigurations-Patch (UI -> Server) ──────────────────────────────────────
// Nur diese Felder sind ueber die UI aenderbar; alles andere (Saison, Lag,
// Schwellwerte, notes) bleibt bewusst beim bisherigen Pflegeweg.

export type AutopilotConfigPatch = {
  observe_only?: boolean;
  kill_switch?: boolean;
  autonomy_level?: number;
  target_cpa_chf?: number | null;
  target_roas?: number | null;
  monthly_budget_chf?: number;
  no_touch_campaigns?: string[];
};

export const CONFIG_FIELD_LABELS: Record<keyof AutopilotConfigPatch, string> = {
  observe_only: "Beobachtungsmodus",
  kill_switch: "Kill-Switch",
  autonomy_level: "Autonomie-Level",
  target_cpa_chf: "Ziel-CPA (CHF)",
  target_roas: "Ziel-ROAS",
  monthly_budget_chf: "Monatsbudget (CHF)",
  no_touch_campaigns: "Geschuetzte Kampagnen",
};

export function sanitizeConfigPatch(raw: unknown): {
  ok: boolean;
  patch?: AutopilotConfigPatch;
  error?: string;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { ok: false, error: "patch fehlt oder ist kein Objekt" };
  const r = raw as Record<string, unknown>;
  const patch: AutopilotConfigPatch = {};

  const bool = (key: "observe_only" | "kill_switch") => {
    if (!(key in r)) return true;
    if (typeof r[key] !== "boolean") return false;
    patch[key] = r[key] as boolean;
    return true;
  };
  if (!bool("observe_only")) return { ok: false, error: "observe_only muss boolean sein" };
  if (!bool("kill_switch")) return { ok: false, error: "kill_switch muss boolean sein" };

  if ("autonomy_level" in r) {
    const v = Number(r.autonomy_level);
    if (!Number.isInteger(v) || v < 0 || v > 2)
      return { ok: false, error: "autonomy_level muss 0, 1 oder 2 sein" };
    patch.autonomy_level = v;
  }

  const numOrNull = (key: "target_cpa_chf" | "target_roas") => {
    if (!(key in r)) return true;
    if (r[key] === null || r[key] === "") {
      patch[key] = null;
      return true;
    }
    const v = Number(r[key]);
    if (!Number.isFinite(v) || v < 0 || v > 1_000_000) return false;
    patch[key] = Math.round(v * 100) / 100;
    return true;
  };
  if (!numOrNull("target_cpa_chf")) return { ok: false, error: "target_cpa_chf ungueltig" };
  if (!numOrNull("target_roas")) return { ok: false, error: "target_roas ungueltig" };

  if ("monthly_budget_chf" in r) {
    const v = Number(r.monthly_budget_chf);
    if (!Number.isFinite(v) || v < 0 || v > 10_000_000)
      return { ok: false, error: "monthly_budget_chf ungueltig" };
    patch.monthly_budget_chf = Math.round(v * 100) / 100;
  }

  if ("no_touch_campaigns" in r) {
    if (!Array.isArray(r.no_touch_campaigns))
      return { ok: false, error: "no_touch_campaigns muss eine Liste sein" };
    const list = (r.no_touch_campaigns as unknown[])
      .map((x) => String(x ?? "").trim())
      .filter((x) => x.length > 0)
      .slice(0, 100)
      .map((x) => x.slice(0, 200));
    patch.no_touch_campaigns = [...new Set(list)];
  }

  if (Object.keys(patch).length === 0)
    return { ok: false, error: "patch enthaelt keine aenderbaren Felder" };
  return { ok: true, patch };
}

// Menschlich lesbare Diff-Zeilen (fuer Bestaetigungs-Dialog UND Audit-Trail).
export function describeConfigChange(
  before: Partial<Record<keyof AutopilotConfigPatch, unknown>>,
  patch: AutopilotConfigPatch,
): string[] {
  const fmt = (key: keyof AutopilotConfigPatch, v: unknown): string => {
    if (v === null || v === undefined || v === "") return "—";
    if (typeof v === "boolean") return v ? "an" : "aus";
    if (Array.isArray(v)) return v.length ? v.join(", ") : "keine";
    if (key === "autonomy_level") {
      const n = Number(v);
      return (
        ["0 (nur berichten)", "1 (Negatives automatisch)", "2 (+ Gebote automatisch)"][n] ??
        String(v)
      );
    }
    return String(v);
  };
  const lines: string[] = [];
  for (const key of Object.keys(patch) as Array<keyof AutopilotConfigPatch>) {
    const oldV = before[key];
    const newV = patch[key];
    if (JSON.stringify(oldV ?? null) === JSON.stringify(newV ?? null)) continue;
    lines.push(`${CONFIG_FIELD_LABELS[key]}: ${fmt(key, oldV)} → ${fmt(key, newV)}`);
  }
  return lines;
}
