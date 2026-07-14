import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { openRecommendationsBlock } from "./google-ads-recommendations.server";
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
    biddingStrategyType?: string; // z.B. MAXIMIZE_CONVERSION_VALUE, TARGET_CPA
    targetRoas?: number | null; // hinterlegtes Strategie-Ziel (falls gesetzt)
    targetCpaChf?: number | null;
    learning: boolean;
    // Oeffentliche IS-Metriken (Search) - Ersatz fuer die nicht-oeffentlichen
    // auction_insight_*-Metriken (API-Allowlist geschlossen). PMax liefert null.
    searchImpressionShare?: number | null;
    searchAbsTopImpressionShare?: number | null;
    // IS-Verlust-Aufteilung: Budget (Tagesbudget zu knapp) vs. Rang (Gebot/Qualitaet)
    rankLostIs?: number | null;
  }>;
  // Phase 1.4: Suchbegriffe im Conversion-Lag-Fenster (Tag -(30+lag) .. -lag),
  // damit junge Klicks ohne verbuchte Conversions nicht faelschlich als
  // "0 Conversions" ausgeschlossen werden.
  searchTerms: Array<{ term: string; campaign: string; adGroup: string; costChf: number; conversions: number; clicks: number }>;
  termWindow: { from: string; to: string; lagDays: number };
  // Phase 1.1: Tracking-Health (Konto-Ebene)
  trackingHealth: {
    status: "OK" | "BROKEN" | "NO_BASELINE";
    spend7d: number;
    conversions7d: number;
    conversionsBaseline30d: number; // Tag -37 .. -8
  };
  // Phase 3.1: erweiterte Datenbasis (alle report-only; fehlertolerant gezogen)
  auctionInsights: Array<{
    campaign: string;
    domain: string;
    impressionShare: number | null;
    overlapRate: number | null;
    outrankingShare: number | null;
  }>;
  // Struktur-Review (report-only): Gesamtstruktur ueber ALLE Kampagnentypen
  adGroupPerformance: Array<{ campaign: string; adGroup: string; costChf: number; conversions: number; convValue: number }>;
  keywordQuality: Array<{
    campaign: string;
    adGroup: string;
    keyword: string;
    matchType: string;
    qualityScore: number | null; // 1-10; null = von Google nicht bewertet
    expectedCtr: string;
    adRelevance: string;
    landingPageExperience: string;
    costChf: number;
    conversions: number;
  }>;
  // Monat vs. Vormonat je Kampagne (Tag -30..-1 vs. Tag -60..-31), alle Typen
  monthComparison: Array<{
    campaign: string;
    channelType: string;
    cost: number; costPrev: number;
    conversions: number; conversionsPrev: number;
    convValue: number; convValuePrev: number;
    roas: number | null; roasPrev: number | null;
  }>;
  pmaxSearchThemes: Array<{ campaign: string; category: string; clicks: number; impressions: number; conversions: number }>;
  geoPerformance: Array<{ location: string; costChf: number; conversions: number; convValue: number }>;
  devicePerformance: Array<{ campaign: string; device: string; costChf: number; conversions: number }>;
  assetIssues: Array<{ adGroup: string; fieldType: string; text: string; label: string }>;
  pmaxAssetGroups: Array<{ name: string; adStrength: string }>;
  rsaAdStrength?: Array<{ campaign: string; adGroup: string; adStrength: string }>;
  // Phase A (Advisory-Vertiefung): Mehrfenster-Extrakt (L90/L365/LIFETIME).
  // L30 bleibt die unveraenderte operative Basis aller bestehenden Regeln.
  multiWindow?: MultiWindowExtract;
  // Phase B.2: Asset-Detail (Servings/Pinning/Abdeckung/PMax-Videos, L90)
  assetDetail?: {
    overPinned: Array<{ adGroup: string; pinnedPositions: string[] }>;
    lowServing: Array<{ adGroup: string; fieldType: string; text: string; sharePct: number }>;
    adGroupsWithoutRsa: string[];
    pmaxMissingVideo: string[];
  };
  changeHistory: Array<{ at: string; user: string; resourceType: string; fields: string; campaignRef?: string; eventResource?: string }>;
  dataSourceErrors: string[]; // welche Phase-3-Quellen nicht lieferten (Transparenz)
  meta: { customerId: string; costSumChf: number; avgCpaChf: number | null };
  error: string | null;
};

// Geo-Target-Konstanten -> Laendernamen (haeufigste Maerkte; Rest als ID ausgewiesen)
const GEO_NAMES: Record<string, string> = {
  "2756": "Schweiz", "2276": "Deutschland", "2250": "Frankreich", "2380": "Italien",
  "2040": "Oesterreich", "2826": "Grossbritannien", "2840": "USA", "2528": "Niederlande",
  "2056": "Belgien", "2442": "Luxemburg", "2724": "Spanien", "2616": "Polen",
  "2203": "Tschechien", "2208": "Daenemark", "2752": "Schweden", "2578": "Norwegen",
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
  if (!res.ok) {
    // Fehlertext kompaktieren: JSON-Whitespace raus, damit der aussagekraeftige
    // Detail-Fehlercode (errors[].errorCode) die Slice-Grenze nicht sprengt.
    const raw = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 600);
    throw new Error(`Ads API HTTP ${res.status}: ${raw}`);
  }
  const json = (await res.json()) as Array<{ results?: Array<Record<string, any>> }>;
  return json.flatMap((b) => b.results ?? []);
}

