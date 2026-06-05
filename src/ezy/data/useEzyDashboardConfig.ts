import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

/**
 * Per-organization dashboard metric toggles (organizations.dashboard_config jsonb).
 * Default-on semantics: a metric group is shown unless explicitly set to false.
 * Reads work for any org member; writes require org-admin (enforced by RLS).
 */
export type DashboardMetricKey =
  | "seo.ahrefs"
  | "seo.gsc"
  | "seo.cwv"
  | "seo.trend"
  | "conv.custom"
  | "conv.ga4"
  | "conv.revenue"
  | "conv.trend";

export function useEzyDashboardConfig() {
  const { organizationId, loading: authLoading } = useAuth();
  const [cfg, setCfg] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!organizationId) {
      setCfg({});
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("organizations")
      .select("dashboard_config")
      .eq("id", organizationId)
      .maybeSingle();
    setCfg((data?.dashboard_config as Record<string, boolean>) || {});
    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    if (!authLoading) void reload();
  }, [authLoading, reload]);

  const isOn = useCallback(
    (key: string, fallback = true) =>
      Object.prototype.hasOwnProperty.call(cfg, key) ? cfg[key] !== false : fallback,
    [cfg],
  );

  const setKey = useCallback(
    async (key: string, enabled: boolean) => {
      const next = { ...cfg, [key]: enabled };
      setCfg(next);
      if (organizationId) {
        await supabase.from("organizations").update({ dashboard_config: next }).eq("id", organizationId);
      }
    },
    [cfg, organizationId],
  );

  return useMemo(
    () => ({ cfg, loading, isOn, setKey, reload }),
    [cfg, loading, isOn, setKey, reload],
  );
}
