import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Activity view data: current/recent agent runs + active schedules. Proxies the
// agent-service GET /jobs (list) and GET /schedules. Requires a logged-in user.

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

export const Route = createFileRoute("/api/agent/runs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const base = process.env.AGENT_BASE_URL;
        const secret = process.env.AGENT_SHARED_SECRET;
        if (!base || !secret)
          return Response.json(
            { ok: false, error: "Agent service not configured" },
            { status: 503 },
          );
        const unauth = await requireUser(request);
        if (unauth) return unauth;
        const b = base.replace(/\/+$/, "");
        const headers = { Authorization: `Bearer ${secret}` };
        try {
          // 24.08.: 10s -> 20s je Teil-Abfrage — der agent-service braucht
          // unter Last laenger; die Ansicht laedt ohnehin alle 8s nach.
          const [runsRes, schedRes, upRes, costRes] = await Promise.all([
            fetch(`${b}/jobs`, { headers, signal: AbortSignal.timeout(20_000) }),
            fetch(`${b}/schedules`, { headers, signal: AbortSignal.timeout(20_000) }),
            fetch(`${b}/uptime`, { headers, signal: AbortSignal.timeout(20_000) }).catch(
              () => null,
            ),
            fetch(`${b}/costs`, { headers, signal: AbortSignal.timeout(20_000) }).catch(() => null),
          ]);
          const runsJson = await runsRes.json().catch(() => ({}));
          const schedJson = await schedRes.json().catch(() => ({}));
          const upJson = upRes ? await upRes.json().catch(() => ({})) : {};
          const costJson = costRes ? await costRes.json().catch(() => ({})) : {};
          return Response.json(
            {
              ok: true,
              runs: runsJson.runs || [],
              running: runsJson.running || 0,
              schedules: schedJson.schedules || [],
              uptime: upJson.sites || [],
              uptimeDown: upJson.down || 0,
              costs: costJson.ok ? costJson : null,
            },
            { headers: { "Cache-Control": "no-store" } },
          );
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
