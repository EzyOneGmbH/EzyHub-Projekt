import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "./google-tokens.server";
import { addNegativeKeyword } from "./google-ads-mutate.server";

// Autopilot brain (deterministic layer). Pulls the data the classifier needs,
// applies the numeric rules from the build brief, auto-executes only the
// released class (negatives at autonomy>=1), queues approval-needed actions,
// and logs every change to ads_changelog. dryRun simulates step 7.
// The fuzzy analysis (irrelevant-term nuance, structural recommendations) is
// added on top by the Claude skill in the agent-service, which calls the same
// execute/log surface via /api/google/ads-autopilot-*.

const ADS_API = "https://googleads.googleapis.com/v24";
const MICROS = 1_000_000;
const MAX_NEGATIVES_PER_RUN = 20;

export type AutopilotConfig = {
  client_id: string;
  industry: string;
  kill_switch: boolean;
  autonomy_level: number;
  monthly_budget_chf: number;
  target_cpa_chf: number | null;
  target_roas: number | null;
  season_high: string[];
  season_low: string[];
  no_touch_campaigns: string[];
  languages: string[];
  notes: string | null;
};

const DEFAULT_CONFIG = (clientId: string): AutopilotConfig => ({
  client_id: clientId,
  industry: "kmu-local",
  kill_switch: false,
  autonomy_level: 0,
  monthly_budget_chf: 0,
  target_cpa_chf: null,
  target_roas: null,
  season_high: [],
  season_low: [],
  no_touch_campaigns: [],
  languages: ["de"],
  notes: null,
});

export type AutopilotData = {
  campaigns: Array<{
    name: string;
    status: string;
    dailyBudgetChf: number;
    costChf: number;
    conversions: number;
    conversionValue: number;
    roas: number | null;
    budgetLostIs: number;
  }>;
  searchTerms: Array<{ term: string; campaign: string; adGroup: string; costChf: number; conversions: number }>;
  meta: { customerId: string; costSumChf: number; avgCpaChf: number | null };
  error: string | null;
};

function gaqlEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function adsContext(clientId: string, googleAdsCustomer: string | null | undefined) {
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!devToken) return { skipped: "GOOGLE_ADS_DEVELOPER_TOKEN fehlt" as const };
  const customerId = String(googleAdsCustomer ?? "").replace(/\D/g, "");
  if (!customerId) return { skipped: "keine google_ads_customer" as const };
  const loginCustomerId = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "").replace(/\D/g, "");
  try {
    const t = await getGoogleAccessToken(clientId);
    return { customerId, loginCustomerId, accessToken: t.accessToken, devToken };
  } catch (e) {
    return { skipped: e instanceof Error ? e.message : "kein Google-Token" };
  }
}

