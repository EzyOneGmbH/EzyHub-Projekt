import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { blogEvent, istAgentur, requireBlogProject } from "@/server/blog-autopilot.server";

// Schreibregeln (Onboarding Schritt 5, Einstellungen). GET: alle Regeln;
// POST: Regel anlegen (Vorschlag aus der Analyse oder eigener Text).
// An/aus über PATCH /api/blog/rules/:id. Standardregeln sind immer aktiv.

const MAX_AKTIV = 30;

const PostBody = z.object({
  rule: z.string().trim().min(3).max(1000),
  source: z.enum(["onboarding", "agentur"]).default("onboarding"),
});

export const Route = createFileRoute("/api/blog/projects/$id/rules")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const r = await requireBlogProject(request, params.id);
        if (r instanceof Response) return r;
        const { data } = await (supabaseAdmin as any)
          .from("writing_rules")
          .select("id, rule, source, active, created_at")
          .eq("project_id", r.project.id)
          .order("created_at");
        return Response.json({ ok: true, rules: data ?? [] });
      },

      POST: async ({ request, params }) => {
        const r = await requireBlogProject(request, params.id);
        if (r instanceof Response) return r;
        const { ctx, project } = r;
        const parsed = PostBody.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Ungültige Regel" }, { status: 400 });
        if (parsed.data.source === "agentur" && !istAgentur(ctx))
          return Response.json({ ok: false, error: "Nur für Ezy One" }, { status: 403 });

        const { data: alle } = await (supabaseAdmin as any)
          .from("writing_rules")
          .select("id, rule, active")
          .eq("project_id", project.id);
        const liste: any[] = alle ?? [];
        const gleich = liste.find(
          (w) => String(w.rule).trim().toLowerCase() === parsed.data.rule.toLowerCase(),
        );
        if (gleich) {
          if (!gleich.active)
            await (supabaseAdmin as any)
              .from("writing_rules")
              .update({ active: true })
              .eq("id", gleich.id);
          return Response.json({ ok: true, rule: { ...gleich, active: true }, created: false });
        }
        if (liste.filter((w) => w.active).length >= MAX_AKTIV)
          return Response.json(
            { ok: false, error: `Höchstens ${MAX_AKTIV} aktive Regeln` },
            { status: 409 },
          );
        const { data: rule, error } = await (supabaseAdmin as any)
          .from("writing_rules")
          .insert({ project_id: project.id, rule: parsed.data.rule, source: parsed.data.source })
          .select("id, rule, source, active, created_at")
          .single();
        if (error || !rule)
          return Response.json({ ok: false, error: "Speichern fehlgeschlagen" }, { status: 500 });
        await blogEvent(project.id, "rule.created", { source: parsed.data.source }, ctx.userId);
        return Response.json({ ok: true, rule, created: true });
      },
    },
  },
});
