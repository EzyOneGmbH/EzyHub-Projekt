import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { blogEvent, requireBlogProject } from "@/server/blog-autopilot.server";

// PATCH /api/blog/rules/:id {active}: Schreibregel an- oder ausschalten.
// Standardregeln (Quellenpflicht, keine Mitbewerber-Links, keine
// Vergleichslisten) lassen sich nicht ausschalten.

const Body = z.object({ active: z.boolean() }).strict();

export const Route = createFileRoute("/api/blog/rules/$id")({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        if (!/^[0-9a-f-]{36}$/i.test(params.id))
          return Response.json({ ok: false, error: "Ungültige ID" }, { status: 400 });
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Ungültige Eingabe" }, { status: 400 });
        const { data: rule } = await (supabaseAdmin as any)
          .from("writing_rules")
          .select("id, project_id, source, active")
          .eq("id", params.id)
          .maybeSingle();
        if (!rule)
          return Response.json({ ok: false, error: "Regel nicht gefunden" }, { status: 404 });
        const r = await requireBlogProject(request, String(rule.project_id));
        if (r instanceof Response)
          return r.status === 401
            ? r
            : Response.json({ ok: false, error: "Regel nicht gefunden" }, { status: 404 });
        if (rule.source === "standard" && !parsed.data.active)
          return Response.json(
            { ok: false, error: "Standardregeln sind immer aktiv" },
            { status: 409 },
          );
        await (supabaseAdmin as any)
          .from("writing_rules")
          .update({ active: parsed.data.active })
          .eq("id", rule.id);
        await blogEvent(
          r.project.id,
          parsed.data.active ? "rule.enabled" : "rule.disabled",
          { rule_id: rule.id },
          r.ctx.userId,
        );
        return Response.json({ ok: true, rule: { ...rule, active: parsed.data.active } });
      },
    },
  },
});