// Read-only GAQL fuer Nebenmodule (z.B. Waechter-Lauf) - gleiche Auth/Kontext-Logik.
export async function adsQuery(
  clientId: string,
  googleAdsCustomer: string | null | undefined,
  gaql: string,
): Promise<{ ok: boolean; rows?: Array<Record<string, any>>; skipped?: string; error?: string }> {
  const ctx = await adsContext(clientId, googleAdsCustomer);
  if ("skipped" in ctx) return { ok: false, skipped: ctx.skipped };
  try {
    return { ok: true, rows: await search(ctx, gaql) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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
  const clientIdForData = clientId;
  const customerIdForData = String(googleAdsCustomer ?? "").replace(/\D/g, "");
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
    auctionInsights: [],
    adGroupPerformance: [],
    keywordQuality: [],
    monthComparison: [],
    pmaxSearchThemes: [],
    geoPerformance: [],
    devicePerformance: [],
    assetIssues: [],
    pmaxAssetGroups: [],
    changeHistory: [],
    dataSourceErrors: [],
    meta: { customerId: ctx.customerId, costSumChf: 0, avgCpaChf: null },
    error: null,
  };
  // Phase 3.1: Zusatzquellen fehlertolerant - eine ausfallende Quelle bricht den Run nicht.
  const soft = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      data.dataSourceErrors.push(`${label}: ${(e instanceof Error ? e.message : String(e)).slice(0, 600)}`);
    }
  };
  try {
    const camps = await search(
      ctx,
      `SELECT campaign.name, campaign.status, campaign.bidding_strategy_system_status,
              campaign.bidding_strategy_type,
              campaign.maximize_conversion_value.target_roas, campaign.target_roas.target_roas,
              campaign.maximize_conversions.target_cpa_micros, campaign.target_cpa.target_cpa_micros,
              campaign_budget.amount_micros, metrics.cost_micros,
              metrics.conversions, metrics.conversions_value, metrics.search_budget_lost_impression_share,
              metrics.search_impression_share, metrics.search_absolute_top_impression_share,
              metrics.search_rank_lost_impression_share
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
      // Gebotsstrategie: Typ + hinterlegte Ziele (fuer das report-only Review).
      const tRoas =
        Number(r.campaign?.maximizeConversionValue?.targetRoas ?? 0) ||
        Number(r.campaign?.targetRoas?.targetRoas ?? 0) ||
        null;
      const tCpaMicros =
        Number(r.campaign?.targetCpa?.targetCpaMicros ?? 0) ||
        Number(r.campaign?.maximizeConversions?.targetCpaMicros ?? 0) ||
        0;
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
        biddingStrategyType: String(r.campaign?.biddingStrategyType ?? "UNKNOWN"),
        targetRoas: tRoas,
        targetCpaChf: tCpaMicros ? tCpaMicros / MICROS : null,
        learning: LEARNING_STATUSES.has(sysStatus),
        searchImpressionShare: r.metrics?.searchImpressionShare != null ? Number(r.metrics.searchImpressionShare) : null,
        searchAbsTopImpressionShare: r.metrics?.searchAbsoluteTopImpressionShare != null ? Number(r.metrics.searchAbsoluteTopImpressionShare) : null,
        rankLostIs: r.metrics?.searchRankLostImpressionShare != null ? Number(r.metrics.searchRankLostImpressionShare) : null,
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
      `SELECT search_term_view.search_term, campaign.name, ad_group.name, metrics.cost_micros, metrics.conversions, metrics.clicks
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
        clicks: Number(r.metrics?.clicks ?? 0),
      });
    }

    // ── Phase 3.1: fuenf Zusatzquellen (report-only, fehlertolerant) ──────────
    // 1) Auction Insights: wer verdraengt uns (je Mitbewerber-Domain, Kampagnen-Ebene)?
    await soft("auction_insights", async () => {
      const rows = await search(
        ctx,
        `SELECT campaign.name, segments.auction_insight_domain,
                metrics.auction_insight_search_impression_share,
                metrics.auction_insight_search_overlap_rate,
                metrics.auction_insight_search_outranking_share
         FROM campaign WHERE segments.date DURING LAST_30_DAYS AND campaign.status = 'ENABLED'
         ORDER BY metrics.auction_insight_search_overlap_rate DESC LIMIT 100`,
      );
      for (const r of rows) {
        const dom = r.segments?.auctionInsightDomain ?? "";
        if (!dom) continue;
        data.auctionInsights.push({
          campaign: r.campaign?.name ?? "",
          domain: dom,
          impressionShare: r.metrics?.auctionInsightSearchImpressionShare != null ? Number(r.metrics.auctionInsightSearchImpressionShare) : null,
          overlapRate: r.metrics?.auctionInsightSearchOverlapRate != null ? Number(r.metrics.auctionInsightSearchOverlapRate) : null,
          outrankingShare: r.metrics?.auctionInsightSearchOutrankingShare != null ? Number(r.metrics.auctionInsightSearchOutrankingShare) : null,
        });
      }
    });

    // 2) Geo-Performance (Herkunft/Zielregion auf Laender-Ebene)
    await soft("geo_performance", async () => {
      const rows = await search(
        ctx,
        `SELECT geographic_view.country_criterion_id, metrics.cost_micros, metrics.conversions, metrics.conversions_value
         FROM geographic_view WHERE segments.date DURING LAST_30_DAYS`,
      );
      const agg = new Map<string, { cost: number; conv: number; value: number }>();
      for (const r of rows) {
        const id = String(r.geographicView?.countryCriterionId ?? "");
        const key = GEO_NAMES[id] ?? `Land ${id}`;
        const a = agg.get(key) ?? { cost: 0, conv: 0, value: 0 };
        a.cost += Number(r.metrics?.costMicros ?? 0) / MICROS;
        a.conv += Number(r.metrics?.conversions ?? 0);
        a.value += Number(r.metrics?.conversionsValue ?? 0);
        agg.set(key, a);
      }
      data.geoPerformance = [...agg.entries()]
        .map(([location, a]) => ({ location, costChf: Math.round(a.cost * 100) / 100, conversions: a.conv, convValue: a.value }))
        .sort((x, y) => y.costChf - x.costChf)
        .slice(0, 20);
    });

    // 3) Geraete (Kampagnen-Ebene)
    await soft("device_performance", async () => {
      const rows = await search(
        ctx,
        `SELECT campaign.name, segments.device, metrics.cost_micros, metrics.conversions
         FROM campaign WHERE segments.date DURING LAST_30_DAYS AND campaign.status = 'ENABLED'`,
      );
      for (const r of rows) {
        data.devicePerformance.push({
          campaign: r.campaign?.name ?? "",
          device: String(r.segments?.device ?? "UNKNOWN"),
          costChf: Number(r.metrics?.costMicros ?? 0) / MICROS,
          conversions: Number(r.metrics?.conversions ?? 0),
        });
      }
    });

    // 4) Asset-Performance: schwache RSA-Bestandteile + PMax-Asset-Gruppen-Staerke
    await soft("asset_performance", async () => {
      const rows = await search(
        ctx,
        `SELECT ad_group.name, ad_group_ad_asset_view.field_type, ad_group_ad_asset_view.performance_label, asset.text_asset.text
         FROM ad_group_ad_asset_view
         WHERE ad_group_ad_asset_view.performance_label IN ('LOW','GOOD','BEST') LIMIT 300`,
      );
      for (const r of rows) {
        const label = String(r.adGroupAdAssetView?.performanceLabel ?? "");
        if (label !== "LOW") continue; // Report fokussiert auf Schwaechen
        data.assetIssues.push({
          adGroup: r.adGroup?.name ?? "",
          fieldType: String(r.adGroupAdAssetView?.fieldType ?? ""),
          text: String(r.asset?.textAsset?.text ?? "").slice(0, 90),
          label,
        });
      }
    });
    await soft("pmax_asset_groups", async () => {
      const rows = await search(
        ctx,
        `SELECT asset_group.name, asset_group.ad_strength FROM asset_group LIMIT 50`,
      );
      for (const r of rows) {
        data.pmaxAssetGroups.push({
          name: r.assetGroup?.name ?? "",
          adStrength: String(r.assetGroup?.adStrength ?? "UNKNOWN"),
        });
      }
    });
    // Phase B.2: Asset-Detail (L90) - Servings je Asset, Pinning, Abdeckung,
    // fehlende PMax-Asset-Typen. Alles aggregiert (Token-Diaet), report-only-Basis.
    await soft("asset_detail", async () => {
      // Servings + Pinning je Asset (L90)
      const rows = await search(
        ctx,
        `SELECT campaign.name, ad_group.name, ad_group_ad_asset_view.field_type, ad_group_ad_asset_view.pinned_field, metrics.impressions, asset.text_asset.text
         FROM ad_group_ad_asset_view
         WHERE segments.date BETWEEN '${daysAgo(90)}' AND '${daysAgo(1)}' LIMIT 400`,
      );
      const pinsPerGroup = new Map<string, Set<string>>();
      const grpImpr = new Map<string, number>();
      type AssetRow = { adGroup: string; fieldType: string; text: string; impressions: number };
      const assets: AssetRow[] = [];
      for (const r of rows) {
        const adGroup = `${r.campaign?.name ?? ""} | ${r.adGroup?.name ?? ""}`;
        const impressions = Number(r.metrics?.impressions ?? 0);
        const pinned = String(r.adGroupAdAssetView?.pinnedField ?? "");
        if (pinned && pinned !== "UNSPECIFIED" && pinned !== "UNKNOWN") {
          const s = pinsPerGroup.get(adGroup) ?? new Set<string>();
          s.add(pinned);
          pinsPerGroup.set(adGroup, s);
        }
        grpImpr.set(adGroup, (grpImpr.get(adGroup) ?? 0) + impressions);
        assets.push({
          adGroup,
          fieldType: String(r.adGroupAdAssetView?.fieldType ?? ""),
          text: String(r.asset?.textAsset?.text ?? "").slice(0, 60),
          impressions,
        });
      }
      // Ueberpinnte Ad-Groups (> 2 gepinnte Positionen = Flexibilitaetsverlust)
      const overPinned = [...pinsPerGroup.entries()]
        .filter(([, s]) => s.size > 2)
        .map(([adGroup, s]) => ({ adGroup, pinnedPositions: [...s].sort() }));
      // Servings: Assets mit auffaellig kleinem Impressions-Anteil (< 2% der Gruppe, Gruppe >= 500 Impr.)
      const lowServing = assets
        .filter((a) => (grpImpr.get(a.adGroup) ?? 0) >= 500 && a.impressions < 0.02 * (grpImpr.get(a.adGroup) ?? 0))
        .sort((a, b) => (grpImpr.get(b.adGroup) ?? 0) - (grpImpr.get(a.adGroup) ?? 0))
        .slice(0, 10)
        .map((a) => ({ adGroup: a.adGroup, fieldType: a.fieldType, text: a.text, sharePct: Math.round((a.impressions / Math.max(1, grpImpr.get(a.adGroup) ?? 1)) * 1000) / 10 }));

      // Abdeckung: aktive Search-Ad-Groups ohne aktive RSA
      const adRows = await search(
        ctx,
        `SELECT campaign.name, ad_group.name FROM ad_group_ad
         WHERE ad_group_ad.status = 'ENABLED' AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD' AND campaign.status = 'ENABLED' LIMIT 300`,
      );
      const groupsWithRsa = new Set(adRows.map((r) => `${r.campaign?.name ?? ""} | ${r.adGroup?.name ?? ""}`));
      const grpRows = await search(
        ctx,
        `SELECT campaign.name, ad_group.name FROM ad_group
         WHERE ad_group.status = 'ENABLED' AND campaign.status = 'ENABLED' AND campaign.advertising_channel_type = 'SEARCH' LIMIT 300`,
      );
      const noRsa = [...new Set(grpRows.map((r) => `${r.campaign?.name ?? ""} | ${r.adGroup?.name ?? ""}`))]
        .filter((g) => !groupsWithRsa.has(g))
        .slice(0, 10);

      // PMax: fehlende Asset-Typen je Gruppe (v.a. Video -> Google generiert sonst selbst)
      const agRows = await search(
        ctx,
        `SELECT asset_group.name, asset_group_asset.field_type FROM asset_group_asset
         WHERE asset_group_asset.status = 'ENABLED' LIMIT 500`,
      );
      const typesPerGroup = new Map<string, Set<string>>();
      for (const r of agRows) {
        const g = String(r.assetGroup?.name ?? "");
        const s = typesPerGroup.get(g) ?? new Set<string>();
        s.add(String(r.assetGroupAsset?.fieldType ?? ""));
        typesPerGroup.set(g, s);
      }
      const pmaxMissingVideo = [...typesPerGroup.entries()]
        .filter(([, s]) => !s.has("YOUTUBE_VIDEO"))
        .map(([g]) => g)
        .slice(0, 15);

      data.assetDetail = { overPinned, lowServing, adGroupsWithoutRsa: noRsa, pmaxMissingVideo };
    });

    // Asset-Qualitaets-KPI: Ad Strength der aktiven RSAs (Pendant zu den
    // PMax-Asset-Gruppen) - Basis fuer das report-only Asset-Review.
    await soft("rsa_ad_strength", async () => {
      const rows = await search(
        ctx,
        `SELECT campaign.name, ad_group.name, ad_group_ad.ad_strength
         FROM ad_group_ad
         WHERE ad_group_ad.status = 'ENABLED' AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD' LIMIT 200`,
      );
      for (const r of rows) {
        (data.rsaAdStrength ??= []).push({
          campaign: r.campaign?.name ?? "",
          adGroup: r.adGroup?.name ?? "",
          adStrength: String(r.adGroupAd?.adStrength ?? "UNKNOWN"),
        });
      }
    });

    // 5) Aenderungshistorie 29d (wer/was/wann) - Externen-Detektor + Monats-Audit-Basis
    // (change_event erlaubt max. 30 Tage Rueckblick; 29 vermeidet Randfehler)
    await soft("change_history", async () => {
      const rows = await search(
        ctx,
        `SELECT change_event.resource_name, change_event.change_date_time, change_event.user_email, change_event.change_resource_type, change_event.changed_fields, change_event.campaign
         FROM change_event
         WHERE change_event.change_date_time >= '${daysAgo(29)}' AND change_event.change_date_time <= '${daysAgo(0)} 23:59:59'
         ORDER BY change_event.change_date_time DESC LIMIT 100`,
      );
      for (const r of rows) {
        data.changeHistory.push({
          at: String(r.changeEvent?.changeDateTime ?? ""),
          user: String(r.changeEvent?.userEmail ?? ""),
          resourceType: String(r.changeEvent?.changeResourceType ?? ""),
          fields: String(r.changeEvent?.changedFields ?? "").slice(0, 120),
          campaignRef: String(r.changeEvent?.campaign ?? ""),
          eventResource: String(r.changeEvent?.resourceName ?? ""),
        });
      }
    });

    // ── Phase A (Advisory-Vertiefung): Mehrfenster-Extrakt L90/L365/LIFETIME ──
    // Fehlertolerant (soft) und vollstaendig ADDITIV: kein bestehender L30-Wert
    // haengt hiervon ab. Token-Diaet: aggregierte Extrakte, nie Rohtabellen.
    await soft("multi_window", async () => {
      const CAMP_FIELDS =
        "campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, metrics.cost_micros, metrics.conversions, metrics.conversions_value";
      const between = (a: number, b: number) => ` AND segments.date BETWEEN '${daysAgo(a)}' AND '${daysAgo(b)}'`;
      const sums = (rows: Array<Record<string, any>>) => {
        const m = new Map<string, { status: string; channel: string; cost: number; conv: number; value: number }>();
        for (const r of rows) {
          const name = String(r.campaign?.name ?? "");
          const a = m.get(name) ?? {
            status: String(r.campaign?.status ?? ""),
            channel: String(r.campaign?.advertisingChannelType ?? ""),
            cost: 0, conv: 0, value: 0,
          };
          a.cost += Number(r.metrics?.costMicros ?? 0) / MICROS;
          a.conv += Number(r.metrics?.conversions ?? 0);
          a.value += Number(r.metrics?.conversionsValue ?? 0);
          m.set(name, a);
        }
        return m;
      };

      // Kampagnen je Fenster (ENABLED + PAUSED; LIFETIME = ohne Datumsfilter)
      const [l90, l365, life] = await Promise.all([
        search(ctx, `SELECT ${CAMP_FIELDS} FROM campaign WHERE campaign.status IN ('ENABLED','PAUSED')${between(90, 1)}`),
        search(ctx, `SELECT ${CAMP_FIELDS} FROM campaign WHERE campaign.status IN ('ENABLED','PAUSED')${between(365, 1)}`),
        search(ctx, `SELECT ${CAMP_FIELDS} FROM campaign WHERE campaign.status IN ('ENABLED','PAUSED')`),
      ]);
      const m90 = sums(l90), m365 = sums(l365), mLife = sums(life);
      const idToName = new Map<string, string>();
      for (const r of life) idToName.set(String(r.campaign?.id ?? ""), String(r.campaign?.name ?? ""));

      const wm = (m: Map<string, any>, name: string) => {
        const a = m.get(name);
        return windowMetrics(a?.cost ?? 0, a?.conv ?? 0, a?.value ?? 0);
      };
      const campaigns = [...mLife.entries()]
        .sort((a, b) => b[1].cost - a[1].cost)
        .slice(0, 25)
        .map(([name, a]) => ({
          campaign: name, status: a.status, channelType: a.channel,
          L90: wm(m90, name), L365: wm(m365, name), LIFETIME: windowMetrics(a.cost, a.conv, a.value),
        }));

      // REMOVED nur als LIFETIME-Summe
      let removedLifetime = { campaigns: 0, ...windowMetrics(0, 0, 0) };
      try {
        const rem = await search(ctx, `SELECT ${CAMP_FIELDS} FROM campaign WHERE campaign.status = 'REMOVED'`);
        const mr = sums(rem);
        let c = 0, v = 0, k = 0;
        for (const a of mr.values()) { c += a.cost; k += a.conv; v += a.value; }
        removedLifetime = { campaigns: mr.size, ...windowMetrics(c, k, v) };
      } catch { /* REMOVED-Abfrage optional */ }

      // Monats-Serie 12M (Konto-Ebene, Saisonmuster)
      const months = await search(
        ctx,
        `SELECT segments.month, metrics.cost_micros, metrics.conversions FROM campaign${between(365, 1).replace(" AND", " WHERE")}`,
      );
      const mm = new Map<string, { cost: number; conv: number }>();
      for (const r of months) {
        const mo = String(r.segments?.month ?? "").slice(0, 7);
        if (!mo) continue;
        const a = mm.get(mo) ?? { cost: 0, conv: 0 };
        a.cost += Number(r.metrics?.costMicros ?? 0) / MICROS;
        a.conv += Number(r.metrics?.conversions ?? 0);
        mm.set(mo, a);
      }
      const monthlySeries = [...mm.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([month, a]) => ({ month, costChf: Math.round(a.cost * 100) / 100, conversions: Math.round(a.conv * 100) / 100 }));

      // Keywords: Top nach LIFETIME-Kosten, mit L90 daneben (Basis keyword_pause)
      const KW_FIELDS =
        "campaign.name, ad_group.name, ad_group_criterion.keyword.text, metrics.cost_micros, metrics.conversions";
      const kwAgg = (rows: Array<Record<string, any>>) => {
        const m = new Map<string, { costChf: number; conversions: number }>();
        for (const r of rows) {
          const key = `${r.campaign?.name ?? ""} | ${r.adGroup?.name ?? ""} | ${r.adGroupCriterion?.keyword?.text ?? ""}`;
          const a = m.get(key) ?? { costChf: 0, conversions: 0 };
          a.costChf += Number(r.metrics?.costMicros ?? 0) / MICROS;
          a.conversions += Number(r.metrics?.conversions ?? 0);
          m.set(key, a);
        }
        return m;
      };
      const [kw90, kwLife] = await Promise.all([
        search(ctx, `SELECT ${KW_FIELDS} FROM keyword_view WHERE campaign.status IN ('ENABLED','PAUSED')${between(90, 1)} ORDER BY metrics.cost_micros DESC LIMIT 200`),
        search(ctx, `SELECT ${KW_FIELDS} FROM keyword_view WHERE campaign.status IN ('ENABLED','PAUSED') ORDER BY metrics.cost_micros DESC LIMIT 200`),
      ]);
      const k90 = kwAgg(kw90), kLife = kwAgg(kwLife);
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const keywordsTop = [...kLife.entries()]
        .sort((a, b) => b[1].costChf - a[1].costChf)
        .slice(0, 40)
        .map(([key, lifeV]) => {
          const [campaign, adGroup, keyword] = key.split(" | ");
          const v90 = k90.get(key) ?? { costChf: 0, conversions: 0 };
          return {
            campaign, adGroup, keyword,
            L90: { costChf: r2(v90.costChf), conversions: r2(v90.conversions) },
            LIFETIME: { costChf: r2(lifeV.costChf), conversions: r2(lifeV.conversions) },
          };
        });

      // Geo + Geraete L90 (aggregiert, klein)
      const geoRows = await search(
        ctx,
        `SELECT geographic_view.country_criterion_id, metrics.cost_micros, metrics.conversions FROM geographic_view WHERE segments.date BETWEEN '${daysAgo(90)}' AND '${daysAgo(1)}'`,
      );
      const geoAgg = new Map<string, { cost: number; conv: number }>();
      for (const r of geoRows) {
        const id = String(r.geographicView?.countryCriterionId ?? "");
        const key = GEO_NAMES[id] ?? `Land ${id}`;
        const a = geoAgg.get(key) ?? { cost: 0, conv: 0 };
        a.cost += Number(r.metrics?.costMicros ?? 0) / MICROS;
        a.conv += Number(r.metrics?.conversions ?? 0);
        geoAgg.set(key, a);
      }
      const geoL90 = [...geoAgg.entries()]
        .map(([location, a]) => ({ location, costChf: r2(a.cost), conversions: r2(a.conv) }))
        .sort((x, y) => y.costChf - x.costChf)
        .slice(0, 10);
      const devRows = await search(
        ctx,
        `SELECT segments.device, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${daysAgo(90)}' AND '${daysAgo(1)}'`,
      );
      const devAgg = new Map<string, { cost: number; conv: number }>();
      for (const r of devRows) {
        const d = String(r.segments?.device ?? "UNKNOWN");
        const a = devAgg.get(d) ?? { cost: 0, conv: 0 };
        a.cost += Number(r.metrics?.costMicros ?? 0) / MICROS;
        a.conv += Number(r.metrics?.conversions ?? 0);
        devAgg.set(d, a);
      }
      const deviceL90 = [...devAgg.entries()].map(([device, a]) => ({ device, costChf: r2(a.cost), conversions: r2(a.conv) }));

      // Zusatzauftrag: Aenderungs-Events dauerhaft persistieren (append-only,
      // idempotent via Unique (client_id, event_resource)) - damit die
      // Strategie-Segmentierung ueber die 29-Tage-API-Grenze hinaus waechst.
      const classifySource = (email: string) =>
        /auto.?apply|recommendation/i.test(email) ? "google_auto" : email ? "human" : "unknown";
      const eventRows = data.changeHistory
        .filter((c) => c.eventResource)
        .map((c) => ({
          client_id: clientIdForData,
          customer_id: customerIdForData,
          event_resource: c.eventResource!,
          occurred_at: c.at ? new Date(c.at.replace(" ", "T") + "Z").toISOString() : new Date().toISOString(),
          user_email: c.user,
          resource_type: c.resourceType,
          changed_fields: c.fields,
          campaign: idToName.get(String(c.campaignRef ?? "").split("/").pop() ?? "") ?? null,
          source: classifySource(c.user),
          is_bidding_change: c.resourceType === "CAMPAIGN" && BIDDING_FIELDS_RE.test(c.fields),
        }));
      if (eventRows.length) {
        await supabaseAdmin
          .from("ads_change_events")
          .upsert(eventRows, { onConflict: "client_id,event_resource", ignoreDuplicates: true });
      }

      // Strategiewechsel aus der PERSISTIERTEN Historie (bis 365d), nicht nur
      // aus dem 29d-Live-Fenster; juengster Wechsel je Kampagne.
      let strategyChanges: Array<{ campaign: string; at: string; fields: string }> = [];
      try {
        const { data: persisted } = await supabaseAdmin
          .from("ads_change_events")
          .select("campaign, occurred_at, changed_fields")
          .eq("client_id", clientIdForData)
          .eq("is_bidding_change", true)
          .gte("occurred_at", new Date(Date.now() - 365 * 86400000).toISOString())
          .order("occurred_at", { ascending: false })
          .limit(50);
        const seen = new Set<string>();
        for (const e of persisted ?? []) {
          if (!e.campaign || seen.has(e.campaign)) continue;
          seen.add(e.campaign);
          strategyChanges.push({ campaign: e.campaign, at: String(e.occurred_at).replace("T", " ").slice(0, 19), fields: e.changed_fields ?? "" });
        }
      } catch {
        strategyChanges = detectStrategyChanges(data.changeHistory, idToName); // Fallback Live-Fenster
      }
      const strategyPeriods: MultiWindowExtract["strategyPeriods"] = [];
      for (const ch of strategyChanges.slice(0, 3)) {
        const ranges = periodRanges(ch.at, daysAgo(1));
        if (!ranges) continue;
        const per = async (from: string, to: string) => {
          const rows = await search(
            ctx,
            `SELECT metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign WHERE campaign.name = '${gaqlEscape(ch.campaign)}' AND segments.date BETWEEN '${from}' AND '${to}'`,
          );
          let c = 0, k = 0, v = 0;
          for (const r of rows) {
            c += Number(r.metrics?.costMicros ?? 0) / MICROS;
            k += Number(r.metrics?.conversions ?? 0);
            v += Number(r.metrics?.conversionsValue ?? 0);
          }
          return windowMetrics(c, k, v);
        };
        strategyPeriods.push({
          campaign: ch.campaign,
          changedAt: ch.at,
          before: { ...(await per(ranges.before.from, ranges.before.to)), days: ranges.before.days },
          after: { ...(await per(ranges.after.from, ranges.after.to)), days: ranges.after.days },
        });
      }

      // Phase B.3 (deterministisch): Streichkandidaten auf LIFETIME-Basis -
      // Kosten > 3x Ziel-CPA (Fallback Konto-CPA) und 0 Conversions ueberhaupt.
      const cpaRef = (cfg?.target_cpa_chf ?? 0) > 0 ? cfg!.target_cpa_chf! : data.meta.avgCpaChf || 0;
      const pauseCandidates =
        cpaRef > 0
          ? keywordsTop
              .filter((k) => k.LIFETIME.conversions === 0 && k.LIFETIME.costChf > 3 * cpaRef)
              .slice(0, 10)
              .map((k) => ({ campaign: k.campaign, adGroup: k.adGroup, keyword: k.keyword, lifetimeCostChf: k.LIFETIME.costChf }))
          : [];

      // Phase B.3 (deterministisch): Kannibalisierung - gleicher Suchbegriff in
      // mehreren Kampagnen (aus dem L30-Suchbegriffsfenster), mit Kosten-Split.
      const byTerm = new Map<string, Map<string, number>>();
      for (const s of data.searchTerms) {
        const m = byTerm.get(s.term) ?? new Map<string, number>();
        m.set(s.campaign, (m.get(s.campaign) ?? 0) + s.costChf);
        byTerm.set(s.term, m);
      }
      const cannibalization = [...byTerm.entries()]
        .filter(([, m]) => m.size > 1)
        .map(([term, m]) => ({
          term,
          campaigns: [...m.entries()].map(([campaign, costChf]) => ({ campaign, costChf: r2(costChf) })).sort((a, b) => b.costChf - a.costChf),
        }))
        .sort((a, b) => b.campaigns.reduce((s, c) => s + c.costChf, 0) - a.campaigns.reduce((s, c) => s + c.costChf, 0))
        .slice(0, 10);

      data.multiWindow = {
        campaigns, removedLifetime, monthlySeries, keywordsTop, pauseCandidates, cannibalization, geoL90, deviceL90,
        strategyChanges, strategyPeriods,
      };
    });

    // ── Struktur-Review (report-only): 4 weitere Quellen ─────────────────────
    // 6) Ad-Group-Performance (alle Typen, Top 100 nach Kosten)
    await soft("adgroup_performance", async () => {
      const rows = await search(
        ctx,
        `SELECT campaign.name, ad_group.name, metrics.cost_micros, metrics.conversions, metrics.conversions_value
         FROM ad_group WHERE segments.date DURING LAST_30_DAYS AND ad_group.status = 'ENABLED'
         ORDER BY metrics.cost_micros DESC LIMIT 100`,
      );
      for (const r of rows) {
        data.adGroupPerformance.push({
          campaign: r.campaign?.name ?? "",
          adGroup: r.adGroup?.name ?? "",
          costChf: Number(r.metrics?.costMicros ?? 0) / MICROS,
          conversions: Number(r.metrics?.conversions ?? 0),
          convValue: Number(r.metrics?.conversionsValue ?? 0),
        });
      }
    });

    // 7) Keyword-Bestand + Quality Score (Top 200 nach Kosten)
    await soft("keyword_quality", async () => {
      const rows = await search(
        ctx,
        `SELECT campaign.name, ad_group.name, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
                ad_group_criterion.quality_info.quality_score,
                ad_group_criterion.quality_info.search_predicted_ctr,
                ad_group_criterion.quality_info.creative_quality_score,
                ad_group_criterion.quality_info.post_click_quality_score,
                metrics.cost_micros, metrics.conversions
         FROM keyword_view WHERE segments.date DURING LAST_30_DAYS AND ad_group_criterion.status = 'ENABLED'
         ORDER BY metrics.cost_micros DESC LIMIT 200`,
      );
      for (const r of rows) {
        const qi = r.adGroupCriterion?.qualityInfo ?? {};
        data.keywordQuality.push({
          campaign: r.campaign?.name ?? "",
          adGroup: r.adGroup?.name ?? "",
          keyword: String(r.adGroupCriterion?.keyword?.text ?? ""),
          matchType: String(r.adGroupCriterion?.keyword?.matchType ?? ""),
          qualityScore: qi.qualityScore != null ? Number(qi.qualityScore) : null,
          expectedCtr: String(qi.searchPredictedCtr ?? "UNKNOWN"),
          adRelevance: String(qi.creativeQualityScore ?? "UNKNOWN"),
          landingPageExperience: String(qi.postClickQualityScore ?? "UNKNOWN"),
          costChf: Number(r.metrics?.costMicros ?? 0) / MICROS,
          conversions: Number(r.metrics?.conversions ?? 0),
        });
      }
    });

    // 8) Monat vs. Vormonat je Kampagne (Tag -30..-1 vs. -60..-31, ALLE Typen)
    await soft("month_comparison", async () => {
      const q = (from: string, to: string) =>
        `SELECT campaign.name, campaign.advertising_channel_type, metrics.cost_micros, metrics.conversions, metrics.conversions_value
         FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}' AND campaign.status = 'ENABLED'`;
      const cur = await search(ctx, q(daysAgo(30), daysAgo(1)));
      const prev = await search(ctx, q(daysAgo(60), daysAgo(31)));
      type M = { channelType: string; cost: number; conv: number; value: number };
      const agg = (rows: Array<Record<string, any>>) => {
        const m = new Map<string, M>();
        for (const r of rows) {
          const name = r.campaign?.name ?? "";
          const a = m.get(name) ?? { channelType: String(r.campaign?.advertisingChannelType ?? "UNKNOWN"), cost: 0, conv: 0, value: 0 };
          a.cost += Number(r.metrics?.costMicros ?? 0) / MICROS;
          a.conv += Number(r.metrics?.conversions ?? 0);
          a.value += Number(r.metrics?.conversionsValue ?? 0);
          m.set(name, a);
        }
        return m;
      };
      const curM = agg(cur);
      const prevM = agg(prev);
      const names = new Set([...curM.keys(), ...prevM.keys()]);
      for (const name of names) {
        const c = curM.get(name) ?? { channelType: prevM.get(name)!.channelType, cost: 0, conv: 0, value: 0 };
        const p = prevM.get(name) ?? { channelType: c.channelType, cost: 0, conv: 0, value: 0 };
        data.monthComparison.push({
          campaign: name,
          channelType: c.channelType,
          cost: Math.round(c.cost * 100) / 100, costPrev: Math.round(p.cost * 100) / 100,
          conversions: c.conv, conversionsPrev: p.conv,
          convValue: Math.round(c.value * 100) / 100, convValuePrev: Math.round(p.value * 100) / 100,
          roas: c.cost > 0 ? c.value / c.cost : null,
          roasPrev: p.cost > 0 ? p.value / p.cost : null,
        });
      }
      data.monthComparison.sort((a, b) => b.cost - a.cost);
    });

    // 9) PMax-Suchthemen-Insights (Kategorie-Ebene). Die API verlangt einen
    //    campaign_id-Filter je Abfrage -> erst PMax-Kampagnen holen, dann je
    //    Kampagne (max. 5, nach Status) die Insight-Kategorien.
    await soft("pmax_search_themes", async () => {
      const pmax = await search(
        ctx,
        `SELECT campaign.id, campaign.name FROM campaign
         WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX' AND campaign.status = 'ENABLED' LIMIT 5`,
      );
      for (const c of pmax) {
        const campId = c.campaign?.id;
        const campName = c.campaign?.name ?? "";
        if (!campId) continue;
        const rows = await search(
          ctx,
          `SELECT campaign_search_term_insight.category_label,
                  metrics.clicks, metrics.impressions, metrics.conversions
           FROM campaign_search_term_insight
           WHERE segments.date DURING LAST_30_DAYS
             AND campaign_search_term_insight.campaign_id = ${Number(campId)}
           ORDER BY metrics.clicks DESC LIMIT 10`,
        );
        for (const r of rows) {
          data.pmaxSearchThemes.push({
            campaign: campName,
            category: String(r.campaignSearchTermInsight?.categoryLabel ?? ""),
            clicks: Number(r.metrics?.clicks ?? 0),
            impressions: Number(r.metrics?.impressions ?? 0),
            conversions: Number(r.metrics?.conversions ?? 0),
          });
        }
      }
    });

    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Phase 3.2: deterministische Anomalie-Findings (report-only, pure) ────────
