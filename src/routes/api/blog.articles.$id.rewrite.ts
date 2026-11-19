import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ladeArtikelRahmen, schreibeNeu } from "@/server/blog-artikel.server";

// Blog-Autopilot: «Neu schreiben». Der Artikel läuft noch einmal durch die
// Pipeline (heutige Schreibregeln und Fakten). Nur Ezy One, nur vor der Freigabe.
const Body = z.object({}).strict();

export const Route = createFileRoute("/api/blog/articles/$id/rewrite")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const r = await ladeArtikelRahmen(request, params.id);
        if (r instanceof Response) return r;
        const parsed = Body.safeParse((await request.json().catch(() => null)) ?? {});
        if (!parsed.success)
          return Response.json({ ok: false, error: "Ungültige Eingabe" }, { status: 400 });
        const out = await schreibeNeu(r);
        return Response.json(out.body, { status: out.status });
      },
    },
  },
});
