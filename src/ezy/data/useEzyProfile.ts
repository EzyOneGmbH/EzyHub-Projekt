import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type EzyProfile = {
  name: string;
  email: string;
  role: string;
  language: string;
};

const DEFAULT_PROFILE: EzyProfile = {
  name: "",
  email: "",
  role: "Agency Admin",
  language: "Deutsch",
};

export function useEzyProfile() {
  const { user, role, loading: authLoading, refresh } = useAuth();
  const [profile, setProfile] = useState<EzyProfile>(DEFAULT_PROFILE);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user) {
      setProfile(DEFAULT_PROFILE);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle();
    setProfile({
      name: String(data?.full_name || user.user_metadata?.full_name || user.email || ""),
      email: String(user.email || ""),
      role: role ? role.charAt(0).toUpperCase() + role.slice(1) : "Agency Admin",
      language: "Deutsch",
    });
    setLoading(false);
  }, [user, role]);

  useEffect(() => {
    if (!authLoading) void reload();
  }, [authLoading, reload]);

  const save = useCallback(
    async (next: EzyProfile) => {
      setProfile(next);
      if (!user) return;
      await supabase.from("profiles").update({ full_name: next.name }).eq("id", user.id);
      await refresh();
    },
    [user, refresh],
  );

  return { profile, loading, save, reload };
}
