import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

/**
 * Maps a UI tool ID to the real backend provider used by isProviderEnabled.
 * Tools without a real backend provider return null and remain client-only.
 */
export function toolProvider(
  toolId: string,
): "ahrefs" | "google" | "canonry" | "perplexity" | "anthropic" | null {
  switch (toolId) {
    case "canonry":
      return "canonry";
    case "open-seo-audit":
    case "full-seo-audit":
    case "technical-audit":
    case "on-page-audit":
      return "ahrefs";
    case "geo-aeo-audit":
      return "perplexity";
    case "generate-blog":
    case "obsidian-note":
    case "content-brief":
    case "blog-outline":
    case "meta-tags":
    case "schema-markup":
      return "anthropic";
    default:
      return null;
  }
}

const UI_PREFIX = "tool:"; // for tools without a real provider

/**
 * Tool toggles per client.
 *  - For tools backed by a real provider (ahrefs/google/canonry/perplexity),
 *    we read/write client_integrations rows with provider = the real name.
 *  - For purely UI tools, we store provider = "tool:<toolId>".
 */
export function useEzyToolSettings(clientId: string | null | undefined) {
  const { organizationId, loading: authLoading } = useAuth();
  // overrides keyed by toolId
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
      .eq("client_id", clientId);
    const providerEnabled: Record<string, boolean> = {};
    const uiEnabled: Record<string, boolean> = {};
    for (const row of data ?? []) {
      const p = String(row.provider);
      if (p.startsWith(UI_PREFIX)) {
        uiEnabled[p.slice(UI_PREFIX.length)] = !!row.enabled;
      } else {
        providerEnabled[p] = !!row.enabled;
      }
    }
    // map tool IDs based on provider
    const map: Record<string, boolean> = { ...uiEnabled };
    const allToolIds = [
      "open-seo-audit",
      "full-seo-audit",
      "geo-aeo-audit",
      "technical-audit",
      "on-page-audit",
      "generate-blog",
      "obsidian-note",
      "canonry",
      "content-brief",
      "blog-outline",
      "meta-tags",
      "schema-markup",
    ];
    for (const id of allToolIds) {
      const prov = toolProvider(id);
      if (prov && Object.prototype.hasOwnProperty.call(providerEnabled, prov)) {
        map[id] = providerEnabled[prov];
      }
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
      const real = toolProvider(toolId);
      const provider = real ?? `${UI_PREFIX}${toolId}`;
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
