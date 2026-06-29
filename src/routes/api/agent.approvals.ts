import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Freigabe-Queue: die vom Agenten geflaggten "Wartet auf dich"-Items (Vault) +
// Status setzen. Proxies the agent-service GET/POST /approvals. Requires a user.

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

export const Route = createFileRoute("/api/agent/approvals")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const base = process.env.AGENT_BASE_URL;
        const secret = process.env.AGENT_SHARED_SECRET;
        if (!base || !secret) return Response.json({ ok: false, error: "Agent service not configured" }, { status: 503 });
        const unauth = await requireUser(request);
        if (unauth) return unauth;
        const b = base.replace(/\/+$/, "");
        try {
          const r = await fetch(`${b}/approvals`, {
            headers: { Authorization: `Bearer ${secret}` },
            signal: AbortSignal.timeout(10_000),
          });
          const j = await r.json().catch(() => ({}));
          return Response.json(j, { headers: { "Cache-Control": "no-store" } });
        } catch (e) {
          return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 502 });
        }
      },
      POST: async ({ request }) => {
        const base = process.env.AGENT_BASE_URL;
        const secret = process.env.AGENT_SHARED_SECRET;
        if (!base || !secret) return Response.json({ ok: false, error: "Agent service not configured" }, { status: 503 });
        const unauth = await requireUser(request);
        if (unauth) return unauth;
        const body = await request.json().catch(() => ({}));
        const b = base.replace(/\/+$/, "");
        try {
          const r = await fetch(`${b}/approvals`, {
            method: "POST",
            headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
            body: JSON.stringify({ id: body.id, status: body.status }),
            signal: AbortSignal.timeout(10_000),
          });
          const j = await r.json().catch(() => ({}));
          return Response.json(j);
        } catch (e) {
          return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 502 });
        }
      },
    },
  },
});
