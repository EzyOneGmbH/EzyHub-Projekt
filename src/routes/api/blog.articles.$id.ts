import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { istAgentur } from "@/server/blog-autopilot.server";
import {
  ArtikelPatch,
  artikelSicht,
  bearbeiteArtikel,
  fuerKundeSichtbar,
  kannVeroeffentlichen,
  ladeArtikelRahmen,
} from "@/server/blog-artikel.server";

// GET /api/blog/articles/:id (Kap. 9 «Artikel prüfen»): Artikel mit
// Faktencheck-Behauptungen. Der interne Job-Zwischenstand (Brief, Recherche,
// Rohentwurf) bleibt draussen: nur Modus, Prüfung, Freigabe und Quellen.
// PATCH: Titel, SEO-Felder und Text bearbeiten (nur Ezy One, Kap. 8).

export const Route = createFileRoute("/api/blog/articles/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const r = await ladeArtikelRahmen(request, params.id);
        if (r instanceof Response) return r;
        const { article, project, ctx } = r;
        const agentur = istAgentur(ctx);
        if (!agentur && !fuerKundeSichtbar(article))
          return Response.json(
            { ok: false, error: "Ezy One prüft den Artikel noch" },
            { status: 403 },
          );
        const sb = supabaseAdmin as any;
        const [{ data: claims }, { data: wp }] = await Promise.all([
          sb
            .from("article_claims")
            .select("id, claim_text, claim_type, source_url, status, note")
            .eq("article_id", article.id)
            .order("created_at", { ascending: true }),
          // Bewusst ohne key_enc: nur Status und Rechte der Verbindung.
          sb
            .from("wp_connections")
            .select("status, scopes")
            .eq("project_id", project.id)
            .maybeSingle(),
        ]);
        const scopes: string[] = Array.isArray(wp?.scopes) ? wp.scopes : [];
        return Response.json({
          ok: true,
          article: artikelSicht(article, project),
          claims: claims ?? [],
          agentur,
          wp: {
            verbunden: !!wp,
            status: wp?.status ?? null,
            kann_veroeffentlichen: kannVeroeffentlichen(article, project, scopes),
          },
        });
      },

      PATCH: async ({ request, params }) => {
        const r = await ladeArtikelRahmen(request, params.id);
        if (r instanceof Response) return r;
        const parsed = ArtikelPatch.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Ungültige Eingabe" }, { status: 400 });
        const out = await bearbeiteArtikel(r, parsed.data);
        return Response.json(out.body, { status: out.status });
      },
    },
  },
});
