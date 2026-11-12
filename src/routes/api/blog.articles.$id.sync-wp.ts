import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { istAgentur } from "@/server/blog-autopilot.server";
import {
  fuerKundeSichtbar,
  ladeArtikelRahmen,
  pruefeWpStatus,
  sendeAenderungen,
} from "@/server/blog-artikel.server";

// POST /api/blog/articles/:id/sync-wp (Kap. 6.5, 8)
//   {mode: "senden"} (Standard): «Änderungen an WordPress senden», gleicher
//     Entwurf, Kommentare und Pings bleiben geschlossen. Nur Ezy One.
//   {mode: "status"}: Status des Beitrags in WordPress abgleichen.

const Body = z.object({ mode: z.enum(["senden", "status"]).default("senden") }).strict();

export const Route = createFileRoute("/api/blog/articles/$id/sync-wp")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const r = await ladeArtikelRahmen(request, params.id);
        if (r instanceof Response) return r;
        const parsed = Body.safeParse((await request.json().catch(() => null)) ?? {});
        if (!parsed.success)
          return Response.json({ ok: false, error: "Ungültige Eingabe" }, { status: 400 });
        if (!istAgentur(r.ctx) && !fuerKundeSichtbar(r.article))
          return Response.json(
            { ok: false, error: "Ezy One prüft den Artikel noch" },
            { status: 403 },
          );
        const out =
          parsed.data.mode === "status" ? await pruefeWpStatus(r) : await sendeAenderungen(r);
        return Response.json(out.body, { status: out.status });
      },
    },
  },
});
