import { createFileRoute } from "@tanstack/react-router";
import { requireBlogProject } from "@/server/blog-autopilot.server";
import { kiAuswertung } from "@/server/blog-ki.server";

// GET /api/blog/projects/:id/ki (Blog-Dashboard «KI-Sichtbarkeit»): Kennzahlen
// der letzten KI-Messung des Kunden und je Live-Artikel, welche KI-Systeme ihn
// bei welcher Frage als Quelle nennen. Ohne Messung: { gemessen: false }, kein
// Fehler. Lesen dürfen alle mit Zugriff auf den Blog des Kunden.

export const Route = createFileRoute("/api/blog/projects/$id/ki")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const r = await requireBlogProject(request, params.id);
        if (r instanceof Response) return r;
        try {
          return Response.json({ ok: true, ...(await kiAuswertung(r.project)) });
        } catch {
          return Response.json(
            { ok: false, error: "Die KI-Daten lassen sich gerade nicht laden" },
            { status: 502 },
          );
        }
      },
    },
  },
});
