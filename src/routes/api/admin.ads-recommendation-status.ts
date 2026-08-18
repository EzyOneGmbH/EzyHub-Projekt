import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { setRecommendationStatus } from "@/server/google-ads-recommendations.server";

// Phase C: Statuspflege des Massnahmen-Registers (Uebergangskommando fuer
// n8n/Claude). Schreibt NUR Status-Felder (DB-Trigger erzwingt das), nie ins
// Ads-Konto. Server-to-server, ADMIN_AUTOMATION_SECRET.

const Body = z.object({
  id: z.string().uuid(),
  status: z.enum(["implemented", "dismissed", "superseded"]),
  by: z.string().max(160).optional(),
  note: z.string().max(600).optional(),
});

export const Route = createFileRoute("/api/admin/ads-recommendation-status")({
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

        const r = await setRecommendationStatus(parsed.data);
        return Response.json(r, { status: r.httpStatus });
      },
    },
  },
});
