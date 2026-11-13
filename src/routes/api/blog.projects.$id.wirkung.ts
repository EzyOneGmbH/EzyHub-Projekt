import { createFileRoute } from "@tanstack/react-router";
import { requireBlogProject } from "@/server/blog-autopilot.server";
import { wirkungAuswertung } from "@/server/blog-wirkung.server";

// GET /api/blog/projects/:id/wirkung (Blog-Dashboard «Wirkung je Artikel»):
// Klicks, Impressionen und Position je Live-Artikel in den ersten Tagen nach
// dem Live-Gang, bei Überarbeitungen im Vergleich zu den Tagen davor. Ohne
// Search Console: { verbunden: false }, kein Fehler. Lesen dürfen alle mit
// Zugriff auf den Blog des Kunden.

export const Route = createFileRoute("/api/blog/projects/$id/wirkung")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const r = await requireBlogProject(request, params.id);
        if (r instanceof Response) return r;
        try {
          return Response.json({ ok: true, ...(await wirkungAuswertung(r.project)) });
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
