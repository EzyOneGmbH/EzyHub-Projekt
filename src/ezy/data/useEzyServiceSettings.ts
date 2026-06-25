import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { SERVICE_KEYS, SERVICE_PARENT, type ServiceKey } from "@/lib/services";

// Granulare Service-Toggles pro Kunde (ga4/gsc/google-ads/gtm/gbp/bing/wordpress/
// canonry/ahrefs/perplexity), gespeichert in client_integrations(provider,enabled).
// Spiegelt die server-seitige Aufloesung (resolveServices): explizite feine Zeile
// gewinnt; feine Google-Kinder fallen sonst auf die grobe "google"-Zeile zurueck.

function resolveClient(map: Record<string, boolean>, key: ServiceKey): boolean {
  if (Object.prototype.hasOwnProperty.call(map, key)) return map[key] === true;
  if (SERVICE_PARENT[key] === "google") return map.google === true;
  return false;
}

export function useEzyServiceSettings(clientId: string | null | undefined) {
  const { organizationId, loading: authLoading } = useAuth();
  const [raw, setRaw] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const isUuid =
    !!clientId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(clientId));

  const reload = useCallback(async () => {
    if (!organizationId || !isUuid || !clientId) {
      setRaw({});
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("client_integrations")
      .select("provider, enabled")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId);
    const map: Record<string, boolean> = {};
    for (const row of data ?? []) map[String(row.provider)] = !!row.enabled;
    setRaw(map);
    setLoading(false);
  }, [clientId, isUuid, organizationId]);

  useEffect(() => {
    if (!authLoading) void reload();
  }, [authLoading, reload]);

  const enabled = useMemo(() => {
    const out = {} as Record<ServiceKey, boolean>;
    for (const k of SERVICE_KEYS) out[k] = resolveClient(raw, k);
    return out;
  }, [raw]);

  const setEnabled = useCallback(
    async (key: ServiceKey, value: boolean) => {
      setRaw((p) => ({ ...p, [key]: value }));
      if (!organizationId || !isUuid || !clientId) return;
      const { data: existing } = await supabase
        .from("client_integrations")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("client_id", clientId)
        .eq("provider", key)
        .maybeSingle();
      if (existing?.id) {
        await supabase.from("client_integrations").update({ enabled: value }).eq("id", existing.id);
      } else {
        await supabase.from("client_integrations").insert({
          organization_id: organizationId,
          client_id: clientId,
          provider: key,
          enabled: value,
        });
      }
    },
    [clientId, isUuid, organizationId],
  );

  return useMemo(
    () => ({ enabled, loading, setEnabled, reload }),
    [enabled, loading, setEnabled, reload],
  );
}
