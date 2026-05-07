import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import EzyOneApp from "@/ezy/EzyOneApp.jsx";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/dashboard")({
  component: DashboardRoute,
});

function DashboardRoute() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthed(!!data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setAuthed(!!s));
    return () => sub.subscription.unsubscribe();
  }, []);
  if (!ready) return null;
  if (!authed) {
    if (typeof window !== "undefined") window.location.href = "/login";
    return null;
  }
  return <EzyOneApp />;
}
