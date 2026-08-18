import { createFileRoute } from "@tanstack/react-router";
import { requireTeamRole } from "@/server/team-guard.server";

// Freigabe-Queue (agent-service /approvals). Security-Hardening 18.08.2026:
//  - GET (lesen): Team (member+) — Viewer/Portal-Logins NIE.
//  - POST (Freigabe-Entscheid): NUR owner/admin — Freigaben sind Entscheidungen.
//  - Organisation serverseitig ermittelt und weitergereicht; Request-IDs werden
//    formvalidiert und nie ungeprueft durchgereicht.

const ID_RE = /^[A-Za-z0-9._:-]{1,200}$/;
const STATUS_RE = /^[a-z_-]{2,32}$/;

export const Route = createFileRoute("/api/agent/approvals")({
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
        const ctx = await requireTeamRole(request, "member");
        if (ctx instanceof Response) return ctx;
        try {
          const r = await fetch(
            `${base.replace(/\/+$/, "")}/approvals?org=${encodeURIComponent(ctx.organizationId)}`,
            {
              headers: {
                Authorization: `Bearer ${secret}`,
                "X-Ezy-Organization": ctx.organizationId,
                "X-Ezy-Role": ctx.role,
              },
              signal: AbortSignal.timeout(10_000),
            },
          );
          const j = await r.json().catch(() => ({}));
          return Response.json(j, { headers: { "Cache-Control": "no-store" } });
        } catch (e) {
          return Response.json(
            { ok: false, error: String((e as Error)?.message || e) },
            { status: 502 },
          );
        }
      },
      POST: async ({ request }) => {
        const base = process.env.AGENT_BASE_URL;
        const secret = process.env.AGENT_SHARED_SECRET;
        if (!base || !secret)
          return Response.json(
            { ok: false, error: "Agent service not configured" },
            { status: 503 },
          );
        const ctx = await requireTeamRole(request, "admin");
        if (ctx instanceof Response) return ctx;
        const body: any = await request.json().catch(() => ({}));
        const id = String(body?.id || "");
        const status = String(body?.status || "");
        if (!ID_RE.test(id) || !STATUS_RE.test(status))
          return Response.json({ ok: false, error: "id/status ungültig" }, { status: 400 });
        try {
          const r = await fetch(`${base.replace(/\/+$/, "")}/approvals`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${secret}`,
              "Content-Type": "application/json",
              "X-Ezy-Organization": ctx.organizationId,
              "X-Ezy-Role": ctx.role,
            },
            body: JSON.stringify({
              id,
              status,
              organizationId: ctx.organizationId,
              decidedBy: ctx.userId,
            }),
            signal: AbortSignal.timeout(10_000),
          });
          const j = await r.json().catch(() => ({}));
          return Response.json(j);
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
