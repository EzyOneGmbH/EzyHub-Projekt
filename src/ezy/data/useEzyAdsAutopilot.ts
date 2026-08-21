import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ezyFetch } from "./api";
import type { AutopilotConfigPatch } from "./adsAutopilotPolicy";

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
  approved_by: string | null;
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
  monthly_budget_chf: number | null;
  target_cpa_chf: number | null;
  target_roas: number | null;
  no_touch_campaigns: string[];
  season_high: string[];
  season_low: string[];
  updated_at: string | null;
};

// Kompakter Blick auf die persistierte Run-Summary (audit_runs/ads_autopilot).
// Bewusst lose typisiert - die Drilldowns pruefen jedes Feld defensiv und
// benennen fehlende Quellen explizit (keine simulierten Tabellen).
export type AdsAutopilotRunResult = Record<string, unknown> & {
  runId?: string;
  trackingHealth?: {
    status: string;
    spend7d: number;
    conversions7d: number;
    conversionsBaseline30d: number;
  };
  budgetPacing?: {
    status: "no_budget" | "under" | "on_track" | "over";
    monthlyBudgetChf: number | null;
    budgetSource: string;
    mtdSpendChf: number;
    elapsedDays: number;
    daysInMonth: number;
    expectedToDateChf: number | null;
    forecastEomChf: number | null;
    pacingRatio: number | null;
  } | null;
  campaignDetail?: Array<{
    name: string;
    dailyBudgetChf: number;
    costChf: number;
    conversions: number;
    conversionValue: number;
    roas: number | null;
    budgetLostIs: number | null;
    rankLostIs: number | null;
    searchImpressionShare: number | null;
    learning: boolean;
    strategyType: string;
    targetRoas: number | null;
    targetCpaChf: number | null;
    noTouch: boolean;
  }>;
  semanticCandidates?: Array<{
    term: string;
    campaign: string;
    adGroup: string;
    costChf: number;
    clicks: number;
  }>;
  geoTop?: Array<{ location: string; costChf: number; conversions: number }>;
  deviceSplit?: Array<{ device: string; costChf: number; conversions: number }>;
  biddingStrategies?: Array<{
    campaign: string;
    strategyType: string;
    targetRoas: number | null;
    targetCpaChf: number | null;
    systemStatus: string;
  }>;
  dataSourceErrors?: string[];
};

const isUuid = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ""));

/** Live Autopilot data (config + pending approvals + recent changelog) for one client. */
export function useEzyAdsAutopilot(clientId: string | undefined, limit = 30) {
  const [config, setConfig] = useState<AdsConfigRow | null>(null);
  const [approvals, setApprovals] = useState<AdsApprovalRow[]>([]);
  const [changelog, setChangelog] = useState<AdsChangelogRow[]>([]);
  const [recommendations, setRecommendations] = useState<AdsRecommendationRow[]>([]);
  const [configHistory, setConfigHistory] = useState<AdsChangelogRow[]>([]);
  const [autopilotRun, setAutopilotRun] = useState<{
    result: AdsAutopilotRunResult;
    created_at: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Auto-Anlage der Config-Zeile (sichere DB-Defaults) hoechstens 1x je Kunde,
  // damit ein Server-Fehler keine Request-Schleife ausloest.
  const ensuredFor = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!clientId || !isUuid(clientId)) {
      setConfig(null);
      setApprovals([]);
      setChangelog([]);
      setConfigHistory([]);
      setAutopilotRun(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [cfgRes, apprRes, logRes, recRes, cfgLogRes, runRes] = await Promise.all([
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
          .neq("action_type", "config_change")
          .order("created_at", { ascending: false })
          .limit(limit),
        supabase
          .from("ads_recommendations")
          .select("*")
          .eq("client_id", clientId)
          .eq("status", "open")
          .order("created_at", { ascending: true }),
        supabase
          .from("ads_changelog")
          .select("*")
          .eq("client_id", clientId)
          .eq("action_type", "config_change")
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("audit_runs")
          .select("result, created_at")
          .eq("client_id", clientId)
          .eq("audit_type", "ads_autopilot")
          .eq("status", "succeeded")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (cfgRes.error) throw cfgRes.error;
      if (apprRes.error) throw apprRes.error;
      if (logRes.error) throw logRes.error;
      let cfg = (cfgRes.data as AdsConfigRow) ?? null;
      if (!cfg && ensuredFor.current !== clientId) {
        // Zeile fehlt -> serverseitig mit sicheren Defaults anlegen (kein SQL).
        ensuredFor.current = clientId;
        try {
          const res = await ezyFetch("/api/google/ads-autopilot-config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clientId, ensure: true }),
          });
          const json = await res.json().catch(() => ({}));
          if (json?.ok && json.config) cfg = json.config as AdsConfigRow;
        } catch {
          /* Anlage ist Komfort - Panel funktioniert auch mit Default-Anzeige */
        }
      }
      setConfig(cfg);
      setApprovals((apprRes.data as AdsApprovalRow[]) || []);
      setChangelog((logRes.data as AdsChangelogRow[]) || []);
      setRecommendations(
        ((recRes.data as AdsRecommendationRow[]) || []).filter(
          (r) => r.recommendation_type !== "test_dummy",
        ),
      );
      setConfigHistory((cfgLogRes.data as AdsChangelogRow[]) || []);
      setAutopilotRun(
        runRes.data?.result
          ? {
              result: runRes.data.result as AdsAutopilotRunResult,
              created_at: String(runRes.data.created_at ?? ""),
            }
          : null,
      );
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

  // Konfiguration speichern (nur Owner/Admin; der Server prueft die Rolle
  // nochmals). summary = Pflicht-Begruendung aus dem Bestaetigungs-Dialog.
  const saveConfig = useCallback(
    async (patch: AutopilotConfigPatch, summary: string) => {
      if (!clientId) return { ok: false, error: "kein Kunde" };
      setBusyId("config");
      try {
        const res = await ezyFetch("/api/google/ads-autopilot-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId, patch, summary }),
        });
        const json = await res.json().catch(() => ({}));
        await refresh();
        return json as { ok: boolean; error?: string; changes?: string[] };
      } catch (e: any) {
        return { ok: false, error: e?.message || String(e) };
      } finally {
        setBusyId(null);
      }
    },
    [clientId, refresh],
  );

  return {
    config,
    approvals,
    changelog,
    recommendations,
    configHistory,
    autopilotRun,
    loading,
    error,
    busyId,
    refresh,
    decide,
    runDryRun,
    markRecommendation,
    saveConfig,
  };
}
