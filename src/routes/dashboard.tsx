import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import EzyOneApp from "@/ezy/EzyOneApp.jsx";
import { useAuth } from "@/hooks/use-auth";
import { useAppAccess } from "@/ezy/data/useAppAccess";
import { PORTAL_RAIL_APPS } from "@/ezy/data/kundenZugriff";

export const Route = createFileRoute("/dashboard")({
  component: DashboardRoute,
});

// Phase 3 (31.07.): /dashboard ist für Mitarbeiter nur noch ein Redirect in
// die App-Welt (Alt-Links/Bookmarks brechen nicht).
// Portal-App-Switcher (14.09.): auch Kunden-Logins (viewer) starten in der
// ersten für ihren Kunden freigeschalteten App (EzyRank → EzyAI →
// EzyPerformance) und wechseln dort über die linke Rail. Nur ohne jede
// freigeschaltete App bleibt die Legacy-Vollansicht hier als Auffangnetz.
const APP_REDIRECT: Record<string, string> = {
  seo: "/ezyrank",
  geo: "/ezyai",
  ads: "/ezyperformance",
  reakt: "/reakt",
  admin: "/admin",
};

function DashboardRoute() {
  const navigate = useNavigate();
  const { session, loading, role } = useAuth();
  const { canOpen, loading: accessLoading } = useAppAccess();

  useEffect(() => {
    if (!loading && !session) {
      navigate({ to: "/login", search: { next: undefined }, replace: true });
    }
  }, [loading, session, navigate]);

  useEffect(() => {
    if (loading || !session || role === "viewer" || role === null) return;
    let target = "/ezyrank";
    try {
      const p = new URLSearchParams(window.location.search).get("app");
      if (p && APP_REDIRECT[p]) target = APP_REDIRECT[p];
    } catch {
      /* egal */
    }
    window.location.replace(target);
  }, [loading, session, role]);

  const portalStart =
    role === "viewer" && !accessLoading ? PORTAL_RAIL_APPS.find((a) => canOpen(a)) || null : null;
  useEffect(() => {
    if (portalStart) window.location.replace(APP_REDIRECT[portalStart]);
  }, [portalStart]);

  if (loading) return null;
  if (!session) {
    return null;
  }
  if (role !== "viewer") return null; // Redirect läuft
  if (accessLoading || portalStart) return null; // Portal-Redirect läuft

  return <EzyOneApp />;
}
