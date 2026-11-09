import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireBlogProject } from "@/server/blog-autopilot.server";

// GET /api/blog/projects/:id/topics: freigegebene Themen mit Termin
// (Themenplan, Onboarding Schritt 8).
export const Route = createFileRoute("/api/blog/projects/$id/topics")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const r = await requireBlogProject(request, params.id);
        if (r instanceof Response) return r;
        const { data } = await (supabaseAdmin as any)
          .from("blog_topics")
          .select(
            "id, keyword, cluster, article_type, volume, difficulty, kind, approved_at, scheduled_for",
          )
          .eq("project_id", r.project.id)
          .order("scheduled_for", { ascending: true });
        return Response.json({ ok: true, topics: data ?? [] });
      },
    },
  },
});
