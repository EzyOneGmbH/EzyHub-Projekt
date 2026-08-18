import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { runAutopilot } from "@/server/google-ads-autopilot.server";

// Triggers one Google Ads Autopilot run for a client. Server-to-server
// (n8n / ezy-cron / agent-service), protected by ADMIN_AUTOMATION_SECRET like
// the other /api/admin/* automation routes. dryRun defaults to true (safe):
// nothing is written unless dryRun=false AND the client's autonomy_level >= 1.

const Body = z.object({ clientId: z.string().uuid(), dryRun: z.boolean().optional() });

export const Route = createFileRoute("/api/admin/ads-autopilot-run")({
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

        try {
          const summary = await runAutopilot(parsed.data.clientId, { dryRun: parsed.data.dryRun });
          return Response.json(summary);
        } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 500 },
          );
        }
      },
    },
  },
});