export function computeGeoDeviceFindings(data: AutopilotData): PlannedAction[] {
  const out: PlannedAction[] = [];
  const acctCpa = data.meta.avgCpaChf;
  if (!acctCpa || acctCpa <= 0) return out;

  // Geo: Abweichung > 30% vom Konto-CPA bei >= 5 Conversions (plus reine Kostenfresser)
  for (const g of data.geoPerformance) {
    if (g.conversions >= 5) {
      const cpa = g.costChf / g.conversions;
      const dev = (cpa - acctCpa) / acctCpa;
      if (Math.abs(dev) > 0.3) {
        out.push({
          actionClass: "report-only",
          type: "geo_anomaly",
          entity: g.location,
          before: "",
          after: "",
          rationale:
            `In der Region "${g.location}" kostet eine Conversion CHF ${cpa.toFixed(2)} - das sind ${dev > 0 ? "+" : ""}${(dev * 100).toFixed(0)}% gegenueber dem Konto-Schnitt von CHF ${acctCpa.toFixed(2)} (Basis: ${g.conversions.toFixed(0)} Conv./30d). ` +
            (dev > 0
              ? `Die Region ist ueberdurchschnittlich teuer - Gebotsanpassung oder Ausschluss pruefen.`
              : `Die Region ist ueberdurchschnittlich guenstig - hier liegt ungenutztes Potenzial (Gebot/Budget verstaerken).`),
          recommendation: dev > 0
            ? `Standort-Gebotsanpassung fuer "${g.location}" um -15 bis -30% setzen (Kampagnen-Einstellungen > Standorte) und den CPA nach 30 Tagen erneut pruefen; bleibt er ueber +50% zum Konto-Schnitt, Region ausschliessen.`
            : `Standort-Gebotsanpassung fuer "${g.location}" um +10 bis +20% testen - guenstige Conversions abschoepfen, nach 30 Tagen CPA gegenpruefen.`,
        });
      }
    } else if (g.conversions === 0 && g.costChf > 3 * acctCpa) {
      out.push({
        actionClass: "report-only",
        type: "geo_anomaly",
        entity: g.location,
        before: "",
        after: "",
        rationale:
          `Die Region "${g.location}" hat in 30 Tagen CHF ${g.costChf.toFixed(2)} gekostet, ohne eine einzige Conversion zu bringen - ` +
          `das ist Werbebudget ohne Gegenwert (Streuverlust). Pruefen, ob die Region bewusst beworben wird (Geo-Targeting), sonst ausschliessen.`,
        recommendation:
          `"${g.location}" aus dem Geo-Targeting der betroffenen Kampagnen nehmen (Einstellungen > Standorte), sofern keine bewusste Markterschliessung laeuft - spart ~CHF ${g.costChf.toFixed(0)}/30d ohne Buchungsverlust.`,
      });
    }
  }

  // Geraete: je Geraetetyp ueber alle Kampagnen aggregiert, gleiche Schwellen
  const dev = new Map<string, { cost: number; conv: number }>();
  for (const d of data.devicePerformance) {
    const a = dev.get(d.device) ?? { cost: 0, conv: 0 };
    a.cost += d.costChf;
    a.conv += d.conversions;
    dev.set(d.device, a);
  }
  for (const [device, a] of dev) {
    if (a.conv < 5) continue;
    const cpa = a.cost / a.conv;
    const rel = (cpa - acctCpa) / acctCpa;
    if (Math.abs(rel) > 0.3) {
      out.push({
        actionClass: "report-only",
        type: "device_anomaly",
        entity: device,
        before: "",
        after: "",
        rationale:
          `Auf Geraetetyp ${device} kostet eine Conversion CHF ${cpa.toFixed(2)} - ${rel > 0 ? "+" : ""}${(rel * 100).toFixed(0)}% gegenueber dem Konto-Schnitt von CHF ${acctCpa.toFixed(2)} (Basis: ${a.conv.toFixed(0)} Conv./30d). ` +
          (rel > 0
            ? `Nutzer auf diesem Geraet konvertieren deutlich teurer${device === "MOBILE" ? " - haeufigste Ursache ist eine langsame oder unbequeme mobile Website (Mobile-Landing pruefen)" : " - Gebotsanpassung pruefen"}.`
            : `Nutzer auf diesem Geraet konvertieren deutlich guenstiger - Potenzial fuer staerkere Gebote.`),
        recommendation: rel > 0
          ? (device === "MOBILE"
              ? `Zuerst die mobile Landingpage beschleunigen (Ladezeit/LCP - groesster Hebel), parallel mobile Gebotsanpassung -10 bis -20% testen; nach 30 Tagen CPA erneut pruefen.`
              : `Gebotsanpassung fuer ${device} um -10 bis -20% testen (Kampagnen-Einstellungen > Geraete), nach 30 Tagen CPA erneut pruefen.`)
          : `Gebotsanpassung fuer ${device} um +10 bis +20% testen - das Geraet liefert guenstige Conversions.`,
      });
    }
  }

  // Asset-Schwaechen (aggregiert je Ad-Group)
  const weak = new Map<string, number>();
  for (const a of data.assetIssues) weak.set(a.adGroup, (weak.get(a.adGroup) ?? 0) + 1);
  for (const [ag, n] of weak) {
    if (n >= 2) {
      out.push({
        actionClass: "report-only",
        type: "asset_weakness",
        entity: ag,
        before: "",
        after: "",
        rationale:
          `Google bewertet ${n} Anzeigen-Bausteine (Titel/Beschreibungen) in "${ag}" mit der schlechtesten Stufe LOW. ` +
          `Schwache Bausteine druecken die Anzeigenqualitaet und damit die Auslieferung - Kandidat fuer Copy-Refresh (Input fuer /ads plan).`,
        recommendation:
          `Die ${n} LOW-Bausteine in "${ag}" ersetzen: neue Titel/Beschreibungen mit konkretem Angebot/USP (z.B. Direktbuchungs-Vorteil, Lage, Familienangebot) formulieren und die schwaechsten zuerst austauschen - Google testet neue Varianten automatisch.`,
      });
    }
  }
  return out;
}

