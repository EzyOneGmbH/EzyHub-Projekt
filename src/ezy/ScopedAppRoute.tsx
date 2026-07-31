import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useAppAccess } from "@/ezy/data/useAppAccess";
import type { EzyAppId } from "@/ezy/data/appRegistry";
import EzyOneApp from "@/ezy/EzyOneApp.jsx";

// Phase 3 (31.07.): gemeinsamer Guard für alle App-Routen — Auth, Viewer-
// Umleitung, app_access-Gate; danach mountet die EzyOneApp-Engine mit Scope.
export function ScopedAppRoute({ appId, next }: { appId: EzyAppId; next: string }) {
  const navigate = useNavigate();
  const { session, loading: authLoading, role } = useAuth();
  const { canOpen, loading: accessLoading } = useAppAccess();

  useEffect(() => {
    if (!authLoading && !session) navigate({ to: "/login", search: { next }, replace: true });
  }, [authLoading, session, navigate, next]);
  useEffect(() => {
    if (!authLoading && role === "viewer") window.location.replace("/dashboard");
  }, [authLoading, role]);
  useEffect(() => {
    if (!accessLoading && session && role !== "viewer" && !canOpen(appId))
      window.location.replace("/apps");
  }, [accessLoading, session, role, canOpen, appId]);

  if (authLoading || !session || role === "viewer") return null;
  if (accessLoading || !canOpen(appId)) return null;
  return <EzyOneApp appScope={appId} />;
}
