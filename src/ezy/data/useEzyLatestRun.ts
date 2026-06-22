import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const isUuid = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ""));

export type LatestRun = {
  id: string;
  audit_type: string;
  status: string;
  result: any;
  created_at: string;
} | null;

/** Latest succeeded audit_runs row of a given audit_type for a client. */
export function useEzyLatestRun(
  clientId: string | undefined,
  auditType: string,
): { run: LatestRun; loading: boolean; refresh: () => Promise<void> } {
  const [run, setRun] = useState<LatestRun>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!clientId || !isUuid(clientId)) {
      setRun(null);
      return;
    }
    setLoading(true);
    try {
      const { data } = await supabase
        .from("audit_runs")
        .select("id, audit_type, status, result, created_at")
        .eq("client_id", clientId)
        .eq("audit_type", auditType)
        .eq("status", "succeeded")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setRun((data as LatestRun) || null);
    } catch {
      setRun(null);
    } finally {
      setLoading(false);
    }
  }, [clientId, auditType]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { run, loading, refresh };
}

/** Extract SEO KPIs from an Ahrefs overview audit_runs.result. */
export function ahrefsKpisFromResult(result: any): {
  traffic: number;
  keywords: number;
  score: number;
  visibility: number;
  backlinks: number;
} {
  const r = result || {};
  // Ahrefs API nests as { domain_rating: { domain_rating: { domain_rating: 26.0, ahrefs_rank: ... } } }
  const drNode = r.domain_rating?.domain_rating ?? r.domain_rating ?? {};
  const dr =
    (typeof drNode === "number" ? drNode : drNode?.domain_rating) ??
    r.domain_rating?.domain?.domain_rating ??
    0;
  const m = r.metrics?.metrics ?? r.metrics ?? {};
  // backlinks-stats: { metrics: { all_time, all_time_refdomains, live, live_refdomains } }
  const bl = r.backlinks_stats?.metrics ?? r.backlinks_stats ?? {};
  return {
    traffic: Number(m.org_traffic ?? m.paid_traffic ?? 0) || 0,
    keywords: Number(m.org_keywords ?? m.paid_keywords ?? 0) || 0,
    score: Number(dr) || 0,
    visibility: Number(bl.live_refdomains ?? 0) || 0,
    backlinks: Number(bl.live ?? bl.all_time ?? 0) || 0,
  };
}

/**
 * Weekly referring-domains trend from an Ahrefs overview result.
 * Ahrefs refdomains-history: { refdomains: [{ date, refdomains }] }.
 */
export function ahrefsRefdomainsSeriesFromResult(
  result: any,
): Array<{ date: string; refdomains: number }> {
  const rows = result?.refdomains_history?.refdomains;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row: any) => ({
      date: String(row?.date ?? ""),
      refdomains: Number(row?.refdomains ?? 0) || 0,
    }))
    .filter((row) => row.date);
}

/**
 * Ranking distribution buckets from a gsc_summary result's topQueries[].position.
 * Reflects the imported GSC top-keywords (not the full keyword universe).
 */
export function gscRankingDistributionFromResult(
  result: any,
): Array<{ name: string; value: number }> {
  const rows = Array.isArray(result?.topQueries) ? result.topQueries : [];
  const buckets = [
    { name: "Top 3", value: 0 },
    { name: "4–10", value: 0 },
    { name: "11–20", value: 0 },
    { name: "21–50", value: 0 },
    { name: "51–100", value: 0 },
  ];
  for (const q of rows) {
    const p = Number(q?.position ?? 0);
    if (p <= 0) continue;
    if (p <= 3) buckets[0].value++;
    else if (p <= 10) buckets[1].value++;
    else if (p <= 20) buckets[2].value++;
    else if (p <= 50) buckets[3].value++;
    else buckets[4].value++;
  }
  return buckets.filter((b) => b.value > 0);
}

/** Extract Conversion KPIs from a GA4 summary audit_runs.result. */
export function ga4KpisFromResult(result: any): {
  sessions: number;
  totalUsers: number;
  newUsers: number;
  engagedSessions: number;
  screenPageViews: number;
  bounceRate: number;
  averageSessionDuration: number;
  conversions: number;
  totalRevenue: number;
  series: Array<{ date: string; sessions: number; totalUsers: number; pageViews: number }>;
} {
  const m = result?.metrics || {};
  return {
    sessions: Number(m.sessions ?? 0) || 0,
    totalUsers: Number(m.totalUsers ?? 0) || 0,
    newUsers: Number(m.newUsers ?? 0) || 0,
    engagedSessions: Number(m.engagedSessions ?? 0) || 0,
    screenPageViews: Number(m.screenPageViews ?? 0) || 0,
    bounceRate: Number(m.bounceRate ?? 0) || 0,
    averageSessionDuration: Number(m.averageSessionDuration ?? 0) || 0,
    conversions: Number(m.conversions ?? 0) || 0,
    totalRevenue: Number(m.totalRevenue ?? 0) || 0,
    series: Array.isArray(result?.series) ? result.series : [],
  };
}

