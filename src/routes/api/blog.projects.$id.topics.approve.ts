import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { blogEvent, requireBlogProject } from "@/server/blog-autopilot.server";
import { normKw, verteileTermine } from "@/server/blog-audit.server";

// POST /api/blog/projects/:id/topics/approve {opportunityIds} (Kap. 8,
// Onboarding Schritt 7): gewählte Chancen werden freigegebene Themen
// (blog_topics.approved_at); Termine nach Kontingent (articles_per_month,
// Standard 4) auf Werktage verteilt, im Anschluss an bereits geplante Themen.
// Aussortierte Chancen lassen sich nicht freigeben. Kein Artikel ohne Freigabe.

const Body = z.object({ opportunityIds: z.array(z.string().uuid()).min(1).max(100) });

export const Route = createFileRoute("/api/blog/projects/$id/topics/approve")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const r = await requireBlogProject(request, params.id);
        if (r instanceof Response) return r;
        const { ctx, project } = r;
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return Response.json(
            { ok: false, error: "Bitte mindestens ein Thema wählen" },
            { status: 400 },
          );
        const sb = supabaseAdmin as any;
        const { data: opps } = await sb
          .from("keyword_opportunities")
          .select("id, project_id, keyword, category, volume, difficulty, cluster")
          .in("id", parsed.data.opportunityIds);
        const eigene = (opps ?? []).filter((o: any) => o.project_id === project.id);
        if (eigene.length !== new Set(parsed.data.opportunityIds).size)
          return Response.json({ ok: false, error: "Unbekannte Chance" }, { status: 404 });
        if (eigene.some((o: any) => o.category === "aussortiert"))
          return Response.json(
            { ok: false, error: "Aussortierte Themen lassen sich nicht freigeben" },
            { status: 409 },
          );

        const { data: bestehend } = await sb
          .from("blog_topics")
          .select("keyword, scheduled_for")
          .eq("project_id", project.id);
        const schon = new Set((bestehend ?? []).map((t: any) => normKw(t.keyword)));
        const neu = eigene.filter((o: any) => !schon.has(normKw(o.keyword)));
        const letzter = (bestehend ?? [])
          .map((t: any) => t.scheduled_for)
          .filter(Boolean)
          .sort()
          .pop();
        const ab = letzter && new Date(letzter) > new Date() ? new Date(letzter) : new Date();
        // fast vorne zuerst (schnellster Effekt), dann nach Volumen
        neu.sort(
          (a: any, b: any) =>
            Number(b.category === "fast_vorne") - Number(a.category === "fast_vorne") ||
            (b.volume ?? 0) - (a.volume ?? 0),
        );
        const termine = verteileTermine(neu.length, Number(project.articles_per_month ?? 4), ab);
        const jetzt = new Date().toISOString();
        if (neu.length)
          await sb.from("blog_topics").insert(
            neu.map((o: any, i: number) => ({
              project_id: project.id,
              keyword: o.keyword,
              cluster: o.cluster,
              volume: o.volume,
              difficulty: o.difficulty,
              opportunity_id: o.id,
              kind: o.category === "neu" ? "neu" : "refresh",
              approved_at: jetzt,
              approved_by: ctx.userId,
              scheduled_for: termine[i],
            })),
          );
        for (const o of eigene)
          await sb
            .from("keyword_opportunities")
            .update({ decision: o.category === "neu" ? "uebernommen" : "refresh" })
            .eq("id", o.id);
        await blogEvent(
          project.id,
          "onboarding.topics_approved",
          { anzahl: neu.length, erster_termin: termine[0] ?? null },
          ctx.userId,
        );
        return Response.json({ ok: true, neu: neu.length, termine });
      },
    },
  },
});
