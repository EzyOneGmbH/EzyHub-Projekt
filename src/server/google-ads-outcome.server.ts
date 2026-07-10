import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "./google-tokens.server";

// Phase 4: change-outcome-review — der Autonomie-Freischalter.
// Deterministisch (kein LLM): misst jede umgesetzte Autopilot-Aenderung 14d und
// 30d spaeter (Vorher/Nachher auf der betroffenen Kampagne), vergibt Verdicts,
// schuetzt gegen Fehlattribution (Confounder-Guard) und fuellt die Scorecard,
// aus der die Freischaltkriterien (limits.md 4.3) gerechnet werden.
// Claude formuliert nur die Zusammenfassung im Monatsreport.

const ADS_API = "https://googleads.googleapis.com/v24";
const MICROS = 1_000_000;
// Phase 2: negative_keyword_semantic wird wie die deterministischen Negatives
// reviewt (vermiedene Verschwendung), erhaelt aber eine EIGENE Scorecard-Zeile
// (Gruppierung nach action_type) und zaehlt NICHT in die L1-Release-Gates -
// eine Automatisierung semantischer Negatives ist eine menschliche Entscheidung.
const REVIEWABLE_TYPES = ["add_negative", "add_negative_phrase", "budget_change", "bid_adjustment", "negative_keyword_semantic"];

export type Metrics = { cost: number; conversions: number; cpa: number | null; roas: number | null; impressionShare: number | null };

// ── pure: Verdict (4.1) ──────────────────────────────────────────────────────
// CPA-Verbesserung > 5% = positive; Verschlechterung > 10% = negative; sonst neutral.
// Zu wenig Daten (CPA in einem Fenster nicht definiert oder < minConv Conversions
// gesamt) = inconclusive.
export function computeVerdict(
  before: { cost: number; conversions: number },
  after: { cost: number; conversions: number },
  minConvTotal = 5,
): "positive" | "neutral" | "negative" | "inconclusive" {
  if (before.conversions + after.conversions < minConvTotal) return "inconclusive";
  if (before.cost <= 0 || after.cost <= 0) return "inconclusive";
  if (before.conversions <= 0 || after.conversions <= 0) return "inconclusive";
  const cpaB = before.cost / before.conversions;
  const cpaA = after.cost / after.conversions;
  const delta = (cpaA - cpaB) / cpaB; // negativ = CPA gesunken = besser
  if (delta < -0.05) return "positive";
  if (delta > 0.10) return "negative";
  return "neutral";
}

// ── pure: Freischalt-/Datenproblem-Pruefung (4.3) ────────────────────────────
export type ScoreRow = {
  action_type: string;
  n_total: number;
  n_positive: number;
  n_neutral: number;
  n_negative: number;
  n_inconclusive: number;
  hit_rate: number | null;
  avoided_waste_chf_sum: number;
};