/** Extract Search Console KPIs from a gsc_summary audit_runs.result. */
export function gscKpisFromResult(result: any): {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  topQueries: Array<{
    query: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }>;
} {
  const m = result?.metrics || {};
  return {
    clicks: Number(m.clicks ?? 0) || 0,
    impressions: Number(m.impressions ?? 0) || 0,
    ctr: Number(m.ctr ?? 0) || 0,
    position: Number(m.position ?? 0) || 0,
    topQueries: Array.isArray(result?.topQueries) ? result.topQueries : [],
  };
}

/** Extract Core Web Vitals from a pagespeed audit_runs.result (field data, lab fallback). */
export function pagespeedKpisFromResult(result: any): {
  lcp: number | null;
  inp: number | null;
  cls: number | null;
  performanceScore: number | null;
} {
  const m = result?.metrics || {};
  const lcp = typeof m.lcp === "number" ? m.lcp : typeof m.lcpLab === "number" ? m.lcpLab : null;
  const cls = typeof m.cls === "number" ? m.cls : typeof m.clsLab === "number" ? m.clsLab : null;
  return {
    lcp,
    inp: typeof m.inp === "number" ? m.inp : null,
    cls,
    performanceScore: typeof m.performanceScore === "number" ? m.performanceScore : null,
  };
}

/** Extract GA4 traffic-intelligence from a ga4_traffic audit_runs.result. */
export function ga4TrafficFromResult(result: any): {
  channels: Array<{ channel: string; sessions: number }>;
  aiReferral: {
    sessions: number;
    users: number;
    bySource: Array<{ source: string; sessions: number; users: number }>;
  };
  googleVsAi: { google: number; ai: number; other: number; total: number };
  aiSeries: Array<{ date: string; aiSessions: number }>;
  topPages: Array<{ path: string; views: number }>;
  countries: Array<{ country: string; sessions: number }>;
} {
  const r = result || {};
  return {
    channels: Array.isArray(r.channels) ? r.channels : [],
    aiReferral: {
      sessions: Number(r.aiReferral?.sessions ?? 0) || 0,
      users: Number(r.aiReferral?.users ?? 0) || 0,
      bySource: Array.isArray(r.aiReferral?.bySource) ? r.aiReferral.bySource : [],
    },
    googleVsAi: {
      google: Number(r.googleVsAi?.google ?? 0) || 0,
      ai: Number(r.googleVsAi?.ai ?? 0) || 0,
      other: Number(r.googleVsAi?.other ?? 0) || 0,
      total: Number(r.googleVsAi?.total ?? 0) || 0,
    },
    aiSeries: Array.isArray(r.aiSeries) ? r.aiSeries : [],
    topPages: Array.isArray(r.topPages) ? r.topPages : [],
    countries: Array.isArray(r.countries) ? r.countries : [],
  };
}

