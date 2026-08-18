import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Agent templates: GET lists reusable blueprints; POST instantiates one for a
// client (substitutes {{CLIENT_NAME}}/{{CLIENT_DOMAIN}}). Proxies the
// agent-service. Requires a logged-in user.

async function requireUser(request: Request): Promise<Response | null> {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return Response.json({ error: "Server not configured" }, { status: 503 });
  const sb = createClient(url, anon, {
    global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
  });
  const { data } = await sb.auth.getUser();
  if (!data.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}

export const Route = createFileRoute("/api/agent/templates")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const base = process.env.AGENT_BASE_URL;
        const secret = process.env.AGENT_SHARED_SECRET;
        if (!base || !secret)
          return Response.json({ error: "Agent service not configured" }, { status: 503 });
        const unauth = await requireUser(request);
        if (unauth) return unauth;
        try {
          const r = await fetch(`${base.replace(/\/+$/, "")}/templates`, {
            headers: { Authorization: `Bearer ${secret}` },
            signal: AbortSignal.timeout(15_000),
          });
          return new Response(await r.text().catch(() => ""), {
            status: r.status,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (e) {
          return Response.json(
            { ok: false, error: String((e as Error)?.message || e) },
            { status: 502 },
          );
        }
      },
      // Instantiate a template for a client: { templateId, clientId, clientName, clientDomain }
      POST: async ({ request }) => {
        const base = process.env.AGENT_BASE_URL;
        const secret = process.env.AGENT_SHARED_SECRET;
        if (!base || !secret)
          return Response.json({ error: "Agent service not configured" }, { status: 503 });
        const unauth = await requireUser(request);
        if (unauth) return unauth;
        const body = await request.text().catch(() => "");
        try {
          const r = await fetch(`${base.replace(/\/+$/, "")}/agents/from-template`, {
            method: "POST",
            headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
            body,
            signal: AbortSignal.timeout(15_000),
          });
          return new Response(await r.text().catch(() => ""), {
            status: r.status,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (e) {
          return Response.json(
            { ok: false, error: String((e as Error)?.message || e) },
            { status: 502 },
          );
        }
      },
    },
  },
});
