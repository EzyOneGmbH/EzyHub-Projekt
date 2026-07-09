import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { runOutcomeReview } from "@/server/google-ads-outcome.server";

// Phase 4: daily outcome-review job (idempotent). Trigger via n8n/cron once a
// day; also fired opportunistically at the start of every autopilot run.
// ADMIN_AUTOMATION_SECRET.

const Body = z.object({ clientId: z.string().uuid().optional() });

export const Route = createFileRoute("/api/admin/ads-outcome-review")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret)
          return Response.json({ ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" }, { status: 503 });
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });
        try {
          const r = await runOutcomeReview(parsed.data.clientId);
          return Response.json(r);
        } catch (e) {
          return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
        }
      },
    },
  },
});