/** Extract GA4 conversion detail from a ga4_conversions audit_runs.result. */
export function ga4ConversionsFromResult(result: any): {
  breakdown: { phone: number; mail: number; maps: number; contact: number };
  events: Array<{ eventName: string; count: number }>;
  rows: Array<{
    date: string;
    eventName: string;
    description: string;
    country: string;
    source: string;
    device: string;
    count: number;
    value: number;
  }>;
  revenue: number;
  purchases: number;
  series: Array<{ date: string; conversions: number; revenue: number }>;
} {
  const r = result || {};
  const b = r.breakdown || {};
  return {
    breakdown: {
      phone: Number(b.phone ?? 0) || 0,
      mail: Number(b.mail ?? 0) || 0,
      maps: Number(b.maps ?? 0) || 0,
      contact: Number(b.contact ?? 0) || 0,
    },
    events: Array.isArray(r.events) ? r.events : [],
    rows: Array.isArray(r.rows) ? r.rows : [],
    revenue: Number(r.revenue ?? 0) || 0,
    purchases: Number(r.purchases ?? 0) || 0,
    series: Array.isArray(r.series) ? r.series : [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Visibility (Canonry) — extractors over a canonry_ai_visibility snapshot.
// Snapshot shape: { visibility, metrics, sources, contentSources, health, competitors }.
// ─────────────────────────────────────────────────────────────────────────────

export type AiVisibilityLabel = "Low" | "Medium" | "High";

/** 0–100 visibility score from Canonry health.overallCitedRate (citation rate). */
export function aiVisibilityScoreFromResult(result: any): {
  score: number;
  label: AiVisibilityLabel;
} {
  const rate =
    Number(result?.health?.overallCitedRate ?? result?.metrics?.overall?.citationRate ?? 0) || 0;
  const score = Math.round(Math.max(0, Math.min(1, rate)) * 100);
  const label: AiVisibilityLabel = score > 60 ? "High" : score >= 25 ? "Medium" : "Low";
  return { score, label };
}

/**
 * Headline KPIs with period-over-period deltas.
 * Mentions/Citations deltas come from the last two metric buckets; referenced-page
 * count has no native time series, so its delta is null (shown without a delta).
 */
export function aiVisibilityKpisFromResult(result: any): {
  mentions: number;
  citations: number;
  referencedPages: number;
  mentionsDelta: number | null;
  citationsDelta: number | null;
} {
  const overall = result?.metrics?.overall || {};
  const summary = result?.visibility?.summary || {};
  const citations =
    Number(overall.cited ?? summary.queriesCitedOnly ?? 0) +
    (overall.cited != null ? 0 : Number(summary.queriesCitedAndMentioned ?? 0));
  const mentions = Number(
    overall.mentionedCount ??
      Number(summary.queriesMentionedOnly ?? 0) + Number(summary.queriesCitedAndMentioned ?? 0),
  );
  // Referenced pages = unique own-domain grounding URIs across all queries.
  const seen = new Set<string>();
  for (const s of result?.contentSources?.sources ?? []) {
    for (const g of s?.groundingSources ?? []) {
      if (g?.isOurDomain && g?.uri) seen.add(String(g.uri));
    }
  }
  const referencedPages = seen.size;

  const pct = (cur: number, prev: number): number | null =>
    prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null;
  const buckets = Array.isArray(result?.metrics?.buckets) ? result.metrics.buckets : [];
  let citationsDelta: number | null = null;
  let mentionsDelta: number | null = null;
  if (buckets.length >= 2) {
    const last = buckets[buckets.length - 1];
    const prev = buckets[buckets.length - 2];
    citationsDelta = pct(Number(last?.cited ?? 0), Number(prev?.cited ?? 0));
    mentionsDelta = pct(Number(last?.mentionedCount ?? 0), Number(prev?.mentionedCount ?? 0));
  }
  return { mentions, citations, referencedPages, mentionsDelta, citationsDelta };
}

/** Time-series buckets normalized for charting (full window; slice client-side). */
export function aiVisibilitySeriesFromResult(
  result: any,
): Array<{ date: string; cited: number; mentioned: number; citationRate: number }> {
  const buckets = Array.isArray(result?.metrics?.buckets) ? result.metrics.buckets : [];
  return buckets
    .map((b: any) => ({
      date: String(b?.endDate ?? b?.startDate ?? ""),
      cited: Number(b?.cited ?? 0) || 0,
      mentioned: Number(b?.mentionedCount ?? 0) || 0,
      citationRate: Number(b?.citationRate ?? 0) || 0,
    }))
    .filter((b: { date: string }) => b.date);
}

/**
 * Per-LLM distribution from Canonry health.providerBreakdown
 * ({ provider: { cited, citedRate, total } }). Returns raw provider keys —
 * label via canonryProviderLabel in the component.
 */
export function aiVisibilityProvidersFromResult(
  result: any,
): Array<{ provider: string; cited: number; total: number; rate: number }> {
  const pb = result?.health?.providerBreakdown;
  if (!pb || typeof pb !== "object") return [];
  return Object.entries(pb)
    .map(([provider, v]: [string, any]) => ({
      provider,
      cited: Number(v?.cited ?? 0) || 0,
      total: Number(v?.total ?? 0) || 0,
      rate: Number(v?.citedRate ?? 0) || 0,
    }))
    .sort((a, b) => b.cited - a.cited || a.provider.localeCompare(b.provider));
}

/** Cited-source domains from Canonry analytics/sources.ranked.entries. */
export function aiVisibilitySourcesFromResult(result: any): Array<{
  domain: string;
  count: number;
  percentage: number;
  label: string;
  surfaceClass: string;
}> {
  const entries = result?.sources?.ranked?.entries;
  if (!Array.isArray(entries)) return [];
  return entries.map((e: any) => ({
    domain: String(e?.domain ?? ""),
    count: Number(e?.count ?? 0) || 0,
    percentage: Number(e?.percentage ?? 0) || 0,
    label: String(e?.label ?? e?.category ?? ""),
    surfaceClass: String(e?.surfaceClass ?? ""),
  }));
}

/**
 * Top queries (used as the "Topics" view — Canonry's unit is queries, not topics).
 * Includes a per-query Share-of-Voice: citedCount / totalProviders.
 */
export function aiVisibilityTopicsFromResult(
  result: any,
): Array<{ query: string; cited: number; mentioned: number; providers: number; sov: number }> {
  const byQuery = Array.isArray(result?.visibility?.byQuery) ? result.visibility.byQuery : [];
  return byQuery
    .map((q: any) => {
      const providers = Number(q?.totalProviders ?? 0) || 0;
      const cited = Number(q?.citedCount ?? 0) || 0;
      return {
        query: String(q?.query ?? ""),
        cited,
        mentioned: Number(q?.mentionedCount ?? 0) || 0,
        providers,
        sov: providers > 0 ? Math.round((cited / providers) * 1000) / 10 : 0,
      };
    })
    .filter((q: { query: string }) => q.query)
    .sort(
      (a: { cited: number; sov: number }, b: { cited: number; sov: number }) =>
        b.cited - a.cited || b.sov - a.sov,
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Google Ads — extractors over a google_ads snapshot.
// ─────────────────────────────────────────────────────────────────────────────

export function googleAdsFromResult(result: any): {
  totals: {
    cost: number;
    clicks: number;
    impressions: number;
    conversions: number;
    conversionValue: number;
  };
  ctr: number;
  cpc: number;
  cpa: number;
  roas: number;
  series: Array<{
    date: string;
    cost: number;
    clicks: number;
    impressions: number;
    conversions: number;
  }>;
  campaigns: Array<{
    name: string;
    status: string;
    cost: number;
    clicks: number;
    impressions: number;
    conversions: number;
    conversionValue: number;
    roas: number;
  }>;
  conversionActions: Array<{ name: string; count: number; value: number }>;
  primary: { name: string; count: number; value: number } | null;
  prev: {
    cost: number;
    clicks: number;
    impressions: number;
    conversions: number;
    conversionValue: number;
    ctr: number;
    cpc: number;
    primaryCount: number;
  };
} {
  const r = result || {};
  const t = r.totals || {};
  const p = r.prev || {};
  return {
    totals: {
      cost: Number(t.cost ?? 0) || 0,
      clicks: Number(t.clicks ?? 0) || 0,
      impressions: Number(t.impressions ?? 0) || 0,
      conversions: Number(t.conversions ?? 0) || 0,
      conversionValue: Number(t.conversionValue ?? 0) || 0,
    },
    ctr: Number(r.ctr ?? 0) || 0,
    cpc: Number(r.cpc ?? 0) || 0,
    cpa: Number(r.cpa ?? 0) || 0,
    roas: Number(r.roas ?? 0) || 0,
    series: Array.isArray(r.series) ? r.series : [],
    campaigns: Array.isArray(r.campaigns) ? r.campaigns : [],
    conversionActions: Array.isArray(r.conversionActions) ? r.conversionActions : [],
    primary: r.primary ?? null,
    prev: {
      cost: Number(p.cost ?? 0) || 0,
      clicks: Number(p.clicks ?? 0) || 0,
      impressions: Number(p.impressions ?? 0) || 0,
      conversions: Number(p.conversions ?? 0) || 0,
      conversionValue: Number(p.conversionValue ?? 0) || 0,
      ctr: Number(p.ctr ?? 0) || 0,
      cpc: Number(p.cpc ?? 0) || 0,
      primaryCount: Number(p.primaryCount ?? 0) || 0,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AWORK — extractor over an awork_tasks snapshot.
// ─────────────────────────────────────────────────────────────────────────────

export function aworkTasksFromResult(result: any): {
  project: { id: string; name: string } | null;
  projects: Array<{ id: string; name: string }>;
  statuses: Array<{ id: string; name: string; type?: string; order?: number; color?: string | null; icon?: string | null }>;
  tasklists: Array<{ id: string; name: string; order?: number; color?: string | null }>;
  tasks: Array<{
    id: string;
    name: string;
    project?: string;
    projectId?: string;
    statusId: string;
    statusName: string;
    statusType: string;
    statusColor?: string | null;
    statusIcon?: string | null;
    assignees: Array<{ id?: string; initials: string; name: string }>;
    dueOn: string | null;
    isPrio: boolean;
    listId?: string;
    list: string;
    hasSubtasks?: boolean;
    subtasksDoneCount?: number;
    subtasksCount?: number;
    trackedDuration?: number;
    plannedDuration?: number;
    commentsCount?: number;
    parentId?: string | null;
  }>;
  counts: { total: number; done: number };
  note: string | null;
} {
  const r = result || {};
  return {
    project: r.project ?? null,
    projects: Array.isArray(r.projects) ? r.projects : [],
    statuses: Array.isArray(r.statuses) ? r.statuses : [],
    tasklists: Array.isArray(r.tasklists) ? r.tasklists : [],
    tasks: Array.isArray(r.tasks) ? r.tasks : [],
    counts: { total: Number(r.counts?.total ?? 0) || 0, done: Number(r.counts?.done ?? 0) || 0 },
    note: r.note ?? null,
  };
}