async function search(
  ctx: { customerId: string; loginCustomerId: string; accessToken: string; devToken: string },
  gaql: string,
): Promise<Array<Record<string, any>>> {
  const res = await fetch(`${ADS_API}/customers/${ctx.customerId}/googleAds:searchStream`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      "developer-token": ctx.devToken,
      "Content-Type": "application/json",
      ...(ctx.loginCustomerId ? { "login-customer-id": ctx.loginCustomerId } : {}),
    },
    body: JSON.stringify({ query: gaql }),
  });
  if (!res.ok) throw new Error(`Ads API HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const json = (await res.json()) as Array<{ results?: Array<Record<string, any>> }>;
  return json.flatMap((b) => b.results ?? []);
}

export async function loadConfig(clientId: string): Promise<AutopilotConfig> {
  const { data } = await supabaseAdmin.from("ads_autopilot_config").select("*").eq("client_id", clientId).maybeSingle();
  return data ? { ...DEFAULT_CONFIG(clientId), ...data } : DEFAULT_CONFIG(clientId);
}

export async function fetchAutopilotData(
  clientId: string,
  googleAdsCustomer: string | null | undefined,
): Promise<{ ok: boolean; data?: AutopilotData; skipped?: string; error?: string }> {
  const ctx = await adsContext(clientId, googleAdsCustomer);
  if ("skipped" in ctx) return { ok: false, skipped: ctx.skipped };

  const data: AutopilotData = {
    campaigns: [],
    searchTerms: [],
    meta: { customerId: ctx.customerId, costSumChf: 0, avgCpaChf: null },
    error: null,
  };
  try {
    const camps = await search(
      ctx,
      `SELECT campaign.name, campaign.status, campaign_budget.amount_micros, metrics.cost_micros,
              metrics.conversions, metrics.conversions_value, metrics.search_budget_lost_impression_share
       FROM campaign WHERE segments.date DURING LAST_30_DAYS AND campaign.status = 'ENABLED'`,
    );
    let costSum = 0;
    let convSum = 0;
    for (const r of camps) {
      const cost = Number(r.metrics?.costMicros ?? 0) / MICROS;
      const conv = Number(r.metrics?.conversions ?? 0);
      costSum += cost;
      convSum += conv;
      data.campaigns.push({
        name: r.campaign?.name ?? "",
        status: r.campaign?.status ?? "",
        dailyBudgetChf: Number(r.campaignBudget?.amountMicros ?? 0) / MICROS,
        costChf: cost,
        conversions: conv,
        conversionValue: Number(r.metrics?.conversionsValue ?? 0),
        roas: cost ? Number(r.metrics?.conversionsValue ?? 0) / cost : null,
        budgetLostIs: Number(r.metrics?.searchBudgetLostImpressionShare ?? 0),
      });
    }
    data.meta.costSumChf = Math.round(costSum * 100) / 100;
    data.meta.avgCpaChf = convSum > 0 ? costSum / convSum : null;

    const terms = await search(
      ctx,
      `SELECT search_term_view.search_term, campaign.name, ad_group.name, metrics.cost_micros, metrics.conversions
       FROM search_term_view WHERE segments.date DURING LAST_30_DAYS
       ORDER BY metrics.cost_micros DESC LIMIT 500`,
    );
    for (const r of terms) {
      data.searchTerms.push({
        term: r.searchTermView?.searchTerm ?? "",
        campaign: r.campaign?.name ?? "",
        adGroup: r.adGroup?.name ?? "",
        costChf: Number(r.metrics?.costMicros ?? 0) / MICROS,
        conversions: Number(r.metrics?.conversions ?? 0),
      });
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── deterministic classification ────────────────────────────────────────────
export type PlannedAction = {
  actionClass: "auto-execute" | "approval-needed" | "report-only";
  type: string;
  entity: string;
  before: string;
  after: string;
  rationale: string;
  estimatedImpact?: string;
  exec?:
    | { kind: "negative"; campaign: string; term: string }
    | { kind: "budget"; campaign: string; dailyChf: number };
};

export function planActions(data: AutopilotData, cfg: AutopilotConfig): PlannedAction[] {
  const actions: PlannedAction[] = [];
  const noTouch = new Set(cfg.no_touch_campaigns.map((c) => c.trim()).filter(Boolean));
  const refCpa = cfg.target_cpa_chf ?? data.meta.avgCpaChf; // Fallback: Konto-Durchschnitts-CPA

  // Rule 1 — Negatives: 0 Conversions & Spend > 3x Ziel-CPA-Anteil.
  if (refCpa && refCpa > 0) {
    const threshold = 3 * refCpa;
    let count = 0;
    for (const t of data.searchTerms) {
      if (t.conversions > 0 || t.costChf <= threshold) continue;
      if (noTouch.has(t.campaign)) continue;
      const overLimit = count >= MAX_NEGATIVES_PER_RUN;
      actions.push({
        actionClass: cfg.autonomy_level >= 1 && !overLimit ? "auto-execute" : "approval-needed",
        type: "add_negative",
        entity: `${t.campaign} | ${t.adGroup}`,
        before: "",
        after: `+ "${t.term}" (negative exact)`,
        rationale: `Search Term "${t.term}": Cost CHF ${t.costChf.toFixed(2)}, 0 Conv./30d (> 3x Ziel-CPA ${refCpa.toFixed(2)})${overLimit ? " [Limit 20/Run erreicht]" : ""}`,
        exec: { kind: "negative", campaign: t.campaign, term: t.term },
      });
      count += 1;
    }
  }

  // Rule 2 — Budget: hoher Impression Share Lost (Budget) bei ROAS ueber Ziel -> approval.
  const targetRoas = cfg.target_roas ?? null;
  for (const c of data.campaigns) {
    if (noTouch.has(c.name)) continue;
    if (c.budgetLostIs >= 0.2 && c.roas != null && (targetRoas == null || c.roas >= targetRoas)) {
      const proposed = Math.round(c.dailyBudgetChf * 1.1 * 100) / 100; // Vorschlag +10% (Hardlimit/Run)
      actions.push({
        actionClass: "approval-needed",
        type: "budget_change",
        entity: c.name,
        before: `CHF ${c.dailyBudgetChf.toFixed(2)}/Tag`,
        after: `CHF ${proposed.toFixed(2)}/Tag`,
        rationale: `Impression Share Lost (Budget) ${(c.budgetLostIs * 100).toFixed(0)}%, ROAS ${c.roas.toFixed(1)}${targetRoas ? ` > Ziel ${targetRoas}` : ""}`,
        estimatedImpact: "Mehr Sichtbarkeit in budgetlimitierter Kampagne",
        exec: { kind: "budget", campaign: c.name, dailyChf: proposed },
      });
    }
  }
  return actions;
}

// ── orchestration: run for one client ───────────────────────────────────────
export type AutopilotRunSummary = {
  ok: boolean;
  runId: string;
  dryRun: boolean;
  killSwitch?: boolean;
  autonomyLevel?: number;
  executed: number;
  queued: number;
  reportOnly: number;
  failed: number;
  skipped?: string;
  error?: string;
  actions: Array<{ class: string; type: string; entity: string; status: string; rationale: string }>;
};

function slugify(s: string): string {
  return (s || "client").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "client";
}

export async function runAutopilot(clientId: string, opts?: { dryRun?: boolean }): Promise<AutopilotRunSummary> {
  const dryRun = opts?.dryRun !== false; // Default: sicher = dry-run
  const now = new Date();
  const cfg = await loadConfig(clientId);

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, name, google_ads_customer")
    .eq("id", clientId)
    .maybeSingle();
  const runId = `${now.toISOString().slice(0, 10)}-${slugify(client?.name ?? "")}-${now.getTime().toString().slice(-4)}`;
  const base: AutopilotRunSummary = {
    ok: true, runId, dryRun, autonomyLevel: cfg.autonomy_level,
    executed: 0, queued: 0, reportOnly: 0, failed: 0, actions: [],
  };

  if (cfg.kill_switch) return { ...base, killSwitch: true, skipped: "Run uebersprungen (Kill-Switch aktiv)" };
  if (!client) return { ...base, ok: false, error: "Client not found" };

  const customerId = String(client.google_ads_customer ?? "").replace(/\D/g, "");
  const fetched = await fetchAutopilotData(clientId, client.google_ads_customer);
  if (!fetched.ok || !fetched.data) return { ...base, ok: false, skipped: fetched.skipped, error: fetched.error };

  const planned = planActions(fetched.data, cfg);
  const effectiveDryRun = dryRun || cfg.autonomy_level < 1;

  for (const a of planned) {
    if (a.actionClass === "auto-execute" && a.exec?.kind === "negative") {
      // 1) log pending  2) execute (or dry-run)  3) update status
      const { data: logRow } = await supabaseAdmin
        .from("ads_changelog")
        .insert({
          client_id: clientId, customer_id: customerId, run_id: runId,
          action_type: a.type, action_class: a.actionClass, entity: a.entity,
          before_value: a.before, after_value: a.after, rationale: a.rationale,
          status: effectiveDryRun ? "dry-run" : "pending",
        })
        .select("id").maybeSingle();

      const result = await addNegativeKeyword({
        clientId, googleAdsCustomer: client.google_ads_customer,
        campaignName: a.exec.campaign, term: a.exec.term,
        dryRun: effectiveDryRun, noTouch: cfg.no_touch_campaigns,
      });
      let status: string;
      if (effectiveDryRun) status = "dry-run";
      else if (result.ok) status = "executed";
      else status = "failed";
      if (!effectiveDryRun && logRow?.id) {
        await supabaseAdmin.from("ads_changelog").update({ status }).eq("id", logRow.id);
      }
      if (status === "executed") base.executed += 1;
      else if (status === "failed") base.failed += 1;
      base.actions.push({ class: a.actionClass, type: a.type, entity: a.entity, status, rationale: a.rationale });
    } else if (a.actionClass === "approval-needed") {
      const actionId = `a-${String(base.queued + 1).padStart(3, "0")}`;
      const { data: logRow } = await supabaseAdmin
        .from("ads_changelog")
        .insert({
          client_id: clientId, customer_id: customerId, run_id: runId,
          action_type: a.type, action_class: a.actionClass, entity: a.entity,
          before_value: a.before, after_value: a.after, rationale: a.rationale, status: "pending",
        })
        .select("id").maybeSingle();
      const expires = new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString();
      await supabaseAdmin.from("ads_approvals").insert({
        client_id: clientId, customer_id: customerId, run_id: runId, action_id: actionId,
        type: a.type, entity: a.entity, current_value: a.before, proposed_value: a.after,
        rationale: a.rationale, estimated_impact: a.estimatedImpact ?? null,
        payload: a.exec ?? {}, status: "pending", expires_at: expires, changelog_id: logRow?.id ?? null,
      });
      base.queued += 1;
      base.actions.push({ class: a.actionClass, type: a.type, entity: a.entity, status: "pending", rationale: a.rationale });
    } else {
      base.reportOnly += 1;
      base.actions.push({ class: a.actionClass, type: a.type, entity: a.entity, status: "report-only", rationale: a.rationale });
    }
  }
  return base;
}
