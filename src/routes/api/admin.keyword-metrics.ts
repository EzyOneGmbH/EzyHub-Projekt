import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { fetchKeywordMetrics } from "@/server/keyword-metrics.server";

// Keyword-Suchvolumen aus dem Google Ads Keyword Planner fuer den agent-service
// (2026-09-09, DataForSEO-Ablösung fuer Volumen): /keyword-volume und die
// INT-US-Volumen im Rank-Store rufen diese Route mit ADMIN_AUTOMATION_SECRET.
// Logik in src/server/keyword-metrics.server.ts (geteilt mit jobGscQueries).

const Body = z.object({
  keywords: z.array(z.string().min(1)).min(1).max(2000),
  location: z.number().int().positive().default(2756),
  language: z.string().min(2).max(5).default("de"),
});

export const Route = createFileRoute("/api/admin/keyword-metrics")({
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
          return Response.json(
            { ok: false, error: "Invalid input", details: parsed.error.issues },
            { status: 400 },
          );
        const { keywords, location, language } = parsed.data;
        const result = await fetchKeywordMetrics(keywords, location, language);
        return Response.json(result, {
          status: result.ok ? 200 : 502,
          headers: { "Cache-Control": "no-store" },
        });
      },
    },
  },
});
