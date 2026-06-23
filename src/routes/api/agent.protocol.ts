import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Per-client protocol view: returns the client's Obsidian vault page (markdown)
// from the agent-service so the full agent documentation is visible inside EzyHub.

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

export const Route = createFileRoute("/api/agent/protocol")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const base = process.env.AGENT_BASE_URL;
        const secret = process.env.AGENT_SHARED_SECRET;
        if (!base || !secret) return Response.json({ ok: false, error: "Agent service not configured" }, { status: 503 });
        const unauth = await requireUser(request);
        if (unauth) return unauth;
        const name = new URL(request.url).searchParams.get("name") || "";
        if (!name) return Response.json({ ok: false, error: "name erforderlich" }, { status: 400 });
        try {
          const r = await fetch(
            `${base.replace(/\/+$/, "")}/vault-client?name=${encodeURIComponent(name)}`,
            { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(10_000) },
          );
          return new Response(await r.text().catch(() => ""), {
            status: r.status,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (e) {
          return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 502 });
        }
      },
    },
  },
});
