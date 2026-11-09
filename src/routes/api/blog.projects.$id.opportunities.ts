import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireBlogProject } from "@/server/blog-autopilot.server";

// GET /api/blog/projects/:id/opportunities (Kap. 8): letzter Audit (Status,
// Fortschritt, Quellen) und die Chancen des letzten abgeschlossenen Audits.

export const Route = createFileRoute("/api/blog/projects/$id/opportunities")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const r = await requireBlogProject(request, params.id);
        if (r instanceof Response) return r;
        const sb = supabaseAdmin as any;
        const felder =
          "id, status, stage, percent, events, sources, error, trigger, created_at, finished_at";
        const { data: letzter } = await sb
          .from("keyword_audits")
          .select(felder)
          .eq("project_id", r.project.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const { data: fertig } = await sb
          .from("keyword_audits")
          .select(felder)
          .eq("project_id", r.project.id)
          .eq("status", "done")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        let opportunities: any[] = [];
        if (fertig) {
          const { data } = await sb
            .from("keyword_opportunities")
            .select(
              "id, keyword, category, volume, difficulty, avg_position, position_delta, impressions, parent_topic, covered_by_url, cluster, reason, decision",
            )
            .eq("audit_id", fertig.id)
            .order("volume", { ascending: false, nullsFirst: false });
          opportunities = data ?? [];
        }
        const { count } = await sb
          .from("content_items")
          .select("id", { count: "exact", head: true })
          .eq("client_id", r.project.client_id)
          .eq("content_type", "blog")
          .eq("status", "published");
        return Response.json({
          ok: true,
          audit: letzter ?? null,
          ergebnisAudit: fertig ?? null,
          opportunities,
          publizierteArtikel: count ?? 0,
        });
      },
    },
  },
});
