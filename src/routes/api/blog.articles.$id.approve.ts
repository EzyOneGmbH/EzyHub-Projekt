import { createFileRoute } from "@tanstack/react-router";
import { FreigabeBody, freigabe, ladeArtikelRahmen } from "@/server/blog-artikel.server";

// POST /api/blog/articles/:id/approve (Kap. 6.5, 8)
//   {action: "review"}         Ezy One hat geprüft: der Kunde darf freigeben
//   {action: "review_zurueck"} Prüfung zurücknehmen
//   {action: "approve"}        Freigeben (Kunde nach der Prüfung, Ezy One jederzeit);
//                              mit Scope «publish» wird ein neuer Artikel live geschaltet
//   {action: "erledigt"}       von Hand veröffentlicht: Artikel ist live

export const Route = createFileRoute("/api/blog/articles/$id/approve")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const r = await ladeArtikelRahmen(request, params.id);
        if (r instanceof Response) return r;
        const parsed = FreigabeBody.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Ungültige Eingabe" }, { status: 400 });
        const out = await freigabe(r, parsed.data.action);
        return Response.json(out.body, { status: out.status });
      },
    },
  },
});
