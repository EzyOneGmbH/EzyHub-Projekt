import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Plattform Phase 4 (2026-07-31): Proxy zur Reaktivierungsmaschine auf dem
// Cloud-PC (agent-service /reakt/*). GET (Status/Entwürfe) für eingeloggte
// Nutzer; POST (Zeitplan-Schalter) NUR owner/admin. Es gibt bewusst keinen
// Versand-Proxy — die Maschine erzeugt ausschließlich Outlook-ENTWÜRFE.

async function getUserRole(request: Request): Promise<{ userId: string; role: string } | null> {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  const sb = createClient(url, anon, {
    global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
  });
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  const { data: m } = await sb
    .from("app_users")
    .select("role")
    .eq("user_id", data.user.id)
    .order("role", { ascending: true })
    .limit(1)
    .maybeSingle();
  return { userId: data.user.id, role: (m?.role as string) || "viewer" };
}

async function forward(pathname: string, method: string, body?: string): Promise<Response> {
  const base = process.env.AGENT_BASE_URL;
  const secret = process.env.AGENT_SHARED_SECRET;
  if (!base || !secret)
    return Response.json({ ok: false, error: "Agent service not configured" }, { status: 503 });
  try {
    const r = await fetch(`${base.replace(/\/+$/, "")}${pathname}`, {
      method,
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: body || undefined,
      signal: AbortSignal.timeout(20_000),
    });
    return new Response(await r.text().catch(() => ""), {
      status: r.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 502 });
  }
}

export const Route = createFileRoute("/api/agent/reakt")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = await getUserRole(request);
        if (!u) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        if (u.role === "viewer")
          return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
        const what =
          new URL(request.url).searchParams.get("what") === "entwuerfe" ? "entwuerfe" : "status";
        return forward(`/reakt/${what}`, "GET");
      },
      POST: async ({ request }) => {
        const u = await getUserRole(request);
        if (!u) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        if (u.role !== "owner" && u.role !== "admin")
          return Response.json(
            { ok: false, error: "Nur Admins dürfen den Zeitplan schalten" },
            { status: 403 },
          );
        const t = await request.text().catch(() => "");
        let enabled = false;
        try {
          enabled = JSON.parse(t || "{}").enabled === true;
        } catch {
          /* egal */
        }
        return forward("/reakt/schedule", "POST", JSON.stringify({ enabled }));
      },
    },
  },
});
