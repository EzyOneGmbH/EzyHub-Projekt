import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AuditRunRow = {
  id: string;
  client_id: string;
  audit_type: string;
  status: string;
  error: string | null;
  result: any;
  input: any;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

const isUuid = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ""));

/** Live audit_runs history for a single client. */
export function useEzyAuditHistory(clientId: string | undefined, limit = 25) {
  const [runs, setRuns] = useState<AuditRunRow[]>([]);
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
      const { data, error } = await supabase
        .from("audit_runs")
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      setRuns((data as AuditRunRow[]) || []);
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