// ── Struktur-Review: deterministische Findings (report-only, pure) ───────────
// Speist die "Strategischen Beobachtungen" - Vorschlaege, keine Writes.
export function computeStructureFindings(data: AutopilotData): PlannedAction[] {
  const out: PlannedAction[] = [];
  const acctCpa = data.meta.avgCpaChf;

  // 1) qs_weakness: Quality Score <= 4 mit relevanten Kosten (Top 5 nach Kosten).
  //    Komponenten nennen, damit die Empfehlung konkret ist (Anzeige vs. Landingpage).
  const weakQs = data.keywordQuality
    .filter((k) => k.qualityScore != null && k.qualityScore <= 4 && k.costChf > 0)
    .sort((a, b) => b.costChf - a.costChf)
    .slice(0, 5);
  for (const k of weakQs) {
    const parts: string[] = [];
    if (k.adRelevance === "BELOW_AVERAGE") parts.push("Ad Relevance unterdurchschnittlich");
    if (k.expectedCtr === "BELOW_AVERAGE") parts.push("Expected CTR unterdurchschnittlich");
    if (k.landingPageExperience === "BELOW_AVERAGE") parts.push("Landing Page unterdurchschnittlich");
    out.push({
      actionClass: "report-only",
      type: "qs_weakness",
      entity: `${k.campaign} | ${k.adGroup} | ${k.keyword}`,
      before: "",
      after: "",
      rationale:
        `Keyword "${k.keyword}" (${k.matchType}): Quality Score ${k.qualityScore}/10 bei CHF ${k.costChf.toFixed(2)}/30d` +
        (parts.length ? ` - Hebel: ${parts.join(", ")}` : "") +
        ` - QS-Verbesserung senkt den CPC direkt (ROAS-Hebel ohne Mehrbudget)`,
      recommendation: (() => {
        const todo: string[] = [];
        if (k.landingPageExperience === "BELOW_AVERAGE") todo.push(`die Zielseite inhaltlich auf "${k.keyword}" ausrichten (Begriff prominent aufnehmen, Ladezeit pruefen)`);
        if (k.adRelevance === "BELOW_AVERAGE") todo.push(`den Anzeigentext der Ad-Group "${k.adGroup}" naeher ans Keyword bringen (Begriff in Titel/Beschreibung)`);
        if (k.expectedCtr === "BELOW_AVERAGE") todo.push(`Titel/CTA schaerfen (konkreter Nutzen statt generischer Aussage)`);
        return (todo.length ? `Zuerst ${todo.join("; danach ")}.` : `Anzeigentext und Zielseite auf das Keyword ausrichten.`) + ` Ziel: QS >= 6 - jeder Punkt senkt den Klickpreis spuerbar.`;
      })(),
    });
  }

  // 2) adgroup_anomaly: CPA-Ausreisser je Ad-Group (>30% vs Konto-CPA bei >=5 Conv.)
  //    plus reine Kostenfresser (0 Conv., Kosten > 3x Konto-CPA).
  if (acctCpa && acctCpa > 0) {
    for (const g of data.adGroupPerformance) {
      if (g.conversions >= 5) {
        const cpa = g.costChf / g.conversions;
        const dev = (cpa - acctCpa) / acctCpa;
        if (dev > 0.3) {
          out.push({
            actionClass: "report-only",
            type: "adgroup_anomaly",
            entity: `${g.campaign} | ${g.adGroup}`,
            before: "",
            after: "",
            rationale: `Ad-Group "${g.adGroup}": CPA CHF ${cpa.toFixed(2)} (+${(dev * 100).toFixed(0)}% vs Konto-CPA ${acctCpa.toFixed(2)}) bei ${g.conversions.toFixed(0)} Conv./30d - Split/Ausschluss oder Gebots-Review pruefen`,
            recommendation:
              `NICHT pausieren (die Gruppe bringt Buchungen). Stattdessen: Suchbegriffsbericht der Ad-Group durchgehen und unpassende Begriffe ausschliessen; bleibt der CPA danach hoch, Gebot ca. -15% absenken. Re-Check in 3 Wochen.`,
          });
        }
      } else if (g.conversions === 0 && g.costChf > 3 * acctCpa) {
        out.push({
          actionClass: "report-only",
          type: "adgroup_anomaly",
          entity: `${g.campaign} | ${g.adGroup}`,
          before: "",
          after: "",
          rationale: `Ad-Group "${g.adGroup}": CHF ${g.costChf.toFixed(2)} ohne Conversions (30d) - Relevanz/Suchbegriffe pruefen`,
          recommendation:
            `Suchbegriffsbericht pruefen: unpassende Suchanfragen ausschliessen und zu breite Keywords auf Phrase/Exact verengen. Bringt die Gruppe danach weiterhin keine Buchung, Pausierung erwaegen - das Budget arbeitet in den konvertierenden Gruppen besser.`,
        });
      }
    }
  }

  // 3) mom_regression: ROAS-Einbruch > 20% ggue. Vormonat (nur belastbare Basis:
  //    Vormonat >= 5 Conv.). Alle Kampagnentypen (Search, PMax, Display, ...).
  for (const m of data.monthComparison) {
    if (m.conversionsPrev < 5) continue;
    if (m.roasPrev != null && m.roasPrev > 0 && m.roas != null) {
      const delta = (m.roas - m.roasPrev) / m.roasPrev;
      if (delta <= -0.2) {
        out.push({
          actionClass: "report-only",
          type: "mom_regression",
          entity: m.campaign,
          before: `ROAS ${m.roasPrev.toFixed(1)} (Vormonat)`,
          after: `ROAS ${m.roas.toFixed(1)}`,
          rationale:
            `${m.campaign} (${m.channelType}): ROAS ${m.roasPrev.toFixed(1)} -> ${m.roas.toFixed(1)} (${(delta * 100).toFixed(0)}%), ` +
            `Kosten CHF ${m.costPrev.toFixed(0)} -> ${m.cost.toFixed(0)}, Conv. ${m.conversionsPrev.toFixed(0)} -> ${m.conversions.toFixed(0)} - Ursache pruefen (Aenderungsverlauf, Saison, Wettbewerb)`,
          recommendation:
            `Erst Ursache klaeren, dann handeln: (1) Aenderungsverlauf um den Einbruch pruefen (wer hat was geaendert?), (2) Saison-/Nachfrage-Effekt gegenpruefen, (3) danach gezielt gegensteuern (Gebote/Budget/Assets) - nicht vorschnell umbauen, sonst ist die Ursache nicht mehr messbar.`,
        });
      }
    } else if (m.roasPrev != null && m.roasPrev > 0 && (m.roas == null || m.cost === 0)) {
      out.push({
        actionClass: "report-only",
        type: "mom_regression",
        entity: m.campaign,
        before: `aktiv (Vormonat: CHF ${m.costPrev.toFixed(0)}, ROAS ${m.roasPrev.toFixed(1)})`,
        after: "kein Spend im aktuellen 30d-Fenster",
        rationale: `${m.campaign} (${m.channelType}): lief im Vormonat (CHF ${m.costPrev.toFixed(0)}, ${m.conversionsPrev.toFixed(0)} Conv.), aktuell ohne Spend - pausiert oder budgetlos? Aenderungsverlauf pruefen`,
        recommendation:
          `Klaeren, ob die Kampagne bewusst gestoppt wurde (Aenderungsverlauf). Falls nicht: Status/Budget wiederherstellen - im Vormonat hat sie mit ROAS ${m.roasPrev != null ? m.roasPrev.toFixed(1) : "?"} geliefert.`,
      });
    }
  }

  return out;
}

