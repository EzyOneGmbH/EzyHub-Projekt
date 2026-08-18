import { createFileRoute } from "@tanstack/react-router";
import { requireTeamRole } from "@/server/team-guard.server";

// Proxy fuer die Agent-Registry des agent-service (Custom-Assistenten).
// Security-Hardening 18.08.2026: statt «nur angemeldet» gelten jetzt
//  - GET: Team (member+) — Viewer/Portal-Logins kommen NIE durch.
//  - POST/DELETE (Mutationen): NUR owner/admin.
//  - Organisation wird SERVERSEITIG ermittelt und an den agent-service
//    weitergereicht (Header + Body/Query, Client-Werte werden ueberschrieben);
//    Listen-Antworten werden zusaetzlich nach Organisation gefiltert, sobald
//    Agenten eine organizationId tragen (heute Single-Tenant, Grenze steht).

async function proxy(request: Request, method: string): Promise<Response> {
  const base = process.env.AGENT_BASE_URL;
  const secret = process.env.AGENT_SHARED_SECRET;
  if (!base || !secret)
    return Response.json({ error: "Agent service not configured" }, { status: 503 });
  const ctx = await requireTeamRole(request, method === "GET" ? "member" : "admin");
  if (ctx instanceof Response) return ctx;

  // Query durchreichen — ein clientseitig gesetztes org wird IMMER ersetzt.
  const qs = new URL(request.url).searchParams;
  qs.delete("org");
  qs.set("org", ctx.organizationId);
  const target = `${base.replace(/\/+$/, "")}/agents?${qs.toString()}`;
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      "X-Ezy-Organization": ctx.organizationId,
      "X-Ezy-Role": ctx.role,
    },
    signal: AbortSignal.timeout(15_000),
  };
  if (method === "POST" || method === "DELETE") {
    const body: any = await request.json().catch(() => ({}));
    // Serverseitig erzwungen — dem Request wird nie vertraut.
    body.organizationId = ctx.organizationId;
    init.body = JSON.stringify(body);
  }
  try {
    const r = await fetch(target, init);
    const text = await r.text().catch(() => "");
    // Defensive Org-Filterung der Listen-Antwort (no-op, solange Agenten keine
    // organizationId tragen — fremd markierte Eintraege kommen nie durch).
    try {
      const j = JSON.parse(text);
      if (Array.isArray(j?.agents)) {
        j.agents = j.agents.filter(
          (a: any) => !a?.organizationId || a.organizationId === ctx.organizationId,
        );
        return Response.json(j, { status: r.status, headers: { "Cache-Control": "no-store" } });
      }
    } catch {
      /* kein JSON — unveraendert durchreichen */
    }
    return new Response(text, {
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