export function checkAutonomy(rows: ScoreRow[], bidWritesEnabled: boolean): {
  negativesReadyForL1: boolean;
  bidsReadyForL2: boolean;
  dataProblems: string[];
  reasons: string[];
} {
  const by = (t: string) => rows.find((r) => r.action_type === t);
  const dataProblems: string[] = [];
  const reasons: string[] = [];
  for (const r of rows) {
    if (r.n_total >= 4 && r.n_inconclusive / r.n_total > 0.5)
      dataProblems.push(`${r.action_type}: ${r.n_inconclusive}/${r.n_total} inconclusive (>50%) - Datenproblem statt weiterer Empfehlungen melden`);
  }
  // Level 0 -> 1 (Negatives): n_total >= 15, hit_rate >= 90%, n_negative == 0 (90d)
  const negRows = rows.filter((r) => r.action_type === "add_negative" || r.action_type === "add_negative_phrase");
  const negTotal = negRows.reduce((s, r) => s + r.n_total, 0);
  const negNegative = negRows.reduce((s, r) => s + r.n_negative, 0);
  const negDecided = negRows.reduce((s, r) => s + (r.n_total - r.n_inconclusive), 0);
  const negHits = negRows.reduce((s, r) => s + r.n_positive + r.n_neutral, 0);
  const negHitRate = negDecided > 0 ? negHits / negDecided : null;
  const negativesReadyForL1 = negTotal >= 15 && negNegative === 0 && negHitRate != null && negHitRate >= 0.9;
  reasons.push(
    `Negatives: n=${negTotal}/15, negative=${negNegative} (muss 0), hit_rate=${negHitRate != null ? (negHitRate * 100).toFixed(0) + "%" : "n/a"}/90%`,
  );
  // Level 1 -> 2 (Bids): zusaetzlich bid_writes_enabled UND bid_adjustment n>=10, hit>=80%
  const bid = by("bid_adjustment");
  const bidDecided = bid ? bid.n_total - bid.n_inconclusive : 0;
  const bidHitRate = bid && bidDecided > 0 ? (bid.n_positive + bid.n_neutral) / bidDecided : null;
  const bidsReadyForL2 = !!bid && bidWritesEnabled && bid.n_total >= 10 && bidHitRate != null && bidHitRate >= 0.8;
  reasons.push(
    `Bids: writes_enabled=${bidWritesEnabled}, n=${bid?.n_total ?? 0}/10, hit_rate=${bidHitRate != null ? (bidHitRate * 100).toFixed(0) + "%" : "n/a"}/80%`,
  );
  return { negativesReadyForL1, bidsReadyForL2, dataProblems, reasons };
}

// ── GAQL-Helfer ──────────────────────────────────────────────────────────────
function gaqlEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
async function ctxFor(clientId: string, customer: string | null | undefined) {
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const customerId = String(customer ?? "").replace(/\D/g, "");
  if (!devToken || !customerId) return null;
  try {
    const t = await getGoogleAccessToken(clientId);
    return {
      customerId,
      headers: {
        Authorization: `Bearer ${t.accessToken}`,
        "developer-token": devToken,
        "Content-Type": "application/json",
        ...(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
          ? { "login-customer-id": String(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID).replace(/\D/g, "") }
          : {}),
      } as Record<string, string>,
    };
  } catch {
    return null;
  }
}
async function gaql(ctx: { customerId: string; headers: Record<string, string> }, q: string) {
  const res = await fetch(`${ADS_API}/customers/${ctx.customerId}/googleAds:searchStream`, {
    method: "POST", headers: ctx.headers, body: JSON.stringify({ query: q }),
  });
  if (!res.ok) throw new Error(`Ads API HTTP ${res.status}`);
  const json = (await res.json()) as Array<{ results?: Array<Record<string, any>> }>;
  return json.flatMap((b) => b.results ?? []);
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

async function campaignMetrics(
  ctx: { customerId: string; headers: Record<string, string> },
  campaign: string,
  from: string,
  to: string,
): Promise<Metrics> {
  const rows = await gaql(
    ctx,
    `SELECT metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.search_impression_share
     FROM campaign WHERE campaign.name = '${gaqlEscape(campaign)}' AND segments.date BETWEEN '${from}' AND '${to}'`,
  );
  let cost = 0, conv = 0, value = 0, isSum = 0, isN = 0;
  for (const r of rows) {
    cost += Number(r.metrics?.costMicros ?? 0) / MICROS;
    conv += Number(r.metrics?.conversions ?? 0);
    value += Number(r.metrics?.conversionsValue ?? 0);
    if (r.metrics?.searchImpressionShare != null) { isSum += Number(r.metrics.searchImpressionShare); isN += 1; }
  }
  return {
    cost: Math.round(cost * 100) / 100,
    conversions: Math.round(conv * 100) / 100,
    cpa: conv > 0 ? Math.round((cost / conv) * 100) / 100 : null,
    roas: cost > 0 ? Math.round((value / cost) * 100) / 100 : null,
    impressionShare: isN > 0 ? Math.round((isSum / isN) * 1000) / 1000 : null,
  };
}

// Kampagne aus dem Changelog-Entity ("Kampagne | Ad-Group" bzw. "Kampagne")
export function campaignFromEntity(entity: string | null): string {
  return String(entity ?? "").split(" | ")[0].trim();
}
// Negative-Term aus after_value: + "term" (negative ...)
export function termFromAfterValue(afterValue: string | null): string | null {
  const m = String(afterValue ?? "").match(/"([^"]+)"/);
  return m ? m[1] : null;
}

