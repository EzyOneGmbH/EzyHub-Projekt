import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { blogEvent, requireBlogProject } from "@/server/blog-autopilot.server";

// POST /api/blog/projects/:id/events: Onboarding-Ereignisse aus dem Browser
// (Kap. 6A «Ereignisse im Onboarding»), damit Abbruchstellen sichtbar werden.
// Nur erlaubte Typen, kleine Nutzlast; serverseitige Ereignisse (Analyse,
// WordPress-Test, Freigabe) schreibt der Server selbst.

const ERLAUBT = [
  "onboarding.step_viewed",
  "onboarding.step_completed",
  "onboarding.ga4_skipped",
] as const;

const Body = z.object({
  type: z.enum(ERLAUBT),
  payload: z
    .object({
      step: z.number().int().min(1).max(8).optional(),
      dauer_ms: z.number().int().min(0).max(86_400_000).optional(),
    })
    .strict()
    .default({}),
});

export const Route = createFileRoute("/api/blog/projects/$id/events")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const r = await requireBlogProject(request, params.id);
        if (r instanceof Response) return r;
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Ungültiges Ereignis" }, { status: 400 });
        await blogEvent(r.project.id, parsed.data.type, parsed.data.payload, r.ctx.userId);
        return Response.json({ ok: true });
      },
    },
  },
});
