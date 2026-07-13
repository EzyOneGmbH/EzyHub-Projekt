import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { adsQuery, loadConfig, computeTrackingHealth } from "./google-ads-autopilot.server";

// Waechter-Lauf (Phase 1): rein deterministischer, taeglicher Melder - KEIN LLM,
// KEINE Actions, KEINE Approvals, KEINE Writes ins Ads-Konto. Vier Checks pro
// Konto (Budget-Pacing, Policy-Status, Impressions-Absturz, Tracking-Gate),
// Ergebnis wird in ads_guardian_log persistiert (append-only), damit "neu seit
// letztem Lauf" und die Wochenreport-Kopfzeile moeglich sind. Zustellung macht
// n8n: ok = still, warn = Sammelpost, critical = sofort; bekannte Findings
// tragen knownSince (ab Tag 2 nur noch Sammelpost).

export type GuardianFinding = {
  check: "budget_pacing" | "policy_status" | "impressions_crash" | "tracking";
  severity: "warn" | "critical";
  entity: string;
  metric: string;
  message: string;
  knownSince?: string; // gesetzt, wenn dasselbe Finding schon in einem frueheren Lauf gemeldet wurde
};

export type GuardianResult = {
  clientId: string;
  clientName?: string;
  checkedAt: string;
  status: "ok" | "warn" | "critical";
  findings: GuardianFinding[];
  skipped?: string;
  dataErrors?: string[]; // ausgefallene Datenquellen - transparent, kein stilles "ok"
};

const round1 = (n: number) => Math.round(n * 10) / 10;

// ── Check 1: Budget-Pacing (MTD-Spend vs. anteiliges Monatsbudget) ───────────
export function checkBudgetPacing(
  mtdSpendChf: number,
  monthlyBudgetChf: number,
  dayOfMonth: number,
  daysInMonth: number,
): GuardianFinding | null {
  if (!monthlyBudgetChf || monthlyBudgetChf <= 0) return null; // kein Monatsbudget konfiguriert -> Check inaktiv
  const expected = (monthlyBudgetChf * dayOfMonth) / daysInMonth;
  if (expected <= 0) return null;
  const dev = (mtdSpendChf - expected) / expected;
  if (Math.abs(dev) <= 0.2) return null;
  const severity: "warn" | "critical" = Math.abs(dev) > 0.4 ? "critical" : "warn";
  const richtung = dev > 0 ? "ueber" : "unter";
  return {
    check: "budget_pacing",
    severity,
    entity: "Konto",
    metric: `MTD CHF ${mtdSpendChf.toFixed(2)} vs. Soll CHF ${expected.toFixed(2)} (${dev > 0 ? "+" : ""}${round1(dev * 100)}%)`,
    message:
      `Das Konto hat diesen Monat bisher CHF ${mtdSpendChf.toFixed(2)} ausgegeben - nach ${dayOfMonth} von ${daysInMonth} Tagen ` +
      `waeren anteilig CHF ${expected.toFixed(2)} des Monatsbudgets (CHF ${monthlyBudgetChf.toFixed(0)}) zu erwarten. ` +
      `Die Ausgaben liegen ${Math.abs(round1(dev * 100))}% ${richtung} Plan` +
      (dev > 0
        ? ` - bei diesem Tempo ist das Budget vor Monatsende aufgebraucht.`
        : ` - moegliche Ursachen: pausierte Kampagnen, abgelehnte Anzeigen oder zu tiefe Gebote.`),
  };
}

// ── Check 2: Anzeigen-/Policy-Status ─────────────────────────────────────────
export type PolicyAdRow = { campaign: string; adGroup: string; adId: string; approvalStatus: string };
const POLICY_ISSUE = new Set(["DISAPPROVED", "APPROVED_LIMITED", "ELIGIBLE_LIMITED"]);

export function checkPolicyStatus(ads: PolicyAdRow[]): GuardianFinding[] {
  const out: GuardianFinding[] = [];
  const byGroup = new Map<string, { total: number; issues: PolicyAdRow[] }>();
  for (const a of ads) {
    const key = `${a.campaign} | ${a.adGroup}`;
    const g = byGroup.get(key) ?? { total: 0, issues: [] };
    g.total += 1;
    if (POLICY_ISSUE.has(a.approvalStatus)) g.issues.push(a);
    byGroup.set(key, g);
  }
  for (const [group, g] of byGroup) {
    if (g.issues.length === 0) continue;
    const share = g.issues.length / g.total;
    const disapproved = g.issues.filter((i) => i.approvalStatus === "DISAPPROVED").length;
    const limited = g.issues.length - disapproved;
    out.push({
      check: "policy_status",
      severity: share > 0.5 ? "critical" : "warn",
      entity: group,
      metric: `${g.issues.length}/${g.total} Anzeigen betroffen (${disapproved} abgelehnt, ${limited} eingeschraenkt)`,
      message:
        `In der Anzeigengruppe "${group}" sind ${g.issues.length} von ${g.total} Anzeigen nicht voll auslieferbar ` +
        `(${disapproved} von Google abgelehnt, ${limited} eingeschraenkt). ` +
        (share > 0.5
          ? `Mehr als die Haelfte der Gruppe ist betroffen - die Auslieferung ist praktisch gestoppt; Ablehnungsgrund in der Ads-UI pruefen und beheben.`
          : `Ablehnungsgrund in der Ads-UI pruefen (haeufig: Ziel-URL, Markenbegriffe, Formulierungen).`),
    });
  }
  return out;
}

