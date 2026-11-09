import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import BlogEinrichtung from "@/ezy/BlogEinrichtung";

// Blog-Autopilot: Onboarding als Vollbild ohne Sidebar (Kap. 3, 6A).
// /ezyrank/blog/einrichtung/1–8?client=<id>. «ezyrank_» = nicht in die
// EzyRank-Oberfläche verschachtelt. Zugriff prüft jeder /api/blog/*-Aufruf
// (Einladung, Kundenzugriff, Flag).
export const Route = createFileRoute("/ezyrank_/blog/einrichtung/$step")({
  validateSearch: (s: Record<string, unknown>): { client?: string } =>
    typeof s.client === "string" && /^[0-9a-f-]{36}$/i.test(s.client) ? { client: s.client } : {},
  component: Seite,
});

function Seite() {
  const { step } = Route.useParams();
  const { client } = Route.useSearch();
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  useEffect(() => {
    if (!loading && !session)
      void navigate({ to: "/login", search: { next: window.location.pathname }, replace: true });
  }, [loading, session, navigate]);
  const n = Math.min(8, Math.max(1, Number.parseInt(step, 10) || 1));
  if (loading || !session) return null;
  return <BlogEinrichtung step={n} clientParam={client} />;
}
