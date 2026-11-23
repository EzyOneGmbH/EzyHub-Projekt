import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  blogEvent,
  istAgentur,
  mitWordpress,
  requireBlogProject,
} from "@/server/blog-autopilot.server";

// POST /api/blog/projects/:id/start {pause?}
// Ohne Angabe (Onboarding Schritt 8): Autopilot aktiv. Voraussetzungen:
// WordPress verbunden (oder «nur in EzyHub») und mindestens ein freigegebenes
// Thema.
// Automatik aus/ein (nur Agentur): {pause: true} setzt ein eingerichtetes
// Projekt auf «paused» – der Blog bleibt sichtbar, es wird aber nichts von
// selbst geschrieben oder geprüft. Ohne Angabe schaltet die Agentur ein
// pausiertes Projekt wieder ein.

const Body = z.object({ pause: z.boolean().optional() }).strict();

export const Route = createFileRoute("/api/blog/projects/$id/start")({
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
        const antwort = async () => {
          const { data: neu } = await sb
            .from("blog_projects")
            .select("*")
            .eq("id", project.id)
            .maybeSingle();
          return Response.json({ ok: true, project: await mitWordpress(neu ?? project) });
        };
        const nurAgentur = () =>
          Response.json(
            { ok: false, error: "Die Automatik schaltet nur die Agentur ein oder aus" },
            { status: 403 },
          );

        if (parsed.data.pause) {
          if (!istAgentur(ctx)) return nurAgentur();
          if (project.status === "onboarding")
            return Response.json(
              { ok: false, error: "Die Einrichtung ist noch nicht abgeschlossen" },
              { status: 409 },
            );
          if (project.status !== "paused") {
            await sb.from("blog_projects").update({ status: "paused" }).eq("id", project.id);
            await blogEvent(project.id, "autopilot.paused", {}, ctx.userId);
          }
          return antwort();
        }

        // Ein pausiertes Projekt hat die Agentur bewusst stillgelegt.
        if (project.status === "paused" && !istAgentur(ctx)) return nurAgentur();
        const p = await mitWordpress(project);
        if (project.publish_mode !== "hub_only" && p.wordpress?.status !== "verbunden")
          return Response.json(
            { ok: false, error: "WordPress ist noch nicht verbunden" },
            { status: 409 },
          );
        const { data: themen } = await sb
          .from("blog_topics")
          .select("id")
          .eq("project_id", project.id)
          .not("approved_at", "is", null)
          .limit(1);
        if (!themen?.length)
          return Response.json(
            { ok: false, error: "Noch kein Thema freigegeben" },
            { status: 409 },
          );
        if (project.status === "paused") {
          await sb.from("blog_projects").update({ status: "active" }).eq("id", project.id);
          await blogEvent(project.id, "autopilot.resumed", {}, ctx.userId);
        } else if (project.status !== "active") {
          await sb
            .from("blog_projects")
            .update({ status: "active", onboarding_step: 8 })
            .eq("id", project.id);
          await blogEvent(
            project.id,
            "onboarding.completed",
            { dauer_ms: Date.now() - new Date(project.created_at).getTime() },
            ctx.userId,
          );
        }
        return antwort();
      },
    },
  },
});
