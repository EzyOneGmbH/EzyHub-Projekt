import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { blogEvent, requireBlogProject } from "@/server/blog-autopilot.server";
import { googleStand } from "@/server/blog-google.server";

// Onboarding Schritt 6: Search Console und GA4 (Kap. 6A).
//  GET  → Stand + Kandidaten (nur zur Projekt-Domain passend). Ist genau eine
//         GSC-Property passend und noch keine gesetzt, wird sie automatisch
//         zugeordnet.
//  POST {gsc_property?, ga4_property?, ga4_stream_id?} → übernimmt nur Werte
//         aus der Kandidatenliste; gesetzte Kunden-Properties bleiben fest.

const Body = z
  .object({
    gsc_property: z.string().max(300).optional(),
    ga4_property: z
      .string()
      .regex(/^\d{1,20}$/)
      .optional(),
    ga4_stream_id: z
      .string()
      .regex(/^\d{1,20}$/)
      .optional(),
  })
  .strict();

export const Route = createFileRoute("/api/blog/projects/$id/google")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const r = await requireBlogProject(request, params.id);
        if (r instanceof Response) return r;
        const { ctx, project } = r;
        const stand = await googleStand(project);
        if (!stand.gsc.property && stand.gsc.kandidaten.length === 1) {
          const prop = stand.gsc.kandidaten[0];
          await supabaseAdmin
            .from("clients")
            .update({ gsc_property: prop } as any)
            .eq("id", project.client_id)
            .is("gsc_property" as any, null);
          stand.gsc = { property: prop, fest: true, kandidaten: [] };
          await blogEvent(
            project.id,
            "google.gsc_assigned",
            { property: prop, auto: true },
            ctx.userId,
          );
        }
        return Response.json({ ok: true, google: stand });
      },

      POST: async ({ request, params }) => {
        const r = await requireBlogProject(request, params.id);
        if (r instanceof Response) return r;
        const { ctx, project } = r;
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Ungültige Eingabe" }, { status: 400 });
        const d = parsed.data;
        const stand = await googleStand(project);
        if (!stand.verbunden)
          return Response.json({ ok: false, error: "Google ist nicht verbunden" }, { status: 409 });

        if (d.gsc_property) {
          if (stand.gsc.fest)
            return Response.json(
              { ok: false, error: "Search Console ist bereits zugeordnet" },
              { status: 409 },
            );
          if (!stand.gsc.kandidaten.includes(d.gsc_property))
            return Response.json(
              { ok: false, error: "Property passt nicht zur Website" },
              { status: 400 },
            );
          await supabaseAdmin
            .from("clients")
            .update({ gsc_property: d.gsc_property } as any)
            .eq("id", project.client_id);
          await blogEvent(
            project.id,
            "google.gsc_assigned",
            { property: d.gsc_property },
            ctx.userId,
          );
        }

        if (d.ga4_property || d.ga4_stream_id) {
          const prop = d.ga4_property ?? stand.ga4.property;
          const kandidat = stand.ga4.kandidaten.find((k) => k.id === prop);
          if (!prop || !kandidat)
            return Response.json(
              { ok: false, error: "GA4-Property passt nicht zur Website" },
              { status: 400 },
            );
          if (d.ga4_property && stand.ga4.fest && d.ga4_property !== stand.ga4.property)
            return Response.json(
              { ok: false, error: "GA4 ist bereits zugeordnet" },
              { status: 409 },
            );
          const stream =
            d.ga4_stream_id ?? (kandidat.streams.length === 1 ? kandidat.streams[0].id : null);
          if (stream && !kandidat.streams.some((s) => s.id === stream))
            return Response.json(
              { ok: false, error: "Datenstream gehört nicht zur Property" },
              { status: 400 },
            );
          if (!stand.ga4.fest)
            await supabaseAdmin
              .from("clients")
              .update({ ga4_property: prop } as any)
              .eq("id", project.client_id);
          await (supabaseAdmin as any)
            .from("blog_projects")
            .update({ ga4_stream_id: stream })
            .eq("id", project.id);
          await blogEvent(
            project.id,
            "google.ga4_assigned",
            { property: prop, stream },
            ctx.userId,
          );
        }
        const { data: neu } = await (supabaseAdmin as any)
          .from("blog_projects")
          .select("*")
          .eq("id", project.id)
          .maybeSingle();
        return Response.json({ ok: true, google: await googleStand(neu ?? project) });
      },
    },
  },
});
