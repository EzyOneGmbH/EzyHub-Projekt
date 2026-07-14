import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ezyFetch } from "./api";

export type AdsApprovalRow = {
  id: string;
  client_id: string;
  run_id: string;
  action_id: string;
  type: string;
  entity: string | null;
  current_value: string | null;
  proposed_value: string | null;
  rationale: string | null;
  estimated_impact: string | null;
  status: string;
  expires_at: string | null;
  created_at: string;
};

export type AdsChangelogRow = {
  id: string;
  run_id: string;
  action_type: string;
  action_class: string;
  entity: string | null;
  before_value: string | null;
  after_value: string | null;
  rationale: string | null;
  recommendation: string | null;
  status: string;
  created_at: string;
};

export type AdsRecommendationRow = {
  id: string;
  run_id: string;
  last_seen_run: string;
  recommendation_type: string;
  entity: string;
  title: string;
  rationale: string;
  expected_impact: string | null;
  status: string;
  created_at: string;
};

export type AdsConfigRow = {
  client_id: string;
  industry: string;
  kill_switch: boolean;
  observe_only: boolean;
  autonomy_level: number;
  target_cpa_chf: number | null;
  target_roas: number | null;
  no_touch_campaigns: string[];
};

const isUuid = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ""));

/** Live Autopilot data (config + pending approvals + recent changelog) for one client. */
export function useEzyAdsAutopilot(clientId: string | undefined, limit = 30) {
  const [config, setConfig] = useState<AdsConfigRow | null>(null);
  const [approvals, setApprovals] = useState<AdsApprovalRow[]>([]);
  const [changelog, setChangelog] = useState<AdsChangelogRow[]>([]);
  const [recommendations, setRecommendations] = useState<AdsRecommendationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!clientId || !isUuid(clientId)) {
      setConfig(null);
      setApprovals([]);
      setChangelog([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [cfgRes, apprRes, logRes, recRes] = await Promise.all([
        supabase.from("ads_autopilot_config").select("*").eq("client_id", clientId).maybeSingle(),
        supabase
          .from("ads_approvals")
          .select("*")
          .eq("client_id", clientId)
          .eq("status", "pending")
          .order("created_at", { ascending: false }),
        supabase
          .from("ads_changelog")
          .select("*")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .limit(limit),
        supabase
          .from("ads_recommendations")
          .select("*")
          .eq("client_id", clientId)
          .eq("status", "open")
          .order("created_at", { ascending: true }),
      ]);
      if (cfgRes.error) throw cfgRes.error;
      if (apprRes.error) throw apprRes.error;
      if (logRes.error) throw logRes.error;
      setConfig((cfgRes.data as AdsConfigRow) ?? null);
      setApprovals((apprRes.data as AdsApprovalRow[]) || []);
      setChangelog((logRes.data as AdsChangelogRow[]) || []);
      setRecommendations(((recRes.data as AdsRecommendationRow[]) || []).filter((r) => r.recommendation_type !== "test_dummy"));
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [clientId, limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const markRecommendation = useCallback(
    async (id: string, status: "implemented" | "dismissed", note?: string) => {
      if (!clientId) return { ok: false, error: "kein Kunde" };
      setBusyId(id);
      try {
        const res = await ezyFetch("/api/google/ads-recommendation-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId, id, status, note }),
        });
        const json = await res.json().catch(() => ({}));
        await refresh();
        return json as { ok: boolean; error?: string };
      } finally {
        setBusyId(null);
      }
    },
    [clientId, refresh],
  );

  const decide = useCallback(
    async (approvalId: string, decision: "approve" | "reject") => {
      if (!clientId) return { ok: false, error: "kein Kunde" };
      setBusyId(approvalId);
      try {
        const res = await ezyFetch("/api/google/ads-autopilot-decide", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId, approvalId, decision }),
        });
        const json = await res.json().catch(() => ({}));
        await refresh();
        return json as { ok: boolean; status?: string; error?: string };
      } catch (e: any) {
        return { ok: false, error: e?.message || String(e) };
      } finally {
        setBusyId(null);
      }
    },
    [clientId, refresh],
  );

  const runDryRun = useCallback(async () => {
    if (!clientId) return { ok: false, error: "kein Kunde" };
    setLoading(true);
    try {
      const res = await ezyFetch("/api/google/ads-autopilot-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, dryRun: true }),
      });
      const json = await res.json().catch(() => ({}));
      await refresh();
      return json;
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    } finally {
      setLoading(false);
    }
  }, [clientId, refresh]);

  return { config, approvals, changelog, recommendations, loading, error, busyId, refresh, decide, runDryRun, markRecommendation };
}
