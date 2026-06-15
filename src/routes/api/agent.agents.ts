import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Proxy for the agent-service agent registry (custom assistants). Requires a
// logged-in user; forwards to AGENT_BASE_URL/agents with the shared secret.

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

async function proxy(request: Request, method: string): Promise<Response> {
  const base = process.env.AGENT_BASE_URL;
  const secret = process.env.AGENT_SHARED_SECRET;
  if (!base || !secret) return Response.json({ error: "Agent service not configured" }, { status: 503 });
  const unauth = await requireUser(request);
  if (unauth) return unauth;

  const qs = new URL(request.url).searchParams.toString();
  const target = `${base.replace(/\/+$/, "")}/agents${qs ? `?${qs}` : ""}`;
  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
  };
  if (method === "POST" || method === "DELETE") {
    const t = await request.text().catch(() => "");
    if (t) init.body = t;
  }
  try {
    const r = await fetch(target, init);
    return new Response(await r.text().catch(() => ""), {
      status: r.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 502 });
  }
}

export const Route = createFileRoute("/api/agent/agents")({
  server: {
    handlers: {
      GET: async ({ request }) => proxy(request, "GET"),
      POST: async ({ request }) => proxy(request, "POST"),
      DELETE: async ({ request }) => proxy(request, "DELETE"),
    },
  },
});