// ── Check 3: Impressions-Absturz (gestern < 20% des 7-Tage-Schnitts) ─────────
export type ImpressionRow = { campaign: string; yesterday: number; avg7d: number };
export function checkImpressionsCrash(rows: ImpressionRow[]): GuardianFinding[] {
  const out: GuardianFinding[] = [];
  for (const r of rows) {
    if (r.avg7d < 50) continue; // zu kleine Basis -> Rauschen
    if (r.yesterday >= 0.2 * r.avg7d) continue;
    out.push({
      check: "impressions_crash",
      severity: "critical",
      entity: r.campaign,
      metric: `gestern ${r.yesterday} Impr. vs. 7T-Schnitt ${Math.round(r.avg7d)}`,
      message:
        `Die Kampagne "${r.campaign}" wurde gestern nur ${r.yesterday}x angezeigt - normal sind ~${Math.round(r.avg7d)} Impressionen pro Tag. ` +
        `Ein Einbruch auf unter 20% deutet auf ein akutes Problem hin (pausiert, Budget CHF 0, alle Anzeigen abgelehnt, Zahlungsproblem) - sofort pruefen.`,
    });
  }
  return out;
}

// ── Check 4: Tracking-Gate (bestehende Logik) ────────────────────────────────
export function checkTracking(spend7d: number, conv7d: number, base30: number, minBaseline: number): GuardianFinding | null {
  const status = computeTrackingHealth(spend7d, conv7d, base30, minBaseline);
  if (status !== "BROKEN") return null;
  return {
    check: "tracking",
    severity: "critical",
    entity: "Konto",
    metric: `Spend 7T CHF ${spend7d.toFixed(2)}, 0 Conversions (Baseline ${base30.toFixed(0)}/30d)`,
    message:
      `Das Konto hat in 7 Tagen CHF ${spend7d.toFixed(2)} ausgegeben, aber keine einzige Conversion gemessen - ` +
      `bei intakter Baseline von ${base30.toFixed(0)} Conversions/30d ist das ein Tracking-Ausfall, kein Nachfrage-Problem. ` +
      `Autopilot-Writes sind automatisch blockiert, bis das Tracking wieder misst.`,
  };
}

export function overallStatus(findings: GuardianFinding[]): "ok" | "warn" | "critical" {
  if (findings.some((f) => f.severity === "critical")) return "critical";
  return findings.length ? "warn" : "ok";
}

// knownSince: gleiche (check, entity) wie in frueheren Laeufen -> Datum des ersten Auftretens.
export function markKnown(findings: GuardianFinding[], previous: Array<{ checkedAt: string; findings: GuardianFinding[] }>): GuardianFinding[] {
  const firstSeen = new Map<string, string>();
  for (const run of [...previous].sort((a, b) => a.checkedAt.localeCompare(b.checkedAt))) {
    for (const f of run.findings ?? []) {
      const k = `${f.check}::${f.entity}`;
      if (!firstSeen.has(k)) firstSeen.set(k, f.knownSince ?? run.checkedAt);
    }
  }
  return findings.map((f) => {
    const since = firstSeen.get(`${f.check}::${f.entity}`);
    return since ? { ...f, knownSince: since.slice(0, 10) } : f;
  });
}

// ── Orchestrierung: ein Kunde ────────────────────────────────────────────────
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDay(d);
}

