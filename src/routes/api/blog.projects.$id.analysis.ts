import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { blogEvent, requireBlogProject, websiteErreichbar } from "@/server/blog-autopilot.server";

// POST /api/blog/projects/:id/analysis (Kap. 6.1): Website-Analyse anlegen.
// Läuft im minütlichen Worker; ein offener Lauf wird zurückgegeben statt
// doppelt gestartet. Status über GET /api/blog/analysis/:runId.

export const Route = createFileRoute("/api/blog/projects/$id/analysis")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const r = await requireBlogProject(request, params.id);
        if (r instanceof Response) return r;
        const { ctx, project } = r;
        const { data: offen } = await (supabaseAdmin as any)
          .from("blog_analysis_runs")
          .select("id, status, percent")
          .eq("project_id", project.id)
          .in("status", ["queued", "running"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (offen) return Response.json({ ok: true, run: offen, bereitsLaufend: true });
        const erreichbar = await websiteErreichbar(project.domain);
        if (!erreichbar.ok)
          return Response.json({ ok: false, error: erreichbar.grund }, { status: 422 });
        const { data: run, error } = await (supabaseAdmin as any)
          .from("blog_analysis_runs")
          .insert({ project_id: project.id, created_by: ctx.userId })
          .select("id, status, percent")
          .single();
        if (error || !run)
          return Response.json(
            { ok: false, error: "Analyse konnte nicht gestartet werden" },
            { status: 500 },
          );
        await blogEvent(project.id, "analysis.started", { run_id: run.id }, ctx.userId);
        return Response.json({ ok: true, run, bereitsLaufend: false });
      },
    },
  },
});
