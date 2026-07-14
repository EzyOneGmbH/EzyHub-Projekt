import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { submitRecommendations, RECOMMENDATION_TYPES } from "@/server/google-ads-recommendations.server";

// Phase C (Advisory-Brief): Empfehlungen der Analyse-Module ins Massnahmen-
// Register schreiben. Wiedererkennung serverseitig (type + entity, last_seen_run);
// niemals Writes ins Ads-Konto. Server-to-server, ADMIN_AUTOMATION_SECRET.

const Body = z.object({
  clientId: z.string().uuid(),
  runId: z.string().min(1),
  recommendations: z
    .array(
      z.object({
        recommendation_type: z.enum(RECOMMENDATION_TYPES),
        entity: z.string().min(1).max(220),
        title: z.string().min(1).max(180),
        rationale: z.string().max(2400).optional(),
        expected_impact: z.string().max(320).optional(),
      }),
    )
    .max(40),
});

export const Route = createFileRoute("/api/admin/ads-recommendations")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret)
          return Response.json({ ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" }, { status: 503 });
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Invalid input", details: parsed.error.issues.slice(0, 3) }, { status: 400 });

        const r = await submitRecommendations(parsed.data);
        return Response.json(r, { status: r.ok ? 200 : 500 });
      },
    },
  },
});
