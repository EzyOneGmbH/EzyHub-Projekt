// Plattform-Umbau Phase 1 (2026-07-31): welcher Nutzer darf welche Apps öffnen?
// owner/admin sehen implizit alles; member nur die app_access-Einträge.
// Kunden-Logins (viewer, 14.09.2026): App-Switcher im Portal — sie dürfen die
// Apps öffnen, die für ihren Kunden freigeschaltet sind (client_app_access,
// keine Zeile = aktiv), nie app_access je User.
// (Supabase-Types kennen app_access noch nicht — as any wie beim aivis-Loader.)
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { EzyAppId } from "./appRegistry";
import { portalAppsFuerKunden } from "./kundenZugriff";

const ALL: EzyAppId[] = ["seo", "geo", "analyse", "ads", "reakt"];

/** Portal-Apps eines Kunden-Logins: eigene Kunden (RLS) × Kunden-Freischaltung. */
async function ladePortalApps(): Promise<Set<EzyAppId>> {
  const { data: clients } = await supabase.from("clients").select("id");
  const ids = (clients ?? []).map((c: any) => c.id as string);
  if (!ids.length) return new Set();
  const { data: rows } = await (supabase as any)
    .from("client_app_access")
    .select("client_id, app, enabled")
    .in("client_id", ids);
  const map = new Map<string, Map<string, { enabled: boolean }>>();
  for (const r of rows ?? []) {
    if (!map.has(r.client_id)) map.set(r.client_id, new Map());
    map.get(r.client_id)!.set(r.app, { enabled: r.enabled !== false });
  }
  return new Set(portalAppsFuerKunden(ids, map) as EzyAppId[]);
}

export function useAppAccess() {
  const { user, role, isOrgAdmin, organizationId, loading: authLoading } = useAuth();
  const [apps, setApps] = useState<Set<EzyAppId> | null>(null);

  // exhaustive-deps-Fix (21.08.): der Effect haengt fachlich nur an der
  // User-ID, nicht an der Objekt-Identitaet von `user`.
  const userId = user?.id;
  useEffect(() => {
    let alive = true;
    if (authLoading) return;
    if (!userId) {
      setApps(new Set());
      return;
    }
    // RACE-FIX (01.08.): useAuth meldet loading=false, BEVOR die Membership
    // (role) geladen ist. In dieser Lücke ist isOrgAdmin noch false — ein
    // Owner bekäme dann seine (leere) app_access-Liste und die Routen-Guards
    // würfen ihn bei JEDEM App-Wechsel zum Launcher zurück. Deshalb: solange
    // role unbekannt ist, bleibt der Hook im Ladezustand.
    if (role === null) return;
    if (isOrgAdmin) {
      setApps(new Set(ALL));
      return;
    }
    if (role === "viewer") {
      ladePortalApps()
        .catch(() => new Set<EzyAppId>())
        .then((s) => {
          if (alive) setApps(s);
        });
      return () => {
        alive = false;
      };
    }
    (supabase as any)
      .from("app_access")
      .select("app")
      .eq("user_id", userId)
      .then(({ data }: { data: Array<{ app: EzyAppId }> | null }) => {
        if (alive) setApps(new Set((data ?? []).map((r) => r.app)));
      });
    return () => {
      alive = false;
    };
  }, [userId, role, isOrgAdmin, authLoading]);

  const canOpen = (id: EzyAppId) =>
    id === "admin" ? isOrgAdmin : isOrgAdmin || (apps?.has(id) ?? false);

  const loading = authLoading || (!!user && role === null) || apps === null;
  return { apps, canOpen, isOrgAdmin, organizationId, loading };
}
