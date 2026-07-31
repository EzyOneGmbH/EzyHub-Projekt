import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import EzyOneApp from "@/ezy/EzyOneApp.jsx";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/dashboard")({
  component: DashboardRoute,
});

// Phase 3 (31.07.): /dashboard ist für Mitarbeiter nur noch ein Redirect in
// die App-Welt (Alt-Links/Bookmarks brechen nicht). Viewer (Kunden-Logins)
// behalten die Legacy-Vollansicht — ihre Reports leben weiterhin hier.
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
    } catch { /* egal */ }
    window.location.replace(target);
  }, [loading, session, role]);

  if (loading) return null;
  if (!session) {
    return null;
  }
  if (role !== "viewer") return null; // Redirect läuft

  return <EzyOneApp />;
}
