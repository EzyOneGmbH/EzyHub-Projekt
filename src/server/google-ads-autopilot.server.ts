import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "./google-tokens.server";
import { addNegativeKeyword, setCampaignBudget } from "./google-ads-mutate.server";

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
// Mindest-ROAS fuer eine Budget-Erhoehungs-Empfehlung, wenn KEIN Ziel-ROAS gesetzt ist
// (z.B. wenn nur Ziel-CPA konfiguriert ist). Verhindert Budget-Empfehlungen fuer
// Kampagnen ohne belegten Return (z.B. ROAS 0.0).
const MIN_ROAS_FLOOR = 2.0;
// Phase 1.4: Spend-Summen zweier unabhaengiger Abfragen duerfen max. 5% abweichen,
// sonst Run-Abbruch (keine Teilausfuehrung auf inkonsistenten Daten).
const MAX_SPEND_DIVERGENCE = 0.05;
// Phase 1.2: Learning-Phase-Status, die jeden Write blockieren.
const LEARNING_STATUSES = new Set(["LEARNING_NEW", "LEARNING_SETTING_CHANGE", "LEARNING_BUDGET_CHANGE"]);
// Phase 1.3: Bid-Mutationen bleiben hart deaktiviert, bis die Vorschlagslogik
// existiert (Phase 4/5). Global, nur per Deployment-Env aenderbar.
export function bidWritesEnabled(): boolean {
  return process.env.ADS_BID_WRITES_ENABLED === "true";
}

export type AutopilotConfig = {
  client_id: string;
  industry: string;
  kill_switch: boolean;
  observe_only: boolean;
  autonomy_level: number;
  monthly_budget_chf: number;
  target_cpa_chf: number | null;
  target_roas: number | null;
  season_high: string[];
  season_low: string[];
  no_touch_campaigns: string[];
  languages: string[];
  notes: string | null;
  notes_updated_at: string | null;
  // Phase 1: Datenqualitaet & Tracking-Health (pro Kunde konfigurierbar)
  min_conversions_baseline: number;      // Tracking-Health: Mindest-Conversions in der 30d-Baseline
  conversion_lag_days: number;           // Negatives-Fenster endet vor N Tagen (Hotels: 14)
  min_conversions_for_budget_rec: number; // statistische Mindestbasis fuer Budget-Empfehlungen
};

const DEFAULT_CONFIG = (clientId: string): AutopilotConfig => ({
  client_id: clientId,
  industry: "kmu-local",
  kill_switch: false,
  observe_only: true, // sicher per Default: nur dokumentieren, keine Writes
  autonomy_level: 0,
  monthly_budget_chf: 0,
  target_cpa_chf: null,
  target_roas: null,
  season_high: [],
  season_low: [],
  no_touch_campaigns: [],
  languages: ["de"],
  notes: null,
  notes_updated_at: null,
  min_conversions_baseline: 3,
  conversion_lag_days: 7,
  min_conversions_for_budget_rec: 5,
});

