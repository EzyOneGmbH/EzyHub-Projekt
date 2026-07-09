import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AgentRunRow = {
  id: string;
  client_id: string;
  agent_name: string;
  status: string; // 'ok' | 'fehler' | 'partial'
  health_score: number | null;
  deploy_count: number;
  summary: string | null;
  error_message: string | null;
  run_at: string;
  duration_ms: number | null;
  metadata: Record<string, any> | null;
  created_at: string;
};

const isUuid = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ""));

/**
 * Live Agent-Lauf-Historie eines Kunden — inkl. 0-Aenderungs-Laeufe.
 * Quelle: public.agent_runs (befuellt vom agent-service nach jedem Lauf).
 * `agent_runs` ist zum Build-Zeitpunkt evtl. noch nicht in den generierten
 * Supabase-Typen -> from() ueber `any`, Ergebnis auf AgentRunRow[] gecastet.
 */
export function useEzyAgentRuns(clientId: string | undefined, limit = 50) {
  const [runs, setRuns] = useState<AgentRunRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!clientId || !isUuid(clientId)) {
      setRuns([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await (supabase as any)
        .from("agent_runs")
        .select("*")
        .eq("client_id", clientId)
        .order("run_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      setRuns((data as AgentRunRow[]) || []);
    } catch (e: any) {
      setError(e?.message || String(e));
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [clientId, limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { runs, loading, error, refresh };
}
