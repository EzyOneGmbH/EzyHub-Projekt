import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { blogEvent, requireBlogProject } from "@/server/blog-autopilot.server";

// POST /api/blog/opportunities/:id/decision (Kap. 8): übernehmen, refresh,
// verwerfen (oder zurück auf offen).

const Body = z
  .object({ decision: z.enum(["offen", "uebernommen", "refresh", "verworfen"]) })
  .strict();

export const Route = createFileRoute("/api/blog/opportunities/$id/decision")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!/^[0-9a-f-]{36}$/i.test(params.id))
          return Response.json({ ok: false, error: "Ungültige ID" }, { status: 400 });
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Ungültige Entscheidung" }, { status: 400 });
        const sb = supabaseAdmin as any;
        const { data: opp } = await sb
          .from("keyword_opportunities")
          .select("id, project_id, keyword, category")
          .eq("id", params.id)
          .maybeSingle();
        if (!opp)
          return Response.json({ ok: false, error: "Chance nicht gefunden" }, { status: 404 });
        const r = await requireBlogProject(request, String(opp.project_id));
        if (r instanceof Response)
          return r.status === 401
            ? r
            : Response.json({ ok: false, error: "Chance nicht gefunden" }, { status: 404 });
        await sb
          .from("keyword_opportunities")
          .update({ decision: parsed.data.decision })
          .eq("id", opp.id);
        await blogEvent(
          opp.project_id,
          "opportunity.decision",
          { id: opp.id, decision: parsed.data.decision },
          r.ctx.userId,
        );
        return Response.json({ ok: true, opportunity: { ...opp, decision: parsed.data.decision } });
      },
    },
  },
});
