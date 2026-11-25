import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { istAgentur, requireBlogProject } from "@/server/blog-autopilot.server";
import { baueListe } from "@/server/blog-optimierung.server";

// GET /api/blog/projects/:id/optimierung: alle veröffentlichten Blogartikel des
// Kunden mit Einschätzung (Optimieren / Auffrischen / In Ordnung) und dem Stand
// einer laufenden Überarbeitung.

export const Route = createFileRoute("/api/blog/projects/$id/optimierung")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const r = await requireBlogProject(request, params.id);
        if (r instanceof Response) return r;
        const sb = supabaseAdmin as any;
        const { data: articles } = await sb
          .from("blog_articles")
          .select(
            "id, status, title, wp_permalink, published_at, created_at, modus:job->>modus, herkunft:job->>herkunft, review:job->review, opt_url:job->optimierung->>url, brief_url:job->brief->>original_url",
          )
          .eq("project_id", r.project.id)
          .limit(2000);
        const { data: audit } = await sb
          .from("keyword_audits")
          .select("id")
          .eq("project_id", r.project.id)
          .eq("status", "done")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const { data: opps } = audit
          ? await sb
              .from("keyword_opportunities")
              .select("keyword, category, avg_position, impressions, covered_by_url")
              .eq("audit_id", audit.id)
              .eq("category", "fast_vorne")
          : { data: [] };
        const { data: items } = await sb
          .from("content_items")
          .select("target_url, title, published_at, last_refresh_at, index_verdict")
          .eq("client_id", r.project.client_id)
          .eq("content_type", "blog")
          .eq("status", "published")
          .limit(5000);
        const artikel = baueListe({
          articles: articles ?? [],
          opps: opps ?? [],
          items: items ?? [],
          kunde: !istAgentur(r.ctx),
          heute: new Date(),
        });
        return Response.json({ ok: true, artikel });
      },
    },
  },
});
