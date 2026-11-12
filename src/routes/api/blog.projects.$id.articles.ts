import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { istAgentur, requireBlogProject } from "@/server/blog-autopilot.server";

// GET /api/blog/projects/:id/articles (Kap. 8 «Kalender»): Artikel (nur
// Kopfdaten, ohne Inhalt) und freigegebene Themen ohne Artikel, nach Termin.

const KOPF =
  "id, topic_id, status, stage, title, focus_keyword, word_count, scheduled_for, wp_post_id, wp_edit_url, wp_permalink, error, attempts, modus:job->>modus, pruefung:job->pruefung, review:job->review, bearbeitet:job->bearbeitet, wordpress:job->wordpress, created_at, updated_at, finished_at";

export const Route = createFileRoute("/api/blog/projects/$id/articles")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const r = await requireBlogProject(request, params.id);
        if (r instanceof Response) return r;
        const sb = supabaseAdmin as any;
        const [{ data: artikel }, { data: themen }] = await Promise.all([
          sb
            .from("blog_articles")
            .select(KOPF)
            .eq("project_id", r.project.id)
            .order("scheduled_for", { ascending: true, nullsFirst: false })
            .limit(200),
          sb
            .from("blog_topics")
            .select("id, keyword, kind, scheduled_for, cluster")
            .eq("project_id", r.project.id)
            .not("approved_at", "is", null)
            .order("scheduled_for", { ascending: true, nullsFirst: false })
            .limit(200),
        ]);
        const mitArtikel = new Set((artikel ?? []).map((a: any) => a.topic_id));
        return Response.json({
          ok: true,
          articles: artikel ?? [],
          geplant: (themen ?? []).filter((t: any) => !mitArtikel.has(t.id)),
          agentur: istAgentur(r.ctx),
          kontingent: r.project.articles_per_month ?? null,
        });
      },
    },
  },
});
