import { createFileRoute } from "@tanstack/react-router";
import { requireBlogProject } from "@/server/blog-autopilot.server";
import { strukturAuswertung } from "@/server/blog-struktur.server";

// GET /api/blog/projects/:id/struktur (Blog-Dashboard «Themen-Autorität» und
// «Interne Verlinkung»): Artikel und offene Chancen je Themen-Cluster sowie
// interne Links je Live-Artikel. Nur Daten des eigenen Projekts. Lesen dürfen
// alle mit Zugriff auf den Blog des Kunden.

export const Route = createFileRoute("/api/blog/projects/$id/struktur")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const r = await requireBlogProject(request, params.id);
        if (r instanceof Response) return r;
        try {
          return Response.json({ ok: true, ...(await strukturAuswertung(r.project)) });
        } catch {
          return Response.json(
            { ok: false, error: "Die Daten lassen sich gerade nicht laden" },
            { status: 502 },
          );
        }
      },
    },
  },
});