// ── Kern: Tagesjob (idempotent) ──────────────────────────────────────────────
export async function runOutcomeReview(clientId?: string): Promise<{
  ok: boolean;
  reviewed: number;
  downgrades: Array<{ clientId: string; from: number; to: number; reason: string }>;
  errors: string[];
}> {
  const out = { ok: true, reviewed: 0, downgrades: [] as Array<{ clientId: string; from: number; to: number; reason: string }>, errors: [] as string[] };
  const now = new Date();

  // 1) Kandidaten: umgesetzte Aenderungen, deren 14d-/30d-Fenster fällig ist.
  let q = supabaseAdmin
    .from("ads_changelog")
    .select("id, client_id, customer_id, action_type, entity, after_value, created_at, status")
    .in("status", ["executed", "approved"])
    .in("action_type", REVIEWABLE_TYPES)
    .lte("created_at", addDays(now, -15).toISOString()) // 14d Nachher-Fenster muss voll sein
    .order("created_at", { ascending: true })
    .limit(200);
  if (clientId) q = q.eq("client_id", clientId);
  const { data: changes, error } = await q;
  if (error) return { ...out, ok: false, errors: [error.message] };
  if (!changes?.length) return out;

  // Bereits vorhandene Reviews (Idempotenz)
  const { data: existing } = await supabaseAdmin
    .from("ads_outcome_reviews")
    .select("changelog_id, review_window")
    .in("changelog_id", changes.map((c) => c.id));
  const have = new Set((existing ?? []).map((e) => `${e.changelog_id}:${e.review_window}`));

  // Kontexte je Kunde cachen
  const ctxCache = new Map<string, Awaited<ReturnType<typeof ctxFor>>>();
  const clientRows = new Map<string, { google_ads_customer: string | null }>();

  for (const ch of changes) {
    const created = new Date(ch.created_at);
    const ageDays = Math.floor((now.getTime() - created.getTime()) / 86_400_000);
    const windows: Array<"14d" | "30d"> = [];
    if (ageDays >= 15 && !have.has(`${ch.id}:14d`)) windows.push("14d");
    if (ageDays >= 31 && !have.has(`${ch.id}:30d`)) windows.push("30d");
    if (!windows.length) continue;

    try {
      if (!clientRows.has(ch.client_id)) {
        const { data: cl } = await supabaseAdmin.from("clients").select("google_ads_customer").eq("id", ch.client_id).maybeSingle();
        clientRows.set(ch.client_id, { google_ads_customer: cl?.google_ads_customer ?? null });
      }
      if (!ctxCache.has(ch.client_id))
        ctxCache.set(ch.client_id, await ctxFor(ch.client_id, clientRows.get(ch.client_id)?.google_ads_customer));
      const ctx = ctxCache.get(ch.client_id);
      if (!ctx) { out.errors.push(`${ch.id}: kein Ads-Kontext`); continue; }

      const campaign = campaignFromEntity(ch.entity);
      if (!campaign) { out.errors.push(`${ch.id}: keine Kampagne im Entity`); continue; }

      for (const win of windows) {
        const n = win === "14d" ? 14 : 30;
        const beforeFrom = isoDay(addDays(created, -n));
        const beforeTo = isoDay(addDays(created, -1));
        const afterFrom = isoDay(addDays(created, 1));
        const afterTo = isoDay(addDays(created, n));

        const before = await campaignMetrics(ctx, campaign, beforeFrom, beforeTo);
        const after = await campaignMetrics(ctx, campaign, afterFrom, afterTo);

        // Confounder-Guard: weitere umgesetzte Aenderungen an derselben Kampagne
        // im Nachher-Fenster (aus dem Changelog) -> inconclusive statt Fehlattribution.
        const { data: conf } = await supabaseAdmin
          .from("ads_changelog")
          .select("id, action_type, entity, created_at")
          .eq("client_id", ch.client_id)
          .in("status", ["executed", "approved"])
          .neq("id", ch.id)
          .gte("created_at", afterFrom)
          .lte("created_at", `${afterTo} 23:59:59`);
        const confounders = (conf ?? []).filter((c) => campaignFromEntity(c.entity) === campaign);

        let verdict = computeVerdict(before, after);
        if (confounders.length > 0) verdict = "inconclusive";

        // Negatives: vermiedene Verschwendung = Kosten des Musters im Vorher-Fenster
        let avoided: number | null = null;
        if (ch.action_type.startsWith("add_negative") || ch.action_type === "negative_keyword_semantic") {
          const term = termFromAfterValue(ch.after_value);
          if (term) {
            try {
              const rows = await gaql(
                ctx,
                `SELECT metrics.cost_micros FROM search_term_view
                 WHERE search_term_view.search_term = '${gaqlEscape(term)}' AND segments.date BETWEEN '${beforeFrom}' AND '${beforeTo}'`,
              );
              avoided = Math.round(rows.reduce((s, r) => s + Number(r.metrics?.costMicros ?? 0) / MICROS, 0) * 100) / 100;
            } catch { /* Phrase-Muster nicht exakt abfragbar -> null */ }
          }
        }

        await supabaseAdmin.from("ads_outcome_reviews").insert({
          changelog_id: ch.id, client_id: ch.client_id, action_type: ch.action_type,
          review_window: win, metric_before: before, metric_after: after,
          verdict, confounders, avoided_waste_chf: avoided,
        });
        out.reviewed += 1;
      }
    } catch (e) {
      out.errors.push(`${ch.id}: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
    }
  }

  // 3) Automatische Herabstufung (4.3): 2 negative-Verdicts desselben Typs in 30d
  //    -> autonomy_level -1 + Alert. Erhoehung ist IMMER menschliche Config-Aenderung.
  const affectedClients = [...new Set(changes.map((c) => c.client_id))];
  for (const cid of affectedClients) {
    const { data: negs } = await supabaseAdmin
      .from("ads_outcome_reviews")
      .select("action_type, reviewed_at")
      .eq("client_id", cid)
      .eq("verdict", "negative")
      .gte("reviewed_at", addDays(now, -30).toISOString());
    const byType = new Map<string, number>();
    for (const r of negs ?? []) byType.set(r.action_type, (byType.get(r.action_type) ?? 0) + 1);
    const triggered = [...byType.entries()].filter(([, n]) => n >= 2);
    if (!triggered.length) continue;
    const { data: cfgRow } = await supabaseAdmin.from("ads_autopilot_config").select("autonomy_level").eq("client_id", cid).maybeSingle();
    const cur = cfgRow?.autonomy_level ?? 0;
    if (cur >= 1) {
      const to = cur - 1;
      const reason = triggered.map(([t, n]) => `${t}: ${n} negative-Verdicts/30d`).join("; ");
      await supabaseAdmin.from("ads_autopilot_config").update({ autonomy_level: to }).eq("client_id", cid);
      await supabaseAdmin.from("ads_changelog").insert({
        client_id: cid, customer_id: "-", run_id: `${isoDay(now)}-downgrade`,
        action_type: "autonomy_downgrade", action_class: "report-only",
        entity: "Konto", before_value: `autonomy_level ${cur}`, after_value: `autonomy_level ${to}`,
        rationale: `Automatische Herabstufung: ${reason}`, status: "executed",
      });
      out.downgrades.push({ clientId: cid, from: cur, to, reason });
    }
  }
  return out;
}