// Hotel: OTA-Druck auf Brand-Kampagnen quantifizieren (Playbook-Pflicht-KPI)
const OTA_DOMAINS = ["booking.com", "expedia", "hotels.com", "trivago", "agoda", "hrs.", "ebookers"];
export function computeBrandOtaFindings(data: AutopilotData, cfg: AutopilotConfig): PlannedAction[] {
  if (cfg.industry !== "hotel") return [];
  const out: PlannedAction[] = [];
  // "Brand", aber nicht "Non-Brand" (sonst false positives auf Non-Brand-Kampagnen)
  const isBrand = (name: string) => /brand/i.test(name) && !/non[-_ ]?brand/i.test(name);

  // Playbook-Pflicht-KPI Brand-IS < 90% - aus den OEFFENTLICHEN IS-Metriken
  // (die auction_insight_*-Metriken sind API-seitig nicht verfuegbar, Allowlist
  // geschlossen; Konkurrenz-Detail nur in der Ads-UI unter Insights > Auktionsdaten).
  for (const c of data.campaigns) {
    if (!isBrand(c.name)) continue;
    const is = c.searchImpressionShare ?? null;
    if (is == null || is >= 0.9) continue;
    const absTop = c.searchAbsTopImpressionShare ?? null;
    // IS-Verlust-Aufteilung: sagt dem Leser, OB der Hebel Budget oder Gebot/Qualitaet ist.
    const budgetPct = Math.round(c.budgetLostIs * 100);
    const rankPct = c.rankLostIs != null ? Math.round(c.rankLostIs * 100) : null;
    let split = "";
    if (rankPct != null) {
      split =
        ` Vom fehlenden Anteil gehen ${budgetPct} Prozentpunkte auf ein zu knappes Budget (Anzeige pausiert, sobald das Tagesbudget aufgebraucht ist) ` +
        `und ${rankPct} Prozentpunkte auf einen zu tiefen Rang (Gebot/Anzeigenqualitaet) - der Hebel ist hier also ` +
        (budgetPct > rankPct ? `das Budget.` : rankPct > budgetPct ? `Gebot/Qualitaet, nicht mehr Budget.` : `beides gleichermassen.`);
    }
    out.push({
      actionClass: "report-only",
      type: "brand_is_alert",
      entity: c.name,
      before: "",
      after: "",
      rationale:
        `Die eigene Marken-Kampagne "${c.name}" erscheint nur bei ${(is * 100).toFixed(0)}% der Suchen nach der eigenen Marke ` +
        `(Impression Share ${(is * 100).toFixed(0)}%, Playbook-Schwelle 90%)` +
        (absTop != null ? ` und steht nur in ${(absTop * 100).toFixed(0)}% ganz oben (Absolute Top)` : "") +
        `.${split} Jede verpasste Marken-Suche kann bei einem Buchungsportal landen und kostet dann Kommission. ` +
        `Wer verdraengt, zeigt die Ads-UI unter Insights > Auktionsdaten (via API nicht verfuegbar).`,
      recommendation:
        rankPct != null && rankPct > budgetPct
          ? `Hebel Gebot/Qualitaet: Gebote der Brand-Keywords leicht anheben und Anzeigen mit Markenname + Direktbuchungs-Vorteil (Bestpreis) staerken - mehr Budget allein schliesst die Luecke hier nicht (nur ${budgetPct}pp Budget-Verlust).`
          : `Hebel Budget: Tagesbudget der Kampagne "${c.name}" anheben (${budgetPct} Prozentpunkte der verpassten Marken-Suchen gehen aufs Budget) - der zugehoerige Budget-Vorschlag liegt jeweils in der Freigabe-Queue.`,
    });
  }

  const brandRows = data.auctionInsights.filter((a) => isBrand(a.campaign));
  const otas = brandRows.filter((a) => OTA_DOMAINS.some((o) => a.domain.includes(o)));
  for (const o of otas.slice(0, 5)) {
    out.push({
      actionClass: "report-only",
      type: "brand_ota_pressure",
      entity: `${o.campaign} vs ${o.domain}`,
      before: "",
      after: "",
      rationale:
        `Das Buchungsportal "${o.domain}" bietet auf die eigenen Marken-Suchanfragen mit: Es erscheint in ${o.overlapRate != null ? (o.overlapRate * 100).toFixed(0) + "%" : "n/a"} derselben Auktionen (Overlap ${o.overlapRate != null ? (o.overlapRate * 100).toFixed(0) + "%" : "n/a"}) ` +
        `und steht in ${o.outrankingShare != null ? (o.outrankingShare * 100).toFixed(0) + "%" : "n/a"} davon ueber der eigenen Anzeige (Outranking). ` +
        `Jeder Gast, der so beim Portal statt direkt bucht, kostet spaeter Kommission - Brand-Sichtbarkeit verteidigen lohnt sich doppelt.`,
      recommendation:
        `Brand verteidigen: eigene Marken-Keywords exakt (Exact Match) abdecken, Sitelinks/Erweiterungen ausbauen und den Direktbuchungs-Vorteil (Bestpreis, flexible Storno) prominent in den Anzeigentext nehmen.`,
    });
  }
  return out;
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
// ── Phase A: Mehrfenster-Typen ───────────────────────────────────────────────
export type WindowMetrics = {
  costChf: number;
  conversions: number;
  conversionValue: number;
  roas: number | null;
  cpaChf: number | null;
};

export type MultiWindowExtract = {
  // alle Kampagnen ENABLED+PAUSED (pausierte mit Historie gehoeren zur Analyse)
  campaigns: Array<{
    campaign: string;
    status: string;
    channelType: string;
    L90: WindowMetrics;
    L365: WindowMetrics;
    LIFETIME: WindowMetrics;
  }>;
  // REMOVED-Kampagnen nur als LIFETIME-Summe (Kontext Gesamtinvestition)
  removedLifetime: { campaigns: number } & WindowMetrics;
  // Konto-Ebene, 12 Monate (Saisonmuster; YoY sofern Historie vorhanden)
  monthlySeries: Array<{ month: string; costChf: number; conversions: number }>;
  // Top-Keywords nach LIFETIME-Kosten (Streichkandidaten-Basis Phase B.3)
  keywordsTop: Array<{
    campaign: string; adGroup: string; keyword: string;
    L90: { costChf: number; conversions: number };
    LIFETIME: { costChf: number; conversions: number };
  }>;
  geoL90: Array<{ location: string; costChf: number; conversions: number }>;
  deviceL90: Array<{ device: string; costChf: number; conversions: number }>;
  // Phase B.3: haerteste Streichkandidaten - LIFETIME-Kosten > 3x Ziel-CPA und
  // 0 Conversions ueber alle Fenster (Empfehlung keyword_pause, nie Write)
  pauseCandidates?: Array<{ campaign: string; adGroup: string; keyword: string; lifetimeCostChf: number }>;
  // Phase B.3: Kannibalisierung - gleicher Suchbegriff laeuft in mehreren Kampagnen
  cannibalization?: Array<{ term: string; campaigns: Array<{ campaign: string; costChf: number }> }>;
  // erkannte Gebotsstrategie-Wechsel (persistiert in ads_change_events - waechst
  // ueber die 29-Tage-API-Grenze hinaus; Quelle des Perioden-Splits)
  strategyChanges: Array<{ campaign: string; at: string; fields: string }>;
  // L90 je Periode getrennt ausgewertet (nie ueber den Wechsel hinweg gemittelt)
  strategyPeriods: Array<{
    campaign: string; changedAt: string;
    before: WindowMetrics & { days: number };
    after: WindowMetrics & { days: number };
  }>;
};

export function windowMetrics(costChf: number, conversions: number, conversionValue: number): WindowMetrics {
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    costChf: r(costChf),
    conversions: r(conversions),
    conversionValue: r(conversionValue),
    roas: costChf > 0 ? r(conversionValue / costChf) : null,
    cpaChf: conversions > 0 ? r(costChf / conversions) : null,
  };
}

