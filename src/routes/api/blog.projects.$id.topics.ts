import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { blogEvent, istAgentur, requireBlogProject } from "@/server/blog-autopilot.server";
import { normKw } from "@/server/blog-audit.server";

// GET /api/blog/projects/:id/topics: freigegebene Themen mit Termin
// (Themenplan, Onboarding Schritt 8).
// POST: ein Thema von Hand planen (fester Themenplan aus einer Strategie).
// Nur die Agentur; das Thema gilt als freigegeben und wird am Termin
// geschrieben wie jedes andere. Mit { topics: [...] } ein ganzer Plan auf
// einmal (höchstens 24); schon geplante Themen werden übersprungen.

const text = (max: number) => z.string().trim().max(max).optional();
const Manuell = z.object({
  title: z.string().trim().min(3).max(200),
  keyword: text(120),
  audience: text(300),
  target_question: text(300),
  citable_element: text(500),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const Liste = z.object({ topics: z.array(Manuell).min(1).max(24) });

export const Route = createFileRoute("/api/blog/projects/$id/topics")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const r = await requireBlogProject(request, params.id);
        if (r instanceof Response) return r;
        const { data } = await (supabaseAdmin as any)
          .from("blog_topics")
          .select(
            "id, keyword, cluster, article_type, volume, difficulty, kind, approved_at, scheduled_for, opportunity_id",
          )
          .eq("project_id", r.project.id)
          .order("scheduled_for", { ascending: true });
        return Response.json({ ok: true, topics: data ?? [], agentur: istAgentur(r.ctx) });
      },
      POST: async ({ request, params }) => {
        const r = await requireBlogProject(request, params.id);
        if (r instanceof Response) return r;
        const { ctx, project } = r;
        if (!istAgentur(ctx))
          return Response.json({ ok: false, error: "Kein Zugriff" }, { status: 403 });
        const body = await request.json().catch(() => null);
        // Ein Thema oder ein ganzer Plan ({ topics: [...] }, z. B. zwölf Monate).
        const mehrere = Array.isArray(body?.topics);
        const parsed = mehrere ? Liste.safeParse(body) : Manuell.safeParse(body);
        const eingabe: z.infer<typeof Manuell>[] = !parsed.success
          ? []
          : mehrere
            ? (parsed.data as z.infer<typeof Liste>).topics
            : [parsed.data as z.infer<typeof Manuell>];
        if (!eingabe.length || eingabe.some((e) => Number.isNaN(Date.parse(e.date))))
          return Response.json(
            {
              ok: false,
              error: mehrere
                ? "Bitte für jedes Thema Titel und Datum angeben (höchstens 24 Themen)"
                : "Bitte Titel und Datum angeben",
            },
            { status: 400 },
          );
        const sb = supabaseAdmin as any;
        const { data: bestehend } = await sb
          .from("blog_topics")
          .select("keyword")
          .eq("project_id", project.id);
        const schon = new Set((bestehend ?? []).map((t: any) => normKw(t.keyword)));
        const zeilen: any[] = [];
        for (const e of eingabe) {
          const keyword = e.keyword || e.title;
          if (schon.has(normKw(keyword))) continue;
          schon.add(normKw(keyword));
          zeilen.push({
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
          });
        }
        const doppelt = eingabe.length - zeilen.length;
        if (!zeilen.length)
          return Response.json(
            {
              ok: false,
              error: mehrere ? "Diese Themen sind schon geplant" : "Dieses Thema ist schon geplant",
            },
            { status: 409 },
          );
        const { data: neu, error } = await sb.from("blog_topics").insert(zeilen).select();
        if (error || !neu?.length)
          return Response.json(
            { ok: false, error: "Das Thema liess sich nicht speichern" },
            { status: 500 },
          );
        await blogEvent(
          project.id,
          "topics.manual",
          mehrere ? { anzahl: zeilen.length } : { termin: zeilen[0].scheduled_for },
          ctx.userId,
        );
        return Response.json({ ok: true, id: neu[0].id, neu: zeilen.length, doppelt });
      },
    },
  },
});
