import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { blogEvent, requireBlogProject } from "@/server/blog-autopilot.server";

// POST /api/blog/projects/:id/audit (Kap. 6.2): KI-Audit starten (Onboarding
// Schritt 7 oder «Audit neu starten»). Läuft im minütlichen Worker; ein
// offener Audit wird zurückgegeben statt doppelt gestartet.

const Body = z.object({ trigger: z.enum(["onboarding", "manuell"]).default("manuell") });

export const Route = createFileRoute("/api/blog/projects/$id/audit")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const r = await requireBlogProject(request, params.id);
        if (r instanceof Response) return r;
        const { ctx, project } = r;
        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Ungültige Eingabe" }, { status: 400 });
        const { data: offen } = await (supabaseAdmin as any)
          .from("keyword_audits")
          .select("id, status, percent")
          .eq("project_id", project.id)
          .in("status", ["queued", "running"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (offen) return Response.json({ ok: true, audit: offen, bereitsLaufend: true });
        const { data: audit, error } = await (supabaseAdmin as any)
          .from("keyword_audits")
          .insert({ project_id: project.id, trigger: parsed.data.trigger, created_by: ctx.userId })
          .select("id, status, percent")
          .single();
        if (error || !audit)
          return Response.json(
            { ok: false, error: "Audit konnte nicht gestartet werden" },
            { status: 500 },
          );
        await blogEvent(
          project.id,
          "audit.started",
          { audit_id: audit.id, trigger: parsed.data.trigger },
          ctx.userId,
        );
        return Response.json({ ok: true, audit, bereitsLaufend: false });
      },
    },
  },
});
