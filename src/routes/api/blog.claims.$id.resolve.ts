import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { istAgentur, requireBlogProject } from "@/server/blog-autopilot.server";
import { loeseBehauptung } from "@/server/blog-pipeline.server";

// POST /api/blog/claims/:id/resolve {action: belegen|entfernen, source_url?}
// (Kap. 8, Faktencheck-Panel). Vorerst nur Ezy One (erste Entwürfe prüft die
// Agentur). Sind danach alle Behauptungen erledigt, läuft der Artikel weiter
// nach WordPress.

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("belegen"),
    source_url: z.string().url().startsWith("https://"),
  }),
  z.object({ action: z.literal("entfernen") }),
]);

export const Route = createFileRoute("/api/blog/claims/$id/resolve")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!/^[0-9a-f-]{36}$/i.test(params.id))
          return Response.json({ ok: false, error: "Ungültige ID" }, { status: 400 });
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return Response.json(
            { ok: false, error: "Ungültige Eingabe (Quelle braucht eine https-URL)" },
            { status: 400 },
          );
        const sb = supabaseAdmin as any;
        const { data: claim } = await sb
          .from("article_claims")
          .select("*")
          .eq("id", params.id)
          .maybeSingle();
        if (!claim)
          return Response.json({ ok: false, error: "Behauptung nicht gefunden" }, { status: 404 });
        const r = await requireBlogProject(request, String(claim.project_id));
        if (r instanceof Response)
          return r.status === 401
            ? r
            : Response.json({ ok: false, error: "Behauptung nicht gefunden" }, { status: 404 });
        if (!istAgentur(r.ctx))
          return Response.json({ ok: false, error: "Nur für Ezy One" }, { status: 403 });
        if (claim.status !== "offen")
          return Response.json(
            { ok: false, error: "Behauptung ist bereits erledigt" },
            { status: 409 },
          );
        const out = await loeseBehauptung({
          claim,
          aktion: parsed.data.action,
          quelleUrl: parsed.data.action === "belegen" ? parsed.data.source_url : null,
          actor: r.ctx.userId,
        });
        return Response.json({ ok: true, ...out });
      },
    },
  },
});