// Gebotsstrategie-Wechsel aus der Aenderungshistorie erkennen (pure, testbar).
// change_event reicht max. 30 Tage zurueck - aeltere Wechsel sind nicht
// rekonstruierbar (Brief A.2: "soweit rekonstruierbar").
const BIDDING_FIELDS_RE = /bidding|target_roas|target_cpa|maximize_conversion|manual_cpc|target_impression_share/i;
export function detectStrategyChanges(
  changeHistory: Array<{ at: string; resourceType: string; fields: string; campaignRef?: string }>,
  idToName: Map<string, string>,
): Array<{ campaign: string; at: string; fields: string }> {
  const seen = new Set<string>();
  const out: Array<{ campaign: string; at: string; fields: string }> = [];
  for (const c of changeHistory) {
    if (c.resourceType !== "CAMPAIGN" || !BIDDING_FIELDS_RE.test(c.fields)) continue;
    const id = String(c.campaignRef ?? "").split("/").pop() ?? "";
    const campaign = idToName.get(id);
    if (!campaign || seen.has(campaign)) continue; // juengster Wechsel je Kampagne (Liste ist DESC)
    seen.add(campaign);
    out.push({ campaign, at: c.at, fields: c.fields });
  }
  return out;
}

// Datumsfenster fuer die Perioden-Trennung um einen Strategiewechsel (pure).
export function periodRanges(
  changedAt: string,
  today: string,
  windowDays = 90,
): { before: { from: string; to: string; days: number }; after: { from: string; to: string; days: number } } | null {
  const changeDate = changedAt.slice(0, 10);
  const d = (s: string) => new Date(s + "T00:00:00Z").getTime();
  const day = 86400000;
  const from = new Date(d(today) - windowDays * day).toISOString().slice(0, 10);
  const beforeTo = new Date(d(changeDate) - day).toISOString().slice(0, 10);
  if (d(beforeTo) < d(from) || d(changeDate) > d(today)) return null; // Wechsel liegt ausserhalb des Fensters
  return {
    before: { from, to: beforeTo, days: Math.round((d(beforeTo) - d(from)) / day) + 1 },
    after: { from: changeDate, to: today, days: Math.round((d(today) - d(changeDate)) / day) + 1 },
  };
}

