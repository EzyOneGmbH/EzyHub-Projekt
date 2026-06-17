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
    revenue: Number(r.revenue ?? 0) || 0,
    purchases: Number(r.purchases ?? 0) || 0,
    series: Array.isArray(r.series) ? r.series : [],
  };
}
