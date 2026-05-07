import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type EzyDefaults = { language: string; tone: string; reportTemplate: string };

const DEFAULTS: EzyDefaults = {
  language: "Deutsch",
  tone: "Professionell",
  reportTemplate: "Standard",
};

function normalize(v: any): EzyDefaults {
  return {
    language: String(v?.language || DEFAULTS.language),
    tone: String(v?.tone || DEFAULTS.tone),
    reportTemplate: String(v?.reportTemplate || DEFAULTS.reportTemplate),
  };
}

export function useEzyDefaults() {
  const { organizationId, loading: authLoading } = useAuth();
  const [defaults, setDefaults] = useState<EzyDefaults>(DEFAULTS);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!organizationId) {
      setDefaults(DEFAULTS);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("customer_defaults")
      .select("defaults")
      .eq("organization_id", organizationId)
      .maybeSingle();
    setDefaults(normalize(data?.defaults));
    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    if (!authLoading) void reload();
  }, [authLoading, reload]);

  const save = useCallback(
    async (next: EzyDefaults) => {
      const normalized = normalize(next);
      setDefaults(normalized);
      if (!organizationId) return normalized;
      const { data: existing } = await supabase
        .from("customer_defaults")
        .select("id")
        .eq("organization_id", organizationId)
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
      return normalized;
    },
    [organizationId],
  );

  return { defaults, loading, save, reload };
}