export type PlannedAction = {
  actionClass: "auto-execute" | "approval-needed" | "report-only";
  type: string;
  entity: string;
  before: string;
  after: string;
  rationale: string;
  recommendation?: string; // Befunde: konkrete Empfehlungs-Massnahme fuer den Menschen
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
          rationale:
            `Konflikt: "${t.term}" kostet in dieser Kampagne CHF ${t.costChf.toFixed(2)} ohne Conversion, bringt aber in der Kampagne "${convElsewhere}" nachweislich Conversions. ` +
            `Ein Ausschluss wuerde dort funktionierende Anfragen blockieren - der Vorschlag wurde deshalb verworfen. Besser: Kampagnen-Zuordnung des Begriffs pruefen.`,
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
          `Der Suchbegriff "${t.term}" hat im Auswertungsfenster ${winNote} CHF ${t.costChf.toFixed(2)} gekostet, ohne eine einzige Conversion zu bringen - ` +
          `mehr als das 3-fache dessen, was eine Conversion kosten darf (Ziel-CPA CHF ${refCpa.toFixed(2)}). ` +
          `Der exakte Ausschluss stoppt diese wiederkehrende Verschwendung, ohne andere Suchanfragen zu beruehren.` +
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
        rationale:
          `Das Wortmuster "${g}" taucht in ${a.terms.size} verschiedenen Suchbegriffen auf, die zusammen CHF ${a.cost.toFixed(2)} gekostet haben - ohne eine einzige Conversion im Fenster ${winNote} ` +
          `(mehr als das 2-fache des Ziel-CPA CHF ${refCpa.toFixed(2)}). Ein Phrase-Ausschluss unterbindet das gesamte Muster statt jedes Einzelbegriffs - darum Freigabe noetig: er wirkt breiter als ein exakter Ausschluss.`,
        estimatedImpact: `Vermeidet wiederkehrende Verschwendung des Musters (CHF ~${a.cost.toFixed(0)}/30d)`,
        exec: { kind: "negative", campaign: a.campaign, term: g },
      });
      phraseCount += 1;
    }
  }

  // Rule 2 — Budget: budgetlimitiert (IS Lost >= 20%) UND statistische Mindestbasis
  // (conversions >= min_conversions_for_budget_rec) UND belegter Return.
  // Phase 0.1: EXPLIZITE Ziel-Pruefkette, keine stille Degradierung:
  //   target_roas gesetzt -> ROAS-Pruefung (roas >= target_roas)
  //   sonst target_cpa    -> CPA-Pruefung (Kampagnen-CPA <= target_cpa; deckt
  //                          Lead-Tracking ohne Conversion-Wert ab, ROAS zeigt dort 0.0)
  //   sonst               -> report-only "kein Ziel definiert" (nie approval)
  const targetRoas = cfg.target_roas ?? null;
  const targetCpa = cfg.target_cpa_chf ?? null;
  const minConv = cfg.min_conversions_for_budget_rec ?? 5;
  for (const c of data.campaigns) {
    if (noTouch.has(c.name)) continue;
    if (c.budgetLostIs < 0.2 || c.conversions < minConv) continue;
    const proposed = Math.round(c.dailyBudgetChf * 1.1 * 100) / 100; // Vorschlag +10% (Hardlimit/Run)
    // Phase 1.5: In der Nebensaison basieren die 30d-Daten evtl. auf der Hauptsaison
    // -> Pflicht-Annotation, nie auto-execute (Budget ist ohnehin approval-needed).
    const seasonNote =
      season?.kind === "low"
        ? " [Nebensaison " + season.window + ": basiert auf Hauptsaison-Daten - pruefen]"
        : "";
    const learningNote = learningCampaigns.has(c.name) ? " [Learning Phase aktiv]" : "";
    const baseNote = `${c.conversions.toFixed(0)} Conv./30d (Mindestbasis ${minConv})` + seasonNote + learningNote;

    // Beobachtung in Klartext: was heisst "IS Lost (Budget)" konkret?
    const limitNote =
      `Die Kampagne verliert ${(c.budgetLostIs * 100).toFixed(0)}% der moeglichen Impressionen, ` +
      `weil das Tagesbudget frueher ausgeschoepft ist als die Nachfrage (Impression Share Lost Budget ${(c.budgetLostIs * 100).toFixed(0)}%).`;

    let evidence: string | null = null; // gesetzt = Ziel erfuellt -> Vorschlag
    if (targetRoas != null) {
      if (c.roas != null && c.roas >= targetRoas)
        evidence =
          `Gleichzeitig ist sie nachweislich rentabel: ROAS ${c.roas.toFixed(1)} >= Ziel ${targetRoas} ` +
          `(pro Werbefranken kommen CHF ${c.roas.toFixed(1)} Umsatz zurueck).`;
    } else if (targetCpa != null && targetCpa > 0) {
      const cpa = c.costChf / c.conversions; // conversions >= minConv > 0
      if (cpa <= targetCpa)
        evidence =
          `Gleichzeitig ist sie nachweislich rentabel: CPA CHF ${cpa.toFixed(2)} <= Ziel-CPA CHF ${targetCpa.toFixed(2)} ` +
          `(eine Conversion kostet weniger, als sie kosten darf; gilt auch ohne Umsatz-Tracking, ROAS zeigt dort 0.0).`;
    } else {
      // Fall 1 (Brief 0.1): fehlende Zielgroesse blockiert Budget-Vorschlaege.
      actions.push({
        actionClass: "report-only",
        type: "budget_change",
        entity: c.name,
        before: `CHF ${c.dailyBudgetChf.toFixed(2)}/Tag`,
        after: "",
        rationale:
          `${limitNote} Es ist aber kein Ziel definiert (target_roas/target_cpa in Config setzen) - ` +
          `ohne Wirtschaftlichkeitsziel laesst sich nicht belegen, ob mehr Budget rentiert. Deshalb nur Beobachtung, keine Budget-Empfehlung. ${baseNote}`,
      });
      continue;
    }
    if (!evidence) continue; // Ziel gesetzt, aber nicht erfuellt -> kein Vorschlag
    actions.push({
      actionClass: "approval-needed",
      type: "budget_change",
      entity: c.name,
      before: `CHF ${c.dailyBudgetChf.toFixed(2)}/Tag`,
      after: `CHF ${proposed.toFixed(2)}/Tag`,
      rationale:
        `${limitNote} ${evidence} ` +
        `Eine Erhoehung um 10% (CHF ${c.dailyBudgetChf.toFixed(2)} -> ${proposed.toFixed(2)}/Tag) erschliesst diese verlorene, rentable Nachfrage. Datenbasis: ${baseNote}`,
      estimatedImpact: "Mehr Sichtbarkeit in budgetlimitierter Kampagne",
      exec: { kind: "budget", campaign: c.name, dailyChf: proposed },
    });
  }
  return actions;
}

