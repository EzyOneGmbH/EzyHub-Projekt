import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import BlogArtikel from "@/ezy/BlogArtikel";

// Blog-Autopilot: «Artikel prüfen» als Vollbild ohne Sidebar (Kap. 3, 9).
// /ezyrank/blog/artikel/<id>. «ezyrank_» = nicht in die EzyRank-Oberfläche
// verschachtelt. Zugriff prüft jeder /api/blog/*-Aufruf (Einladung,
// Kundenzugriff, Flag).
export const Route = createFileRoute("/ezyrank_/blog/artikel/$id")({
  component: Seite,
});

function Seite() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  useEffect(() => {
    if (!loading && !session)
      void navigate({ to: "/login", search: { next: window.location.pathname }, replace: true });
  }, [loading, session, navigate]);
  if (loading || !session) return null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    window.location.replace("/ezyrank?tab=blog");
    return null;
  }
  return <BlogArtikel key={id} id={id} />;
}
