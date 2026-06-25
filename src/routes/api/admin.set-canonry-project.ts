import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Maschinen-Endpoint: persistiert den Canonry-Projekt-Slug auf dem Kunden.
// Wird vom agent-service-Reconciler (tickCanonryConnect) genutzt, der das
// Canonry-Projekt lokal anlegt (Canonry laeuft auf dem Cloud-PC) und den Slug
// hier zurueckschreibt, damit client-domains/GA4/Bing-Reconciler ihn sehen.
// Secret-gated (ADMIN_AUTOMATION_SECRET).

const Body = z.object({
  clientId: z.string().uuid().optional(),
  clientName: z.string().optional(),
  slug: z.string().min(1).max(80),
});

export const Route = createFileRoute("/api/admin/set-canonry-project")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret)
          return Response.json(
            { ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" },
            { status: 503 },
          );
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });
        const d = parsed.data;

        let clientId = d.clientId || null;
        if (!clientId && d.clientName) {
          const { data } = await supabaseAdmin
            .from("clients")
            .select("id")
            .ilike("name", d.clientName)
            .limit(1)
            .maybeSingle();
          clientId = data?.id || null;
        }
        if (!clientId)
          return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });

        const { error } = await supabaseAdmin
          .from("clients")
          .update({ canonry_project: d.slug })
          .eq("id", clientId);
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        return Response.json({ ok: true, clientId, slug: d.slug });
      },
    },
  },
});
