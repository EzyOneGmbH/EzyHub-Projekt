import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireBlogProject } from "@/server/blog-autopilot.server";

// GET /api/blog/analysis/:runId (Kap. 6.1): Status, Fortschritt, Agent-Log und
// Ergebnis einer Website-Analyse. Der Assistent fragt alle 2 s ab. Der rohe
// Zwischenstand (gelesene Seiten) bleibt serverseitig.

export const Route = createFileRoute("/api/blog/analysis/$runId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!/^[0-9a-f-]{36}$/i.test(params.runId))
          return Response.json({ ok: false, error: "Ungültige ID" }, { status: 400 });
        const { data: run } = await (supabaseAdmin as any)
          .from("blog_analysis_runs")
          .select(
            "id, project_id, status, stage, percent, events, result, error, attempts, created_at, started_at, finished_at",
          )
          .eq("id", params.runId)
          .maybeSingle();
        if (!run)
          return Response.json({ ok: false, error: "Analyse nicht gefunden" }, { status: 404 });
        const r = await requireBlogProject(request, String(run.project_id));
        if (r instanceof Response)
          return r.status === 401
            ? r
            : Response.json({ ok: false, error: "Analyse nicht gefunden" }, { status: 404 });
        return Response.json({ ok: true, run });
      },
    },
  },
});