// ── Datums-/Saison-Helfer ────────────────────────────────────────────────────
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDay(d);
}
// Saisonfenster "MM-TT..MM-TT" (kann Jahreswechsel ueberspannen). Liefert das
// aktive Fenster oder null.
export function activeSeasonWindow(cfg: AutopilotConfig, today = new Date()): { kind: "high" | "low"; window: string } | null {
  const mmdd = `${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const inWin = (w: string) => {
    const m = w.match(/^(\d{2}-\d{2})\.\.(\d{2}-\d{2})$/);
    if (!m) return false;
    const [, a, b] = m;
    return a <= b ? mmdd >= a && mmdd <= b : mmdd >= a || mmdd <= b; // b < a = Jahreswechsel
  };
  for (const w of cfg.season_high ?? []) if (inWin(w)) return { kind: "high", window: w };
  for (const w of cfg.season_low ?? []) if (inWin(w)) return { kind: "low", window: w };
  return null;
}

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
    biddingSystemStatus: string; // Phase 1.2: LEARNING_* blockiert Writes
    learning: boolean;
  }>;
  // Phase 1.4: Suchbegriffe im Conversion-Lag-Fenster (Tag -(30+lag) .. -lag),
  // damit junge Klicks ohne verbuchte Conversions nicht faelschlich als
  // "0 Conversions" ausgeschlossen werden.
  searchTerms: Array<{ term: string; campaign: string; adGroup: string; costChf: number; conversions: number }>;
  termWindow: { from: string; to: string; lagDays: number };
  // Phase 1.1: Tracking-Health (Konto-Ebene)
  trackingHealth: {
    status: "OK" | "BROKEN" | "NO_BASELINE";
    spend7d: number;
    conversions7d: number;
    conversionsBaseline30d: number; // Tag -37 .. -8
  };
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
  cfg?: AutopilotConfig,
): Promise<{ ok: boolean; data?: AutopilotData; skipped?: string; error?: string }> {
  const ctx = await adsContext(clientId, googleAdsCustomer);
  if ("skipped" in ctx) return { ok: false, skipped: ctx.skipped };
  const conf = cfg ?? DEFAULT_CONFIG(clientId);
  const lag = Math.max(0, conf.conversion_lag_days ?? 7);
  const termFrom = daysAgo(30 + lag);
  const termTo = daysAgo(lag);

  const data: AutopilotData = {
    campaigns: [],
    searchTerms: [],
    termWindow: { from: termFrom, to: termTo, lagDays: lag },
    trackingHealth: { status: "NO_BASELINE", spend7d: 0, conversions7d: 0, conversionsBaseline30d: 0 },
    meta: { customerId: ctx.customerId, costSumChf: 0, avgCpaChf: null },
    error: null,
  };
  try {
    const camps = await search(
      ctx,
      `SELECT campaign.name, campaign.status, campaign.bidding_strategy_system_status,
              campaign_budget.amount_micros, metrics.cost_micros,
              metrics.conversions, metrics.conversions_value, metrics.search_budget_lost_impression_share
       FROM campaign WHERE segments.date DURING LAST_30_DAYS AND campaign.status = 'ENABLED'`,
    );
    let costSum = 0;
    let convSum = 0;
    for (const r of camps) {
      const cost = Number(r.metrics?.costMicros ?? 0) / MICROS;
      const conv = Number(r.metrics?.conversions ?? 0);
      const sysStatus = String(r.campaign?.biddingStrategySystemStatus ?? "UNKNOWN");
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
        biddingSystemStatus: sysStatus,
        learning: LEARNING_STATUSES.has(sysStatus),
      });
    }
    data.meta.costSumChf = Math.round(costSum * 100) / 100;
    data.meta.avgCpaChf = convSum > 0 ? costSum / convSum : null;

    // Phase 1.4 Datenkonsistenz: unabhaengige Konto-Summe (customer-Ressource)
    // gegen die Kampagnen-Summe pruefen; >5% Abweichung -> Abbruch.
    const custRows = await search(
      ctx,
      `SELECT metrics.cost_micros FROM customer WHERE segments.date DURING LAST_30_DAYS`,
    );
    const custCost = Number(custRows?.[0]?.metrics?.costMicros ?? 0) / MICROS;
    const ref = Math.max(custCost, costSum);
    if (ref > 1 && Math.abs(custCost - costSum) / ref > MAX_SPEND_DIVERGENCE) {
      return {
        ok: false,
        error: `Datenkonsistenz verletzt: Konto-Spend CHF ${custCost.toFixed(2)} vs Kampagnen-Summe CHF ${costSum.toFixed(2)} (> ${MAX_SPEND_DIVERGENCE * 100}% Abweichung) - Run abgebrochen, keine Teilausfuehrung.`,
      };
    }

    // Phase 1.1 Tracking-Health: 7d aktuell vs 30d-Baseline (Tag -37 .. -8).
    const h7 = await search(
      ctx,
      `SELECT metrics.cost_micros, metrics.conversions FROM customer WHERE segments.date DURING LAST_7_DAYS`,
    );
    const base30 = await search(
      ctx,
      `SELECT metrics.conversions FROM customer WHERE segments.date BETWEEN '${daysAgo(37)}' AND '${daysAgo(8)}'`,
    );
    const spend7d = Number(h7?.[0]?.metrics?.costMicros ?? 0) / MICROS;
    const conv7d = Number(h7?.[0]?.metrics?.conversions ?? 0);
    const convBase = Number(base30?.[0]?.metrics?.conversions ?? 0);
    const minBaseline = conf.min_conversions_baseline ?? 3;
    data.trackingHealth = {
      status: computeTrackingHealth(spend7d, conv7d, convBase, minBaseline),
      spend7d: Math.round(spend7d * 100) / 100,
      conversions7d: conv7d,
      conversionsBaseline30d: convBase,
    };

    // Phase 1.4: Suchbegriffe im Lag-Fenster (statt LAST_30_DAYS).
    const terms = await search(
      ctx,
      `SELECT search_term_view.search_term, campaign.name, ad_group.name, metrics.cost_micros, metrics.conversions
       FROM search_term_view WHERE segments.date BETWEEN '${termFrom}' AND '${termTo}'
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

// Phase 1.2 (Execute-Pfad): Learning-Status einer einzelnen Kampagne live pruefen.
export async function isCampaignLearning(
  clientId: string,
  googleAdsCustomer: string | null | undefined,
  campaignName: string,
): Promise<{ learning: boolean; status: string; error?: string }> {
  const ctx = await adsContext(clientId, googleAdsCustomer);
  if ("skipped" in ctx) return { learning: false, status: "UNKNOWN", error: ctx.skipped };
  try {
    const rows = await search(
      ctx,
      `SELECT campaign.bidding_strategy_system_status FROM campaign WHERE campaign.name = '${gaqlEscape(campaignName)}' LIMIT 1`,
    );
    const st = String(rows?.[0]?.campaign?.biddingStrategySystemStatus ?? "UNKNOWN");
    return { learning: LEARNING_STATUSES.has(st), status: st };
  } catch (e) {
    // Konservativ: Bei Fehler NICHT blockieren-umgehen, sondern als learning behandeln.
    return { learning: true, status: "QUERY_FAILED", error: e instanceof Error ? e.message : String(e) };
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

// Phase 1.4: Normalisierung + 1-/2-Gram-Zerlegung fuer die Phrase-Aggregation.
export function normalizeTerm(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();
}
// Stoppwoerter (DE/FR/IT/EN): duerfen NIE eigenstaendige Phrase-Negative-Kandidaten
// werden ("mit" wuerde z.B. "hotel mit pool" blockieren). In 2-Grams bleiben sie
// erlaubt ("hotel gratis" ok), als Unigram nicht.
const STOPWORDS = new Set([
  "mit", "und", "der", "die", "das", "den", "dem", "des", "ein", "eine", "einem", "einen", "einer",
  "fuer", "für", "von", "vom", "zum", "zur", "bei", "beim", "auf", "aus", "als", "auch", "oder",
  "nicht", "sind", "ist", "war", "hat", "wie", "was", "wer", "im", "in", "am", "an",
  "the", "and", "for", "with", "from", "near", "best",
  "les", "des", "une", "aux", "avec", "pour", "dans", "sur", "pres", "près",
  "con", "per", "del", "della", "nel", "vicino",
]);
export function grams(term: string): string[] {
  const words = normalizeTerm(term).split(" ").filter((w) => w.length >= 3);
  // Unigrams: min. 4 Zeichen und kein Stoppwort.
  const out: string[] = words.filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  // Bigrams: mindestens ein Nicht-Stoppwort enthalten.
  for (let i = 0; i < words.length - 1; i++) {
    if (STOPWORDS.has(words[i]) && STOPWORDS.has(words[i + 1])) continue;
    out.push(`${words[i]} ${words[i + 1]}`);
  }
  return out;
}

// Phase 1.1: Tracking-Health als pure Funktion (unit-testbar; Abnahme
// "simulierter Tracking-Ausfall blockiert Writes").
export function computeTrackingHealth(
  spend7d: number,
  conversions7d: number,
  conversionsBaseline30d: number,
  minBaseline: number,
): "OK" | "BROKEN" | "NO_BASELINE" {
  if (spend7d > 0 && conversions7d === 0 && conversionsBaseline30d >= minBaseline) return "BROKEN";
  return conversionsBaseline30d >= minBaseline ? "OK" : "NO_BASELINE";
}

export function planActions(data: AutopilotData, cfg: AutopilotConfig): PlannedAction[] {
  const actions: PlannedAction[] = [];
  const noTouch = new Set(cfg.no_touch_campaigns.map((c) => c.trim()).filter(Boolean));
  const refCpa = cfg.target_cpa_chf ?? data.meta.avgCpaChf; // Fallback: Konto-Durchschnitts-CPA
  const learningCampaigns = new Set(data.campaigns.filter((c) => c.learning).map((c) => c.name));
  const season = activeSeasonWindow(cfg);
  const winNote = `${data.termWindow.from}..${data.termWindow.to}`;

  // Phase 1.4 Konfliktbasis: konvertierende Suchbegriffe im gesamten Konto.
  const convertingTerms = data.searchTerms.filter((t) => t.conversions > 0);
  const convertingByExact = new Map<string, string>(); // normTerm -> "campaign"
  for (const t of convertingTerms) {
    const k = normalizeTerm(t.term);
    if (!convertingByExact.has(k)) convertingByExact.set(k, t.campaign);
  }
  const conflictsForPhrase = (gram: string): string | null => {
    for (const t of convertingTerms) {
      if (normalizeTerm(t.term).includes(gram)) return `"${t.term}" (konvertiert in ${t.campaign})`;
    }
    return null;
  };

  // Rule 1 — Exact-Negatives: 0 Conversions & Kosten > 3x Ziel-CPA (Lag-Fenster).
  if (refCpa && refCpa > 0) {
    const threshold = 3 * refCpa;
    let count = 0;
    for (const t of data.searchTerms) {
      if (t.conversions > 0 || t.costChf <= threshold) continue;
      if (noTouch.has(t.campaign)) continue;
      // Cross-Kampagnen-Konfliktcheck: konvertiert derselbe Begriff woanders -> verwerfen.
      const convElsewhere = convertingByExact.get(normalizeTerm(t.term));
      if (convElsewhere && convElsewhere !== t.campaign) {
        actions.push({
          actionClass: "report-only",
          type: "negative_conflict",
          entity: `${t.campaign} | ${t.adGroup}`,
          before: "",
          after: `NICHT ausschliessen: "${t.term}"`,
          rationale: `Konflikt: "${t.term}" kostet hier CHF ${t.costChf.toFixed(2)} ohne Conv., konvertiert aber in "${convElsewhere}" - Vorschlag verworfen.`,
        });
        continue;
      }
      const learning = learningCampaigns.has(t.campaign);
      const overLimit = count >= MAX_NEGATIVES_PER_RUN;
      actions.push({
        actionClass: cfg.autonomy_level >= 1 && !overLimit && !learning ? "auto-execute" : "approval-needed",
        type: "add_negative",
        entity: `${t.campaign} | ${t.adGroup}`,
        before: "",
        after: `+ "${t.term}" (negative exact)`,
        rationale:
          `Search Term "${t.term}": Cost CHF ${t.costChf.toFixed(2)}, 0 Conv. im Lag-Fenster ${winNote} (> 3x Ziel-CPA ${refCpa.toFixed(2)})` +
          `${overLimit ? " [Limit 20/Run erreicht]" : ""}${learning ? " [Learning Phase aktiv - herabgestuft]" : ""}`,
        exec: { kind: "negative", campaign: t.campaign, term: t.term },
      });
      count += 1;
    }

    // Phase 1.4 — N-Gram-Aggregation: Phrase-Kandidaten (immer approval-needed,
    // Phrase-Reichweite > Exact).
    type Agg = { cost: number; conv: number; terms: Set<string>; campaign: string };
    const agg = new Map<string, Agg>();
    for (const t of data.searchTerms) {
      if (noTouch.has(t.campaign)) continue;
      for (const g of grams(t.term)) {
        const a = agg.get(g) ?? { cost: 0, conv: 0, terms: new Set<string>(), campaign: t.campaign };
        a.cost += t.costChf;
        a.conv += t.conversions;
        a.terms.add(normalizeTerm(t.term));
        agg.set(g, a);
      }
    }
    let phraseCount = 0;
    for (const [g, a] of [...agg.entries()].sort((x, y) => y[1].cost - x[1].cost)) {
      if (phraseCount >= 5) break; // konservativ: max 5 Phrase-Kandidaten je Run
      if (a.conv > 0 || a.cost <= 2 * refCpa || a.terms.size < 5) continue;
      const conflict = conflictsForPhrase(g);
      if (conflict) {
        actions.push({
          actionClass: "report-only",
          type: "negative_conflict",
          entity: `Konto | n-gram`,
          before: "",
          after: `NICHT als Phrase ausschliessen: "${g}"`,
          rationale: `Konflikt: n-gram "${g}" (CHF ${a.cost.toFixed(2)}, ${a.terms.size} Begriffe, 0 Conv.) wuerde ${conflict} blockieren - verworfen.`,
        });
        continue;
      }
      actions.push({
        actionClass: "approval-needed",
        type: "add_negative_phrase",
        entity: `${a.campaign} | n-gram`,
        before: "",
        after: `+ "${g}" (negative phrase)`,
        rationale: `n-gram "${g}": CHF ${a.cost.toFixed(2)} ueber ${a.terms.size} Suchbegriffe, 0 Conv. im Lag-Fenster ${winNote} (> 2x Ziel-CPA ${refCpa.toFixed(2)})`,
        estimatedImpact: `Vermeidet wiederkehrende Verschwendung des Musters (CHF ~${a.cost.toFixed(0)}/30d)`,
        exec: { kind: "negative", campaign: a.campaign, term: g },
      });
      phraseCount += 1;
    }
  }

  // Rule 2 — Budget: budgetlimitiert (IS Lost >= 20%) UND statistische Mindestbasis
  // (Phase 1.4: conversions >= min_conversions_for_budget_rec) UND ROAS >= Ziel/Floor.
  const targetRoas = cfg.target_roas ?? null;
  const roasFloor = targetRoas ?? MIN_ROAS_FLOOR;
  const minConv = cfg.min_conversions_for_budget_rec ?? 5;
  for (const c of data.campaigns) {
    if (noTouch.has(c.name)) continue;
    if (c.budgetLostIs >= 0.2 && c.conversions >= minConv && c.roas != null && c.roas >= roasFloor) {
      const proposed = Math.round(c.dailyBudgetChf * 1.1 * 100) / 100; // Vorschlag +10% (Hardlimit/Run)
      // Phase 1.5: In der Nebensaison basieren die 30d-Daten evtl. auf der Hauptsaison
      // -> Pflicht-Annotation, nie auto-execute (Budget ist ohnehin approval-needed).
      const seasonNote =
        season?.kind === "low"
          ? " [Nebensaison " + season.window + ": basiert auf Hauptsaison-Daten - pruefen]"
          : "";
      actions.push({
        actionClass: "approval-needed",
        type: "budget_change",
        entity: c.name,
        before: `CHF ${c.dailyBudgetChf.toFixed(2)}/Tag`,
        after: `CHF ${proposed.toFixed(2)}/Tag`,
        rationale:
          `Impression Share Lost (Budget) ${(c.budgetLostIs * 100).toFixed(0)}%, ROAS ${c.roas.toFixed(1)}${targetRoas ? ` > Ziel ${targetRoas}` : ""}, ${c.conversions.toFixed(0)} Conv./30d (Mindestbasis ${minConv})` +
          seasonNote +
          (learningCampaigns.has(c.name) ? " [Learning Phase aktiv]" : ""),
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
  observeOnly?: boolean;
  autonomyLevel?: number;
  executed: number;
  queued: number;
  reportOnly: number;
  failed: number;
  skipped?: string;
  error?: string;
  // Phase 1: Kontext fuer Report-Kopf + Gates
  trackingHealth?: { status: string; spend7d: number; conversions7d: number; conversionsBaseline30d: number };
  seasonWindow?: { kind: string; window: string } | null;
  termWindow?: { from: string; to: string; lagDays: number };
  learningCampaigns?: Array<{ name: string; status: string }>;
  notesAgeDays?: number | null;
  alerts?: string[];
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
    ok: true, runId, dryRun, observeOnly: cfg.observe_only, autonomyLevel: cfg.autonomy_level,
    executed: 0, queued: 0, reportOnly: 0, failed: 0, actions: [],
  };

  if (cfg.kill_switch) return { ...base, killSwitch: true, skipped: "Run uebersprungen (Kill-Switch aktiv)" };
  if (!client) return { ...base, ok: false, error: "Client not found" };

  const customerId = String(client.google_ads_customer ?? "").replace(/\D/g, "");
  const fetched = await fetchAutopilotData(clientId, client.google_ads_customer, cfg);
  if (!fetched.ok || !fetched.data) return { ...base, ok: false, skipped: fetched.skipped, error: fetched.error };

  // Phase 1: Kontext in die Summary (Report-Kopf).
  base.trackingHealth = fetched.data.trackingHealth;
  base.seasonWindow = activeSeasonWindow(cfg);
  base.termWindow = fetched.data.termWindow;
  base.learningCampaigns = fetched.data.campaigns
    .filter((c) => c.learning)
    .map((c) => ({ name: c.name, status: c.biddingSystemStatus }));
  base.notesAgeDays = cfg.notes_updated_at
    ? Math.floor((now.getTime() - new Date(cfg.notes_updated_at).getTime()) / 86_400_000)
    : null;
  base.alerts = [];
  if (base.notesAgeDays != null && base.notesAgeDays > 90)
    base.alerts.push(`Kontext-Check: notes zuletzt aktualisiert vor ${base.notesAgeDays} Tagen`);

  const planned = planActions(fetched.data, cfg);

  // Phase 1.1 Tracking-Health-Gate: bei BROKEN werden ALLE Write-Ops blockiert
  // (unabhaengig vom autonomy_level); der Run laeuft als reine Doku weiter.
  const trackingBroken = fetched.data.trackingHealth.status === "BROKEN";
  if (trackingBroken) {
    const th = fetched.data.trackingHealth;
    const alertMsg = `Tracking-Verdacht Konto ${client.name}: Spend 7d CHF ${th.spend7d.toFixed(2)} bei 0 Conversions (Baseline ${th.conversionsBaseline30d} Conv./30d)`;
    base.alerts.push(alertMsg);
    // Alert-Zeile ins Changelog, damit n8n/UI sie aufnehmen koennen.
    await supabaseAdmin.from("ads_changelog").insert({
      client_id: clientId, customer_id: customerId, run_id: runId,
      action_type: "tracking_health_alert", action_class: "report-only",
      entity: "Konto", before_value: "", after_value: "",
      rationale: alertMsg, status: "blocked_tracking",
    });
  }

  // observe_only (Evaluations-Gate) erzwingt Dry-Run; Tracking-BROKEN blockiert hart.
  const effectiveDryRun = dryRun || cfg.observe_only || cfg.autonomy_level < 1 || trackingBroken;

  // Dedup: bereits offene (pending) Approvals dieses Kunden nicht erneut anlegen
  // (sonst haeufen sich bei wiederholten Laeufen identische Empfehlungen).
  const { data: openAppr } = await supabaseAdmin
    .from("ads_approvals")
    .select("type, entity")
    .eq("client_id", clientId)
    .eq("status", "pending");
  const existingApprovalKeys = new Set((openAppr ?? []).map((a) => `${a.type}::${a.entity ?? ""}`));

  for (const a of planned) {
    // Tracking-BROKEN: reine Doku - keine Executes, keine Approvals (Daten unzuverlaessig).
    if (trackingBroken && a.actionClass !== "report-only") {
      await supabaseAdmin.from("ads_changelog").insert({
        client_id: clientId, customer_id: customerId, run_id: runId,
        action_type: a.type, action_class: a.actionClass, entity: a.entity,
        before_value: a.before, after_value: a.after,
        rationale: `${a.rationale} [blocked_tracking]`, status: "blocked_tracking",
      });
      base.actions.push({ class: a.actionClass, type: a.type, entity: a.entity, status: "blocked_tracking", rationale: a.rationale });
      continue;
    }
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
      // Duplikat gegen bereits offene Approvals? -> nicht erneut anlegen.
      const dedupKey = `${a.type}::${a.entity}`;
      if (existingApprovalKeys.has(dedupKey)) {
        base.actions.push({ class: a.actionClass, type: a.type, entity: a.entity, status: "already-pending", rationale: a.rationale });
        continue;
      }
      existingApprovalKeys.add(dedupKey);
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

// ── approve/reject a queued action (shared by admin + user-authed routes) ────
export type DecideResult = {
  ok: boolean;
  httpStatus: number;
  status?: string;
  error?: string;
  approvalId?: string;
};

export async function decideApproval(p: {
  approvalId?: string;
  runId?: string;
  actionId?: string;
  decision: "approve" | "reject";
  decidedBy?: string | null;
  clientId?: string; // optional guard: approval must belong to this client
}): Promise<DecideResult> {
  let q = supabaseAdmin.from("ads_approvals").select("*");
  q = p.approvalId ? q.eq("id", p.approvalId) : q.eq("run_id", p.runId!).eq("action_id", p.actionId!);
  const { data: appr, error } = await q.maybeSingle();
  if (error) return { ok: false, httpStatus: 500, error: error.message };
  if (!appr) return { ok: false, httpStatus: 404, error: "Approval nicht gefunden" };
  if (p.clientId && appr.client_id !== p.clientId)
    return { ok: false, httpStatus: 403, error: "Approval gehoert nicht zu diesem Kunden" };
  if (appr.status !== "pending")
    return { ok: false, httpStatus: 409, error: `Approval bereits '${appr.status}'`, approvalId: appr.id };
  if (appr.expires_at && new Date(appr.expires_at).getTime() < Date.now()) {
    await supabaseAdmin.from("ads_approvals").update({ status: "expired" }).eq("id", appr.id);
    return { ok: false, httpStatus: 410, error: "Approval abgelaufen", approvalId: appr.id };
  }

  // Phase 1.3: approved_by ist bei Freigaben zwingend (Audit-Trail).
  if (p.decision === "approve" && !p.decidedBy)
    return { ok: false, httpStatus: 400, error: "decidedBy (approved_by) ist bei Freigaben zwingend", approvalId: appr.id };

  const decidedAt = new Date().toISOString();

  if (p.decision === "reject") {
    await supabaseAdmin
      .from("ads_approvals")
      .update({ status: "rejected", decided_by: p.decidedBy ?? null, decided_at: decidedAt })
      .eq("id", appr.id);
    if (appr.changelog_id)
      await supabaseAdmin.from("ads_changelog").update({ status: "rejected", approved_by: p.decidedBy ?? null }).eq("id", appr.changelog_id);
    return { ok: true, httpStatus: 200, status: "rejected", approvalId: appr.id };
  }

  // Phase 2.3: Kampagnen-Proposals werden NIE automatisch umgesetzt (dauerhaftes
  // Nicht-Ziel). Approve markiert nur die Freigabe; die Umsetzung erfolgt manuell
  // bzw. via Editor-Export. Kein Google-Write -> nicht durch observe_only blockiert.
  const payloadEarly = (appr.payload && typeof appr.payload === "object" ? appr.payload : {}) as Record<string, any>;
  if (appr.type === "campaign_proposal" || payloadEarly.kind === "proposal") {
    await supabaseAdmin
      .from("ads_approvals")
      .update({ status: "approved", decided_by: p.decidedBy ?? null, decided_at: decidedAt })
      .eq("id", appr.id);
    if (appr.changelog_id)
      await supabaseAdmin.from("ads_changelog").update({ status: "approved", approved_by: p.decidedBy ?? null }).eq("id", appr.changelog_id);
    return { ok: true, httpStatus: 200, status: "approved", approvalId: appr.id };
  }

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, google_ads_customer")
    .eq("id", appr.client_id)
    .maybeSingle();
  if (!client) return { ok: false, httpStatus: 404, error: "Client not found" };
  const cfg = await loadConfig(appr.client_id);
  if (cfg.observe_only)
    return {
      ok: false,
      httpStatus: 423,
      error: "Beobachtungsmodus aktiv - Ausfuehrung deaktiviert. Erst observe_only=false setzen (nach Qualitaetspruefung).",
      approvalId: appr.id,
    };
  const payload = (appr.payload && typeof appr.payload === "object" ? appr.payload : {}) as Record<string, any>;

  // Phase 1.3: Bid-Mutationen bleiben hart gesperrt, bis die Vorschlagslogik existiert.
  if (payload.kind === "bid" && !bidWritesEnabled())
    return { ok: false, httpStatus: 423, error: "Bid-Writes global deaktiviert (bid_writes_enabled=false)", approvalId: appr.id };

  // Phase 1.1 (Execute-Pfad): Tracking-Health auch bei Freigaben pruefen.
  const freshData = await fetchAutopilotData(appr.client_id, client.google_ads_customer, cfg);
  if (freshData.ok && freshData.data?.trackingHealth.status === "BROKEN")
    return { ok: false, httpStatus: 423, error: "Tracking-Verdacht (BROKEN) - alle Write-Ops blockiert", approvalId: appr.id };

  // Phase 1.2 (Execute-Pfad): Learning-Phase live pruefen; LEARNING_* blockiert.
  if (payload.campaign) {
    const lp = await isCampaignLearning(appr.client_id, client.google_ads_customer, String(payload.campaign));
    if (lp.learning)
      return { ok: false, httpStatus: 423, error: `Learning Phase aktiv (${lp.status}) - Write blockiert, spaeter erneut freigeben`, approvalId: appr.id };
  }

  let result: { ok: boolean; error?: string; skipped?: string };
  if (payload.kind === "budget") {
    result = await setCampaignBudget({
      clientId: appr.client_id, googleAdsCustomer: client.google_ads_customer,
      campaignName: payload.campaign, dailyChf: Number(payload.dailyChf),
      dryRun: false, noTouch: cfg.no_touch_campaigns,
    });
  } else if (payload.kind === "negative") {
    result = await addNegativeKeyword({
      clientId: appr.client_id, googleAdsCustomer: client.google_ads_customer,
      campaignName: payload.campaign, term: payload.term,
      dryRun: false, noTouch: cfg.no_touch_campaigns,
    });
  } else {
    return { ok: false, httpStatus: 422, error: `Kein ausfuehrbarer payload (kind=${payload.kind ?? "?"})`, approvalId: appr.id };
  }

  const status = result.ok ? "executed" : "failed";
  await supabaseAdmin
    .from("ads_approvals")
    .update({ status, decided_by: p.decidedBy ?? null, decided_at: decidedAt })
    .eq("id", appr.id);
  if (appr.changelog_id)
    await supabaseAdmin.from("ads_changelog").update({ status, approved_by: p.decidedBy ?? null }).eq("id", appr.changelog_id);

  return { ok: result.ok, httpStatus: result.ok ? 200 : 502, status, error: result.error ?? result.skipped, approvalId: appr.id };
}