// ── orchestration: run for one client ───────────────────────────────────────
export type AutopilotRunSummary = {
  ok: boolean;
  runId: string;
  // Identitaets-Echo: Aufrufer MUESSEN verifizieren, dass clientId der Antwort
  // ihrer Anfrage entspricht (Lehre aus dem /tmp-Payload-Vorfall 14.07.:
  // ein Agent sendete unbemerkt die clientId eines anderen Kunden).
  clientId?: string;
  clientName?: string;
  customerId?: string;
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
  // Phase 3: kompakte Datenbloecke fuer Wochen-/Monatsreport (report-only)
  auctionInsightsTop?: Array<{ campaign: string; domain: string; overlapRate: number | null; outrankingShare: number | null }>;
  geoTop?: Array<{ location: string; costChf: number; conversions: number }>;
  deviceSplit?: Array<{ device: string; costChf: number; conversions: number }>;
  assetIssueCount?: number;
  pmaxAssetGroups?: Array<{ name: string; adStrength: string }>;
  // Asset-Qualitaets-KPIs: Ad-Strength-Verteilung der aktiven RSAs + schwaechste
  rsaAdStrength?: { distribution: Record<string, number>; weakest: Array<{ campaign: string; adGroup: string; adStrength: string }> };
  // Gebotsstrategie-Review (report-only): Typ + Ziel je Kampagne
  biddingStrategies?: Array<{ campaign: string; strategyType: string; targetRoas: number | null; targetCpaChf: number | null; systemStatus: string }>;
  // Phase A: Mehrfenster-Extrakt (Kennzahlen tragen Fenster-Label per Struktur)
  multiWindow?: MultiWindowExtract | null;
  // Phase B.2: Asset-Detail (Servings/Pinning/Abdeckung/PMax-Videos, L90)
  assetDetail?: AutopilotData["assetDetail"] | null;
  // Phase C: Report-Pflichtblock "Offene Massnahmen" aus dem Register
  openRecommendations?: Awaited<ReturnType<typeof openRecommendationsBlock>> | null;
  changeHistory?: Array<{ at: string; user: string; resourceType: string }>;
  dataSourceErrors?: string[];
  // Struktur-Review (report-only): Gesamtstruktur + MoM + QS fuer den Report
  adGroupTop?: Array<{ campaign: string; adGroup: string; costChf: number; conversions: number }>;
  qsDistribution?: { rated: number; weak: number; avg: number | null };
  monthComparison?: Array<{
    campaign: string; channelType: string;
    cost: number; costPrev: number;
    conversions: number; conversionsPrev: number;
    roas: number | null; roasPrev: number | null;
  }>;
  pmaxSearchThemes?: Array<{ campaign: string; category: string; clicks: number; conversions: number }>;
  // Phase 1.4: Waechter-Kopfzeile "Waechter (letzte 7 Tage): X ok / Y warn / Z critical"
  guardian7d?: { ok: number; warn: number; critical: number };
  // Phase 2: Kandidaten fuer semantische Negatives (Kosten > 0, 0 Conv. im
  // Lag-Fenster, NICHT von der Kostenregel erfasst; max 200 nach Kosten).
  semanticCandidates?: Array<{ term: string; campaign: string; adGroup: string; costChf: number; clicks: number }>;
  actions: Array<{ class: string; type: string; entity: string; status: string; rationale: string; recommendation?: string }>;
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
    ok: true, runId,
    clientId: client?.id ?? clientId, clientName: client?.name ?? "",
    customerId: String(client?.google_ads_customer ?? "").replace(/\D/g, ""),
    dryRun, observeOnly: cfg.observe_only, autonomyLevel: cfg.autonomy_level,
    executed: 0, queued: 0, reportOnly: 0, failed: 0, actions: [],
  };

  if (cfg.kill_switch) return { ...base, killSwitch: true, skipped: "Run uebersprungen (Kill-Switch aktiv)" };
  if (!client) return { ...base, ok: false, error: "Client not found" };

  // Phase 4: faellige Outcome-Reviews opportunistisch nachziehen (idempotent,
  // billig wenn nichts faellig; Fehler blockieren den Run nicht).
  try {
    const { runOutcomeReview } = await import("./google-ads-outcome.server");
    await runOutcomeReview(clientId);
  } catch { /* Tagesjob via /api/admin/ads-outcome-review ist der Primaertrigger */ }

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

  // Phase 3: Datenbloecke in die Summary + deterministische report-only-Findings.
  const d3 = fetched.data;
  base.auctionInsightsTop = d3.auctionInsights
    .slice(0, 10)
    .map((a) => ({ campaign: a.campaign, domain: a.domain, overlapRate: a.overlapRate, outrankingShare: a.outrankingShare }));
  base.geoTop = d3.geoPerformance.slice(0, 8).map((g) => ({ location: g.location, costChf: g.costChf, conversions: g.conversions }));
  {
    const devAgg = new Map<string, { cost: number; conv: number }>();
    for (const d of d3.devicePerformance) {
      const a = devAgg.get(d.device) ?? { cost: 0, conv: 0 };
      a.cost += d.costChf; a.conv += d.conversions;
      devAgg.set(d.device, a);
    }
    base.deviceSplit = [...devAgg.entries()].map(([device, a]) => ({ device, costChf: Math.round(a.cost * 100) / 100, conversions: a.conv }));
  }
  base.assetIssueCount = d3.assetIssues.length;
  base.pmaxAssetGroups = d3.pmaxAssetGroups;
  {
    const dist: Record<string, number> = {};
    for (const r of d3.rsaAdStrength ?? []) dist[r.adStrength] = (dist[r.adStrength] ?? 0) + 1;
    base.rsaAdStrength = {
      distribution: dist,
      weakest: (d3.rsaAdStrength ?? [])
        .filter((r) => r.adStrength === "POOR" || r.adStrength === "AVERAGE")
        .sort((a, b) => (a.adStrength === b.adStrength ? 0 : a.adStrength === "POOR" ? -1 : 1))
        .slice(0, 10),
    };
  }
  base.multiWindow = d3.multiWindow ?? null;
  base.assetDetail = d3.assetDetail ?? null;
  try {
    base.openRecommendations = await openRecommendationsBlock(clientId);
  } catch {
    base.openRecommendations = null;
  }
  base.biddingStrategies = d3.campaigns.map((c) => ({
    campaign: c.name,
    strategyType: c.biddingStrategyType ?? "UNKNOWN",
    targetRoas: c.targetRoas ?? null,
    targetCpaChf: c.targetCpaChf ?? null,
    systemStatus: c.biddingSystemStatus,
  }));
  base.changeHistory = d3.changeHistory.slice(0, 20).map((c) => ({ at: c.at, user: c.user, resourceType: c.resourceType }));
  base.dataSourceErrors = d3.dataSourceErrors;

  // Struktur-Review-Bloecke (report-only) fuer den Report.
  base.adGroupTop = d3.adGroupPerformance.slice(0, 10).map((g) => ({
    campaign: g.campaign, adGroup: g.adGroup, costChf: Math.round(g.costChf * 100) / 100, conversions: g.conversions,
  }));
  {
    const rated = d3.keywordQuality.filter((k) => k.qualityScore != null);
    base.qsDistribution = {
      rated: rated.length,
      weak: rated.filter((k) => (k.qualityScore ?? 10) <= 4).length,
      avg: rated.length ? Math.round((rated.reduce((s, k) => s + (k.qualityScore ?? 0), 0) / rated.length) * 10) / 10 : null,
    };
  }
  base.monthComparison = d3.monthComparison.slice(0, 15).map((m) => ({
    campaign: m.campaign, channelType: m.channelType,
    cost: m.cost, costPrev: m.costPrev,
    conversions: m.conversions, conversionsPrev: m.conversionsPrev,
    roas: m.roas != null ? Math.round(m.roas * 10) / 10 : null,
    roasPrev: m.roasPrev != null ? Math.round(m.roasPrev * 10) / 10 : null,
  }));
  base.pmaxSearchThemes = d3.pmaxSearchThemes.slice(0, 10).map((t) => ({
    campaign: t.campaign, category: t.category, clicks: t.clicks, conversions: t.conversions,
  }));

  // Phase 1.4: Waechter-Bilanz der letzten 7 Tage fuer den Report-Kopf.
  try {
    const since = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
    const { data: g } = await supabaseAdmin
      .from("ads_guardian_log")
      .select("status")
      .eq("client_id", clientId)
      .gte("checked_at", since);
    base.guardian7d = {
      ok: (g ?? []).filter((r) => r.status === "ok").length,
      warn: (g ?? []).filter((r) => r.status === "warn").length,
      critical: (g ?? []).filter((r) => r.status === "critical").length,
    };
  } catch { /* Tabelle fehlt/Fehler -> Kopfzeile entfaellt, Run laeuft weiter */ }

  const planned = [
    ...planActions(fetched.data, cfg),
    ...computeGeoDeviceFindings(fetched.data),
    ...computeBrandOtaFindings(fetched.data, cfg),
    ...computeStructureFindings(fetched.data),
  ];

  // Phase 2: Kandidaten fuer semantische Negatives - Begriffe mit Kosten aber
  // 0 Conversions, die die Kostenregel (Rule 1) NICHT erfasst hat (sonst
  // Doppelvorschlag). Verworfene Konflikt-Terms ebenfalls ausschliessen.
  {
    const handled = new Set<string>();
    for (const a of planned) {
      if (a.type === "add_negative" && a.exec?.kind === "negative") handled.add(normalizeTerm(a.exec.term));
      if (a.type === "negative_conflict") {
        const m = a.after.match(/"([^"]+)"/);
        if (m) handled.add(normalizeTerm(m[1]));
      }
    }
    base.semanticCandidates = fetched.data.searchTerms
      .filter((t) => t.conversions === 0 && t.costChf > 0 && !handled.has(normalizeTerm(t.term)))
      .sort((a, b) => b.costChf - a.costChf)
      .slice(0, 200)
      .map((t) => ({ term: t.term, campaign: t.campaign, adGroup: t.adGroup, costChf: Math.round(t.costChf * 100) / 100, clicks: t.clicks }));
  }

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
      // Befunde sichtbar machen: report-only ab jetzt auch ins Changelog
      // (EzyHub-Ads-Tab, Abschnitt "Befunde des letzten Laufs").
      await supabaseAdmin.from("ads_changelog").insert({
        client_id: clientId, customer_id: customerId, run_id: runId,
        action_type: a.type, action_class: a.actionClass, entity: a.entity,
        before_value: a.before, after_value: a.after, rationale: a.rationale,
        recommendation: a.recommendation ?? null,
        status: "report-only",
      });
      base.actions.push({ class: a.actionClass, type: a.type, entity: a.entity, status: "report-only", rationale: a.rationale, recommendation: a.recommendation });
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

  // decided_by ist eine uuid-Spalte (auth-User). n8n/Admin liefern oft Freitext
  // (E-Mail + Begruendung) - der landet im Text-Feld approved_by des Changelogs,
  // decided_by bleibt dann null. Vorher fuehrte Freitext zu einem 22P02-DB-Fehler,
  // der im Claim verschluckt und faelschlich als 409 already_executed gemeldet wurde.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const decidedByUuid = p.decidedBy && UUID_RE.test(p.decidedBy) ? p.decidedBy : null;
  let claimError: string | null = null;

  // Phase 0.3: Entscheidungen nur via atomarem Claim (status='pending' als Guard) -
  // parallele Doppel-Approves/Rejects fuehren genau EINMAL aus; der Verlierer
  // erhaelt 409 already_executed.
  const claim = async (newStatus: string): Promise<boolean> => {
    const { data: rows, error: claimErr } = await supabaseAdmin
      .from("ads_approvals")
      .update({ status: newStatus, decided_by: decidedByUuid, decided_at: decidedAt })
      .eq("id", appr.id)
      .eq("status", "pending")
      .select("id");
    if (claimErr) {
      claimError = claimErr.message;
      return false;
    }
    return !!rows && rows.length > 0;
  };
  const lost = (): DecideResult =>
    claimError
      ? { ok: false, httpStatus: 500, error: `Claim fehlgeschlagen: ${claimError}`, approvalId: appr.id }
      : {
          ok: false,
          httpStatus: 409,
          error: "already_executed - Approval wurde bereits parallel entschieden/ausgefuehrt",
          approvalId: appr.id,
        };

  if (p.decision === "reject") {
    if (!(await claim("rejected"))) return lost();
    if (appr.changelog_id)
      await supabaseAdmin.from("ads_changelog").update({ status: "rejected", approved_by: p.decidedBy ?? null }).eq("id", appr.changelog_id);
    return { ok: true, httpStatus: 200, status: "rejected", approvalId: appr.id };
  }

  // Phase 2.3: Kampagnen-Proposals werden NIE automatisch umgesetzt (dauerhaftes
  // Nicht-Ziel). Approve markiert nur die Freigabe; die Umsetzung erfolgt manuell
  // bzw. via Editor-Export. Kein Google-Write -> nicht durch observe_only blockiert.
  const payloadEarly = (appr.payload && typeof appr.payload === "object" ? appr.payload : {}) as Record<string, any>;
  if (appr.type === "campaign_proposal" || payloadEarly.kind === "proposal") {
    if (!(await claim("approved"))) return lost();
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

  // Phase 0.3: atomarer Claim NACH den Gates (423 laesst pending fuer spaeter),
  // aber VOR dem Google-Write - genau ein paralleler Approve fuehrt aus.
  if (!(await claim("executing"))) return lost();

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
      matchType: payload.matchType === "PHRASE" ? "PHRASE" : "EXACT",
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
