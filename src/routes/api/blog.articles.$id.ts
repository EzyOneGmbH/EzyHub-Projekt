import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireBlogProject } from "@/server/blog-autopilot.server";

// GET /api/blog/articles/:id (Kap. 9 «Artikel prüfen»): Artikel mit
// Faktencheck-Behauptungen. Der interne Job-Zwischenstand (Brief, Recherche,
// Rohentwurf) bleibt draussen: nur Modus, Prüfung und Quellen.

export const Route = createFileRoute("/api/blog/articles/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!/^[0-9a-f-]{36}$/i.test(params.id))
          return Response.json({ ok: false, error: "Ungültige ID" }, { status: 400 });
        const sb = supabaseAdmin as any;
        const { data: a } = await sb
          .from("blog_articles")
          .select("*")
          .eq("id", params.id)
          .maybeSingle();
        if (!a)
          return Response.json({ ok: false, error: "Artikel nicht gefunden" }, { status: 404 });
        const r = await requireBlogProject(request, String(a.project_id));
        if (r instanceof Response)
          return r.status === 401
            ? r
            : Response.json({ ok: false, error: "Artikel nicht gefunden" }, { status: 404 });
        const { data: claims } = await sb
          .from("article_claims")
          .select("id, claim_text, claim_type, source_url, status, note")
          .eq("article_id", a.id)
          .order("created_at", { ascending: true });
        const { job, locked_until: _lock, ...rest } = a;
        return Response.json({
          ok: true,
          article: {
            ...rest,
            modus: job?.modus ?? "neu",
            original_url: job?.brief?.original_url ?? null,
            pruefung: job?.pruefung ?? null,
            quellen: (job?.recherche?.quellen ?? []).map((q: any) => ({
              url: q.url,
              titel: q.titel,
            })),
          },
          claims: claims ?? [],
        });
      },
    },
  },
});
