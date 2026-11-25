import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireBlogProject } from "@/server/blog-autopilot.server";
import { starteOptimierung } from "@/server/blog-optimierung.server";

// POST /api/blog/projects/:id/optimize {articleId}: «Mit KI optimieren». Legt
// für einen veröffentlichten Artikel eine Überarbeitung an (nur Ezy One); der
// Worker schreibt sie im nächsten Takt, geprüft wird sie im Editor.

const Body = z.object({ articleId: z.string().uuid() }).strict();

export const Route = createFileRoute("/api/blog/projects/$id/optimize")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const r = await requireBlogProject(request, params.id);
        if (r instanceof Response) return r;
        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Ungültige Eingabe" }, { status: 400 });
        const a = await starteOptimierung(r.project, r.ctx, parsed.data.articleId);
        return Response.json(a.body, { status: a.status });
      },
    },
  },
});
