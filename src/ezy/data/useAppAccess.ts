// Plattform-Umbau Phase 1 (2026-07-31): welcher Nutzer darf welche Apps öffnen?
// owner/admin sehen implizit alles; member nur die app_access-Einträge.
// (Supabase-Types kennen app_access noch nicht — as any wie beim aivis-Loader.)
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { EzyAppId } from "./appRegistry";

const ALL: EzyAppId[] = ["seo", "geo", "analyse", "ads", "reakt"];

export function useAppAccess() {
  const { user, role, isOrgAdmin, organizationId, loading: authLoading } = useAuth();
  const [apps, setApps] = useState<Set<EzyAppId> | null>(null);

  useEffect(() => {
    let alive = true;
    if (authLoading) return;
    if (!user) { setApps(new Set()); return; }
    // RACE-FIX (01.08.): useAuth meldet loading=false, BEVOR die Membership
    // (role) geladen ist. In dieser Lücke ist isOrgAdmin noch false — ein
    // Owner bekäme dann seine (leere) app_access-Liste und die Routen-Guards
    // würfen ihn bei JEDEM App-Wechsel zum Launcher zurück. Deshalb: solange
    // role unbekannt ist, bleibt der Hook im Ladezustand.
    if (role === null) return;
    if (isOrgAdmin) { setApps(new Set(ALL)); return; }
    (supabase as any)
      .from("app_access")
      .select("app")
      .eq("user_id", user.id)
      .then(({ data }: { data: Array<{ app: EzyAppId }> | null }) => {
        if (alive) setApps(new Set((data ?? []).map((r) => r.app)));
      });
    return () => { alive = false; };
  }, [user?.id, role, isOrgAdmin, authLoading]);

  const canOpen = (id: EzyAppId) =>
    id === "admin" ? isOrgAdmin : isOrgAdmin || (apps?.has(id) ?? false);

  const loading = authLoading || (!!user && role === null) || apps === null;
  return { apps, canOpen, isOrgAdmin, organizationId, loading };
}
