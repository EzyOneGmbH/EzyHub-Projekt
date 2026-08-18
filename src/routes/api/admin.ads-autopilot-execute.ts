import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { decideApproval } from "@/server/google-ads-autopilot.server";

// Approve (and execute) or reject a queued Autopilot action. Called by n8n when
// a human clicks Approve/Reject. Server-to-server, ADMIN_AUTOMATION_SECRET.
// Identify the action by approvalId OR (runId + actionId). Shared logic lives in
// decideApproval() (also used by the user-authed /api/google/ads-autopilot-decide).

const Body = z
  .object({
    approvalId: z.string().uuid().optional(),
    runId: z.string().optional(),
    actionId: z.string().optional(),
    decision: z.enum(["approve", "reject"]).default("approve"),
    decidedBy: z.string().optional(),
  })
  .refine((b) => b.approvalId || (b.runId && b.actionId), {
    message: "approvalId oder runId+actionId noetig",
  });

export const Route = createFileRoute("/api/admin/ads-autopilot-execute")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret)
          return Response.json(
            { ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" },
            { status: 503 },
          );
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });

        const r = await decideApproval(parsed.data);
        return Response.json(
          {
            ok: r.ok,
            decision: parsed.data.decision,
            status: r.status,
            error: r.error,
            approvalId: r.approvalId,
          },
          { status: r.httpStatus },
        );
      },
    },
  },
});