export async function runGuardianForClient(client: { id: string; name: string; google_ads_customer: string | null }): Promise<GuardianResult> {
  const now = new Date();
  const result: GuardianResult = {
    clientId: client.id,
    clientName: client.name,
    checkedAt: now.toISOString(),
    status: "ok",
    findings: [],
    dataErrors: [],
  };
  const cfg = await loadConfig(client.id);

  const q = (gaql: string) => adsQuery(client.id, client.google_ads_customer, gaql);
  const soft = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      result.dataErrors!.push(`${label}: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`);
    }
  };

  // Kein Ads-Zugang -> sauber als skipped melden (nicht stilles "ok").
  const probe = await q(`SELECT customer.id FROM customer LIMIT 1`);
  if (!probe.ok) return { ...result, skipped: probe.skipped ?? probe.error };

  // Check 1: Budget-Pacing
  await soft("budget_pacing", async () => {
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const r = await q(`SELECT metrics.cost_micros FROM customer WHERE segments.date BETWEEN '${monthStart}' AND '${isoDay(now)}'`);
    if (!r.ok) throw new Error(r.error ?? r.skipped);
    const mtd = Number(r.rows?.[0]?.metrics?.costMicros ?? 0) / 1_000_000;
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const f = checkBudgetPacing(mtd, Number(cfg.monthly_budget_chf ?? 0), now.getDate(), daysInMonth);
    if (f) result.findings.push(f);
  });

  // Check 2: Policy-Status
  await soft("policy_status", async () => {
    const r = await q(
      `SELECT campaign.name, ad_group.name, ad_group_ad.ad.id, ad_group_ad.policy_summary.approval_status
       FROM ad_group_ad
       WHERE campaign.status = 'ENABLED' AND ad_group.status = 'ENABLED' AND ad_group_ad.status = 'ENABLED'`,
    );
    if (!r.ok) throw new Error(r.error ?? r.skipped);
    const ads: PolicyAdRow[] = (r.rows ?? []).map((row) => ({
      campaign: row.campaign?.name ?? "",
      adGroup: row.adGroup?.name ?? "",
      adId: String(row.adGroupAd?.ad?.id ?? ""),
      approvalStatus: String(row.adGroupAd?.policySummary?.approvalStatus ?? "UNKNOWN"),
    }));
    result.findings.push(...checkPolicyStatus(ads));
  });

  // Check 3: Impressions-Absturz (gestern vs. Schnitt Tag -8..-2)
  await soft("impressions_crash", async () => {
    const r = await q(
      `SELECT campaign.name, segments.date, metrics.impressions
       FROM campaign WHERE segments.date BETWEEN '${daysAgo(8)}' AND '${daysAgo(1)}' AND campaign.status = 'ENABLED'`,
    );
    if (!r.ok) throw new Error(r.error ?? r.skipped);
    const yesterday = daysAgo(1);
    const agg = new Map<string, { y: number; prevSum: number; prevDays: Set<string> }>();
    for (const row of r.rows ?? []) {
      const name = row.campaign?.name ?? "";
      const date = String(row.segments?.date ?? "");
      const impr = Number(row.metrics?.impressions ?? 0);
      const a = agg.get(name) ?? { y: 0, prevSum: 0, prevDays: new Set<string>() };
      if (date === yesterday) a.y += impr;
      else {
        a.prevSum += impr;
        a.prevDays.add(date);
      }
      agg.set(name, a);
    }
    const rows: ImpressionRow[] = [...agg.entries()].map(([campaign, a]) => ({
      campaign,
      yesterday: a.y,
      avg7d: a.prevDays.size ? a.prevSum / a.prevDays.size : 0,
    }));
    result.findings.push(...checkImpressionsCrash(rows));
  });

  // Check 4: Tracking-Gate
  await soft("tracking", async () => {
    const h7 = await q(`SELECT metrics.cost_micros, metrics.conversions FROM customer WHERE segments.date DURING LAST_7_DAYS`);
    const base = await q(`SELECT metrics.conversions FROM customer WHERE segments.date BETWEEN '${daysAgo(37)}' AND '${daysAgo(8)}'`);
    if (!h7.ok || !base.ok) throw new Error(h7.error ?? base.error ?? "tracking query failed");
    const f = checkTracking(
      Number(h7.rows?.[0]?.metrics?.costMicros ?? 0) / 1_000_000,
      Number(h7.rows?.[0]?.metrics?.conversions ?? 0),
      Number(base.rows?.[0]?.metrics?.conversions ?? 0),
      cfg.min_conversions_baseline ?? 3,
    );
    if (f) result.findings.push(f);
  });

  // knownSince aus den letzten 14 Laeufen ableiten (Verhaltensregel 4).
  const { data: prev } = await supabaseAdmin
    .from("ads_guardian_log")
    .select("checked_at, findings")
    .eq("client_id", client.id)
    .order("checked_at", { ascending: false })
    .limit(14);
  result.findings = markKnown(
    result.findings,
    (prev ?? []).map((p) => ({ checkedAt: String(p.checked_at), findings: (p.findings ?? []) as GuardianFinding[] })),
  );
  result.status = overallStatus(result.findings);

  // Persistenz (append-only Tabelle) - der Waechter schreibt NUR dieses Log.
  await supabaseAdmin.from("ads_guardian_log").insert({
    client_id: client.id,
    checked_at: result.checkedAt,
    status: result.status,
    findings: result.findings,
  });
  return result;
}
