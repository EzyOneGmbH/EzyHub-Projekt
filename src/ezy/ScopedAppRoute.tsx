import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useAppAccess } from "@/ezy/data/useAppAccess";
import type { EzyAppId } from "@/ezy/data/appRegistry";
import EzyOneApp from "@/ezy/EzyOneApp.jsx";

// Phase 3 (31.07.): gemeinsamer Guard für alle App-Routen — Auth, App-Gate;
// danach mountet die EzyOneApp-Engine mit Scope.
// Portal-App-Switcher (14.09.): Kunden-Logins (viewer) werden nicht mehr pauschal
// auf /dashboard umgeleitet — sie dürfen die Apps öffnen, die für ihren Kunden
// freigeschaltet sind (useAppAccess liest dafür client_app_access). Ohne
// Freischaltung landen sie im Portal (/dashboard), Mitarbeiter im Launcher.
export function ScopedAppRoute({ appId, next }: { appId: EzyAppId; next: string }) {
  const navigate = useNavigate();
  const { session, loading: authLoading, role } = useAuth();
  const { canOpen, loading: accessLoading } = useAppAccess();

  useEffect(() => {
    if (!authLoading && !session) navigate({ to: "/login", search: { next }, replace: true });
  }, [authLoading, session, navigate, next]);
  useEffect(() => {
    if (!accessLoading && session && !canOpen(appId))
      window.location.replace(role === "viewer" ? "/dashboard" : "/apps");
  }, [accessLoading, session, role, canOpen, appId]);

  if (authLoading || !session) return null;
  if (accessLoading || !canOpen(appId)) return null;
  return <EzyOneApp appScope={appId} />;
}
