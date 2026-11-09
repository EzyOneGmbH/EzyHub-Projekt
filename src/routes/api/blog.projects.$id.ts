import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  blogEvent,
  istAgentur,
  mitWordpress,
  NUR_AGENTUR,
  ProjektPatch,
  requireBlogProject,
} from "@/server/blog-autopilot.server";

// PATCH /api/blog/projects/:id (Kap. 8): Felder aus Onboarding-Schritten 3–5
// und den Einstellungen. Nur bekannte Felder (strict); Kontingent und
// Ahrefs-Limit nur für Ezy-One-Rollen. Status-Wechsel laufen über eigene
// Endpunkte (Start, Pause), nicht hierüber.

export const Route = createFileRoute("/api/blog/projects/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const r = await requireBlogProject(request, params.id);
        if (r instanceof Response) return r;
        return Response.json({ ok: true, project: await mitWordpress(r.project) });
      },

      PATCH: async ({ request, params }) => {
        const r = await requireBlogProject(request, params.id);
        if (r instanceof Response) return r;
        const { ctx, project } = r;
        const parsed = ProjektPatch.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return Response.json(
            {
              ok: false,
              error: "Ungültige Eingabe",
              felder: parsed.error.issues.map((i) => i.path.join(".")),
            },
            { status: 400 },
          );
        const patch: Record<string, unknown> = { ...parsed.data };
        if (!istAgentur(ctx) && NUR_AGENTUR.some((k) => k in patch))
          return Response.json(
            { ok: false, error: "Kontingent und Limits setzt Ezy One" },
            { status: 403 },
          );
        if (Object.keys(patch).length === 0)
          return Response.json({ ok: true, project: await mitWordpress(project) });

        const { error } = await (supabaseAdmin as any)
          .from("blog_projects")
          .update(patch)
          .eq("id", project.id);
        if (error)
          return Response.json({ ok: false, error: "Speichern fehlgeschlagen" }, { status: 500 });
        await blogEvent(project.id, "project.updated", { felder: Object.keys(patch) }, ctx.userId);
        const { data: neu } = await (supabaseAdmin as any)
          .from("blog_projects")
          .select("*")
          .eq("id", project.id)
          .maybeSingle();
        return Response.json({ ok: true, project: await mitWordpress(neu ?? project) });
      },
    },
  },
});
