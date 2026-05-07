import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

const PROVIDER_PREFIX = "tool:";

/**
 * Tool toggles stored in client_integrations as provider="tool:<toolId>".
 * Per-client; a tool is enabled unless an explicit row says enabled=false.
 */
export function useEzyToolSettings(clientId: string | null | undefined) {
  const { organizationId, loading: authLoading } = useAuth();
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const isUuid =
    !!clientId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(clientId));

  const reload = useCallback(async () => {
    if (!organizationId || !isUuid || !clientId) {
      setOverrides({});
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("client_integrations")
      .select("provider, enabled")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .like("provider", `${PROVIDER_PREFIX}%`);
    const map: Record<string, boolean> = {};
    for (const row of data ?? []) {
      const id = String(row.provider).slice(PROVIDER_PREFIX.length);
      if (id) map[id] = !!row.enabled;
    }
    setOverrides(map);
    setLoading(false);
  }, [clientId, isUuid, organizationId]);

  useEffect(() => {
    if (!authLoading) void reload();
  }, [authLoading, reload]);

  const isEnabled = useCallback(
    (toolId: string, fallback = true) =>
      Object.prototype.hasOwnProperty.call(overrides, toolId) ? overrides[toolId] : fallback,
    [overrides],
  );

  const setEnabled = useCallback(
    async (toolId: string, enabled: boolean) => {
      setOverrides((p) => ({ ...p, [toolId]: enabled }));
      if (!organizationId || !isUuid || !clientId) return;
      const provider = `${PROVIDER_PREFIX}${toolId}`;
      const { data: existing } = await supabase
        .from("client_integrations")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("client_id", clientId)
        .eq("provider", provider)
        .maybeSingle();
      if (existing?.id) {
        await supabase.from("client_integrations").update({ enabled }).eq("id", existing.id);
      } else {
        await supabase
          .from("client_integrations")
          .insert({ organization_id: organizationId, client_id: clientId, provider, enabled });
      }
    },
    [clientId, isUuid, organizationId],
  );

  const applyTo = useCallback(
    <T extends { id: string; enabled?: boolean }>(tools: T[]): T[] =>
      tools.map((t) => ({ ...t, enabled: isEnabled(t.id, t.enabled !== false) })),
    [isEnabled],
  );

  return useMemo(
    () => ({ overrides, loading, isEnabled, setEnabled, applyTo, reload }),
    [overrides, loading, isEnabled, setEnabled, applyTo, reload],
  );
}
