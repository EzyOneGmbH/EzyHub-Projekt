import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  blogEvent,
  ladeBlogProjekt,
  normalisiereDomain,
  requireBlogAccess,
  STANDARD_REGELN,
} from "@/server/blog-autopilot.server";

// Blog-Autopilot-Projekt eines Kunden (Phase 1, Kap. 8).
//  GET  ?clientId=…            → Projekt + WordPress-Status (ohne Schlüssel)
//  POST {clientId, domain?}    → Projekt anlegen (Onboarding Schritt 1);
//                                existiert schon eins, wird es zurückgegeben.

const PostBody = z.object({
  clientId: z.string().uuid(),
  domain: z.string().max(253).optional(),
});

export const Route = createFileRoute("/api/blog/projects")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const clientId = new URL(request.url).searchParams.get("clientId") || "";
        if (!z.string().uuid().safeParse(clientId).success)
          return Response.json({ ok: false, error: "clientId erforderlich" }, { status: 400 });
        const ctx = await requireBlogAccess(request, clientId);
        if (ctx instanceof Response) return ctx;
        return Response.json({ ok: true, project: await ladeBlogProjekt(clientId) });
      },

      POST: async ({ request }) => {
        const parsed = PostBody.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Ungültige Eingabe" }, { status: 400 });
        const ctx = await requireBlogAccess(request, parsed.data.clientId);
        if (ctx instanceof Response) return ctx;

        const vorhanden = await ladeBlogProjekt(ctx.clientId);
        if (vorhanden) return Response.json({ ok: true, project: vorhanden, created: false });

        const domain = normalisiereDomain(parsed.data.domain || ctx.domain);
        if (!domain)
          return Response.json({ ok: false, error: "Ungültige Website-Adresse" }, { status: 400 });

        const { data: project, error } = await (supabaseAdmin as any)
          .from("blog_projects")
          .insert({ client_id: ctx.clientId, domain, created_by: ctx.userId })
          .select("*")
          .single();
        if (error || !project)
          return Response.json(
            { ok: false, error: error?.message || "Projekt konnte nicht angelegt werden" },
            { status: 500 },
          );
        await (supabaseAdmin as any)
          .from("writing_rules")
          .insert(
            STANDARD_REGELN.map((rule) => ({ project_id: project.id, rule, source: "standard" })),
          );
        await blogEvent(project.id, "project.created", { domain }, ctx.userId);
        return Response.json({
          ok: true,
          project: { ...project, wordpress: { status: "nicht_verbunden" } },
          created: true,
        });
      },
    },
  },
});
