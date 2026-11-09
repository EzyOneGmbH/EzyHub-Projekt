import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { blogEvent, mitWordpress, requireBlogProject } from "@/server/blog-autopilot.server";

// POST /api/blog/projects/:id/start (Onboarding Schritt 8): Autopilot aktiv.
// Voraussetzungen: WordPress verbunden (oder «nur in EzyHub») und mindestens
// ein freigegebenes Thema.

export const Route = createFileRoute("/api/blog/projects/$id/start")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const r = await requireBlogProject(request, params.id);
        if (r instanceof Response) return r;
        const { ctx, project } = r;
        const sb = supabaseAdmin as any;
        const p = await mitWordpress(project);
        if (project.publish_mode !== "hub_only" && p.wordpress?.status !== "verbunden")
          return Response.json(
            { ok: false, error: "WordPress ist noch nicht verbunden" },
            { status: 409 },
          );
        const { data: themen } = await sb
          .from("blog_topics")
          .select("id")
          .eq("project_id", project.id)
          .not("approved_at", "is", null)
          .limit(1);
        if (!themen?.length)
          return Response.json(
            { ok: false, error: "Noch kein Thema freigegeben" },
            { status: 409 },
          );
        if (project.status !== "active") {
          await sb
            .from("blog_projects")
            .update({ status: "active", onboarding_step: 8 })
            .eq("id", project.id);
          await blogEvent(
            project.id,
            "onboarding.completed",
            { dauer_ms: Date.now() - new Date(project.created_at).getTime() },
            ctx.userId,
          );
        }
        const { data: neu } = await sb
          .from("blog_projects")
          .select("*")
          .eq("id", project.id)
          .maybeSingle();
        return Response.json({ ok: true, project: await mitWordpress(neu ?? project) });
      },
    },
  },
});
