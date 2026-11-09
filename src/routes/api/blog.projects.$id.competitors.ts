import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { blogEvent, normalisiereDomain, requireBlogProject } from "@/server/blog-autopilot.server";

// Mitbewerber (Onboarding Schritt 4). GET liefert die Liste; PUT setzt die
// endgültige Liste: Domains, die schon da waren, behalten ihre Quelle und gelten
// als bestätigt; neue sind «manuell». Fehlende (auch nicht übernommene
// KI-Vorschläge) werden entfernt.
// Mitbewerber werden nie verlinkt (Kap. 6A).

const PutBody = z.object({
  domains: z.array(z.string().max(253)).max(30),
});

export const Route = createFileRoute("/api/blog/projects/$id/competitors")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const r = await requireBlogProject(request, params.id);
        if (r instanceof Response) return r;
        const { data } = await (supabaseAdmin as any)
          .from("blog_competitors")
          .select("id, domain, source, validated")
          .eq("project_id", r.project.id)
          .order("domain");
        return Response.json({ ok: true, competitors: data ?? [] });
      },

      PUT: async ({ request, params }) => {
        const r = await requireBlogProject(request, params.id);
        if (r instanceof Response) return r;
        const { ctx, project } = r;
        const parsed = PutBody.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Ungültige Eingabe" }, { status: 400 });
        const ungueltig = parsed.data.domains.filter((d) => !normalisiereDomain(d));
        if (ungueltig.length)
          return Response.json(
            { ok: false, error: `Ungültige Domain: ${ungueltig.slice(0, 3).join(", ")}` },
            { status: 400 },
          );
        const eigene = normalisiereDomain(project.domain);
        const domains = [...new Set(parsed.data.domains.map((d) => normalisiereDomain(d)))].filter(
          (d) => d !== eigene,
        );

        const { data: alt } = await (supabaseAdmin as any)
          .from("blog_competitors")
          .select("id, domain")
          .eq("project_id", project.id);
        const altSet = new Map<string, string>(
          (alt ?? []).map((c: any) => [String(c.domain), String(c.id)]),
        );
        const weg = [...altSet.entries()].filter(([d]) => !domains.includes(d)).map(([, id]) => id);
        if (weg.length)
          await (supabaseAdmin as any).from("blog_competitors").delete().in("id", weg);
        // Behaltene, bisher unbestätigte KI-Vorschläge gelten jetzt als bestätigt.
        const behalten = [...altSet.entries()]
          .filter(([d]) => domains.includes(d))
          .map(([, id]) => id);
        if (behalten.length)
          await (supabaseAdmin as any)
            .from("blog_competitors")
            .update({ validated: true })
            .in("id", behalten);
        const neu = domains.filter((d) => !altSet.has(d));
        if (neu.length)
          await (supabaseAdmin as any).from("blog_competitors").insert(
            neu.map((domain) => ({
              project_id: project.id,
              domain,
              source: "manuell",
              validated: true,
            })),
          );
        await blogEvent(
          project.id,
          "competitors.updated",
          { anzahl: domains.length, neu: neu.length, entfernt: weg.length },
          ctx.userId,
        );
        const { data } = await (supabaseAdmin as any)
          .from("blog_competitors")
          .select("id, domain, source, validated")
          .eq("project_id", project.id)
          .order("domain");
        return Response.json({ ok: true, competitors: data ?? [] });
      },
    },
  },
});
