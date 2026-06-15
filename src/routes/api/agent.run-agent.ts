import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Run a saved agent (async) and poll it. POST { id, input, resumeSessionId }
// starts a job -> { jobId }. GET ?jobId=... polls the agent-service job store.

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

export const Route = createFileRoute("/api/agent/run-agent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const base = process.env.AGENT_BASE_URL;
        const secret = process.env.AGENT_SHARED_SECRET;
        if (!base || !secret) return Response.json({ error: "Agent service not configured" }, { status: 503 });
        const unauth = await requireUser(request);
        if (unauth) return unauth;
        const body = await request.json().catch(() => ({}));
        if (!body.id) return Response.json({ ok: false, error: "id erforderlich" }, { status: 400 });
        try {
          const r = await fetch(`${base.replace(/\/+$/, "")}/run-agent`, {
            method: "POST",
            headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
            body: JSON.stringify({ id: body.id, input: body.input ?? "", resumeSessionId: body.resumeSessionId, async: true }),
            signal: AbortSignal.timeout(20_000),
          });
          return new Response(await r.text().catch(() => ""), {
            status: r.status,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (e) {
          return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 502 });
        }
      },
      GET: async ({ request }) => {
        const base = process.env.AGENT_BASE_URL;
        const secret = process.env.AGENT_SHARED_SECRET;
        if (!base || !secret) return Response.json({ error: "Agent service not configured" }, { status: 503 });
        const unauth = await requireUser(request);
        if (unauth) return unauth;
        const jobId = new URL(request.url).searchParams.get("jobId") || "";
        if (!jobId) return Response.json({ ok: false, error: "jobId erforderlich" }, { status: 400 });
        try {
          const r = await fetch(`${base.replace(/\/+$/, "")}/jobs?id=${encodeURIComponent(jobId)}`, {
            headers: { Authorization: `Bearer ${secret}` },
            signal: AbortSignal.timeout(15_000),
          });
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
