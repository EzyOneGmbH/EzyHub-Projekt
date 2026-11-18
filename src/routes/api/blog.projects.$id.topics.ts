import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { blogEvent, istAgentur, requireBlogProject } from "@/server/blog-autopilot.server";
import { normKw } from "@/server/blog-audit.server";

// GET /api/blog/projects/:id/topics: freigegebene Themen mit Termin
// (Themenplan, Onboarding Schritt 8).
// POST: ein Thema von Hand planen (fester Themenplan aus einer Strategie).
// Nur die Agentur; das Thema gilt als freigegeben und wird am Termin
// geschrieben wie jedes andere.

const text = (max: number) => z.string().trim().max(max).optional();
const Manuell = z.object({
  title: z.string().trim().min(3).max(200),
  keyword: text(120),
  audience: text(300),
  target_question: text(300),
  citable_element: text(500),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

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
      POST: async ({ request, params }) => {
        const r = await requireBlogProject(request, params.id);
        if (r instanceof Response) return r;
        const { ctx, project } = r;
        if (!istAgentur(ctx))
          return Response.json({ ok: false, error: "Kein Zugriff" }, { status: 403 });
        const parsed = Manuell.safeParse(await request.json().catch(() => null));
        if (!parsed.success || Number.isNaN(Date.parse(parsed.data.date)))
          return Response.json(
            { ok: false, error: "Bitte Titel und Datum angeben" },
            { status: 400 },
          );
        const e = parsed.data;
        const keyword = e.keyword || e.title;
        const sb = supabaseAdmin as any;
        const { data: bestehend } = await sb
          .from("blog_topics")
          .select("keyword")
          .eq("project_id", project.id);
        if ((bestehend ?? []).some((t: any) => normKw(t.keyword) === normKw(keyword)))
          return Response.json(
            { ok: false, error: "Dieses Thema ist schon geplant" },
            { status: 409 },
          );
        const { data: neu, error } = await sb
          .from("blog_topics")
          .insert({
            project_id: project.id,
            keyword,
            title: e.title,
            audience: e.audience || null,
            target_question: e.target_question || null,
            citable_element: e.citable_element || null,
            kind: "neu",
            approved_at: new Date().toISOString(),
            approved_by: ctx.userId,
            scheduled_for: e.date,
          })
          .select()
          .single();
        if (error || !neu)
          return Response.json(
            { ok: false, error: "Das Thema liess sich nicht speichern" },
            { status: 500 },
          );
        await blogEvent(project.id, "topics.manual", { termin: e.date }, ctx.userId);
        return Response.json({ ok: true, id: neu.id });
      },
    },
  },
});
