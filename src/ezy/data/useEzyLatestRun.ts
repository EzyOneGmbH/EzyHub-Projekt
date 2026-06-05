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
} {
  const r = result || {};
  // Ahrefs API nests as { domain_rating: { domain_rating: { domain_rating: 26.0, ahrefs_rank: ... } } }
  const drNode = r.domain_rating?.domain_rating ?? r.domain_rating ?? {};
  const dr =
    (typeof drNode === "number" ? drNode : drNode?.domain_rating) ??
    r.domain_rating?.domain?.domain_rating ??
    0;
  const m = r.metrics?.metrics ?? r.metrics ?? {};
  const bl = r.backlinks_stats?.metrics ?? r.backlinks_stats ?? {};
  return {
    traffic: Number(m.org_traffic ?? m.paid_traffic ?? 0) || 0,
    keywords: Number(m.org_keywords ?? m.paid_keywords ?? 0) || 0,
    score: Number(dr) || 0,
    visibility: Number(bl.live_refdomains ?? 0) || 0,
  };
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
