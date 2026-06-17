import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type EzyDefaults = {
  language: string;
  tone: string;
  reportTemplate: string;
  visibleTabs: string[];
};

const DEFAULTS: EzyDefaults = {
  language: "Deutsch",
  tone: "Professionell",
  reportTemplate: "Standard",
  visibleTabs: ["overview", "seo", "geo", "conversions", "ads"],
};

const LOCAL_KEY_PREFIX = "ezy-defaults:";

function normalize(v: any): EzyDefaults {
  return {
    language: String(v?.language || DEFAULTS.language),
    tone: String(v?.tone || DEFAULTS.tone),
    reportTemplate: String(v?.reportTemplate || DEFAULTS.reportTemplate),
    visibleTabs: Array.isArray(v?.visibleTabs) ? v.visibleTabs : DEFAULTS.visibleTabs,
  };
}

function loadLocal(clientId: string): EzyDefaults | null {
  try {
    const raw = localStorage.getItem(`${LOCAL_KEY_PREFIX}${clientId}`);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function saveLocal(clientId: string, defaults: EzyDefaults) {
  try {
    localStorage.setItem(`${LOCAL_KEY_PREFIX}${clientId}`, JSON.stringify(defaults));
  } catch {}
}

export function useEzyDefaults(clientId?: string | null) {
  const { organizationId, loading: authLoading } = useAuth();
  const [defaults, setDefaults] = useState<EzyDefaults>(DEFAULTS);
  const [loading, setLoading] = useState(true);

  const isUuid =
    !!clientId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(clientId));

  const reload = useCallback(async () => {
    if (!organizationId) {
      setDefaults(DEFAULTS);
      setLoading(false);
      return;
    }
    setLoading(true);
    // If clientId provided, try localStorage first (client_id column may not exist in Supabase)
    if (isUuid && clientId) {
      const local = loadLocal(clientId);
      if (local) {
        setDefaults(local);
        setLoading(false);
        return;
      }
      // Try Supabase with client_id (may fail if column doesn't exist)
      try {
        const { data, error } = await supabase
          .from("customer_defaults")
          .select("defaults")
          .eq("organization_id", organizationId)
          .eq("client_id", clientId)
          .maybeSingle();
        if (!error && data?.defaults) {
          setDefaults(normalize(data.defaults));
          setLoading(false);
          return;
        }
      } catch {}
      // Fall back to org defaults
      const { data: orgData } = await supabase
        .from("customer_defaults")
        .select("defaults")
        .eq("organization_id", organizationId)
        .is("client_id", null)
        .maybeSingle();
      setDefaults(normalize(orgData?.defaults));
    } else {
      const { data } = await supabase
        .from("customer_defaults")
        .select("defaults")
        .eq("organization_id", organizationId)
        .is("client_id", null)
        .maybeSingle();
      setDefaults(normalize(data?.defaults));
    }
    setLoading(false);
  }, [organizationId, clientId, isUuid]);

  useEffect(() => {
    if (!authLoading) void reload();
  }, [authLoading, reload]);

  const save = useCallback(
    async (next: EzyDefaults) => {
      const normalized = normalize(next);
      setDefaults(normalized);
      if (!organizationId) return normalized;
      // Save to client-specific: use localStorage (robust) + try Supabase (may fail)
      if (isUuid && clientId) {
        saveLocal(clientId, normalized);
        try {
          const { data: existing } = await supabase
            .from("customer_defaults")
            .select("id")
            .eq("organization_id", organizationId)
            .eq("client_id", clientId)
            .maybeSingle();
          if (existing?.id) {
            await supabase
              .from("customer_defaults")
              .update({ defaults: normalized })
              .eq("id", existing.id);
          } else {
            await supabase
              .from("customer_defaults")
              .insert({ organization_id: organizationId, client_id: clientId, defaults: normalized });
          }
        } catch {}
      } else {
        const { data: existing } = await supabase
          .from("customer_defaults")
          .select("id")
          .eq("organization_id", organizationId)
          .is("client_id", null)
          .maybeSingle();
        if (existing?.id) {
          await supabase
            .from("customer_defaults")
            .update({ defaults: normalized })
            .eq("id", existing.id);
        } else {
          await supabase
            .from("customer_defaults")
            .insert({ organization_id: organizationId, defaults: normalized });
        }
      }
      return normalized;
    },
    [organizationId, clientId, isUuid],
  );

  return { defaults, loading, save, reload };
}
