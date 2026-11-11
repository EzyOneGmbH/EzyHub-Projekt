import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireBlogProject } from "@/server/blog-autopilot.server";
import { legeArtikelAn, MAX_PARALLEL } from "@/server/blog-pipeline.server";

// POST /api/blog/projects/:id/write-now {topicId?} (Kap. 8 «Sofort schreiben»,
// Onboarding Schritt 8 «Ersten Artikel jetzt schreiben»): legt für das Thema
// (ohne Angabe: nächstes freigegebenes Thema ohne Artikel) einen Artikel an;
// der Worker schreibt ihn im nächsten Takt. Nie ohne freigegebenes Thema.

const Body = z.object({ topicId: z.string().uuid().optional() }).strict();

export const Route = createFileRoute("/api/blog/projects/$id/write-now")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const r = await requireBlogProject(request, params.id);
        if (r instanceof Response) return r;
        const { ctx, project } = r;
        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Ungültige Eingabe" }, { status: 400 });
        const sb = supabaseAdmin as any;
        if (project.status !== "active")
          return Response.json(
            { ok: false, error: "Der Autopilot ist noch nicht gestartet" },
            { status: 409 },
          );
        const { data: laufend } = await sb
          .from("blog_articles")
          .select("id")
          .eq("project_id", project.id)
          .in("status", ["freigegeben", "schreibt"]);
        if ((laufend?.length ?? 0) >= MAX_PARALLEL)
          return Response.json(
            { ok: false, error: "Es werden bereits Artikel geschrieben. Bitte kurz warten." },
            { status: 429 },
          );
        let q = sb
          .from("blog_topics")
          .select("*")
          .eq("project_id", project.id)
          .not("approved_at", "is", null)
          .order("scheduled_for", { ascending: true, nullsFirst: false })
          .limit(50);
        if (parsed.data.topicId) q = q.eq("id", parsed.data.topicId);
        const { data: themen } = await q;
        if (!themen?.length)
          return Response.json(
            { ok: false, error: "Kein freigegebenes Thema gefunden" },
            { status: 404 },
          );
        const { data: vorhanden } = await sb
          .from("blog_articles")
          .select("id, topic_id, status")
          .in(
            "topic_id",
            themen.map((t: any) => t.id),
          );
        const schon = new Map((vorhanden ?? []).map((a: any) => [a.topic_id, a]));
        const topic = themen.find((t: any) => !schon.has(t.id));
        if (!topic)
          return Response.json(
            {
              ok: false,
              error: "Zu diesem Thema gibt es bereits einen Artikel",
              article: schon.get(themen[0].id) ?? null,
            },
            { status: 409 },
          );
        const article = await legeArtikelAn(topic, "manuell", ctx.userId);
        if (!article)
          return Response.json(
            { ok: false, error: "Zu diesem Thema gibt es bereits einen Artikel" },
            { status: 409 },
          );
        return Response.json({
          ok: true,
          article: {
            id: article.id,
            status: article.status,
            topic_id: topic.id,
            keyword: topic.keyword,
          },
        });
      },
    },
  },
});
