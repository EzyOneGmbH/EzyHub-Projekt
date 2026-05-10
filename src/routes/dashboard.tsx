import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import EzyOneApp from "@/ezy/EzyOneApp.jsx";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/dashboard")({
  component: DashboardRoute,
});

function DashboardRoute() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();

  useEffect(() => {
    if (!loading && !session) {
      navigate({ to: "/login", replace: true });
    }
  }, [loading, session, navigate]);

  if (loading) return null;
  if (!session) {
    return null;
  }

  return <EzyOneApp />;
}
