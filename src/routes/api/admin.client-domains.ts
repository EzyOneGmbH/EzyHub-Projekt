import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Machine-readable list of client domains for the agent-service uptime monitor
// and for autonomous onboarding (GA4/Canonry wiring per client).
// Secret-gated (ADMIN_AUTOMATION_SECRET).

export const Route = createFileRoute("/api/admin/client-domains")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret) return Response.json({ ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" }, { status: 503 });
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

        const { data, error } = await supabaseAdmin
          .from("clients")
          .select("id, name, domain, ga4_property, canonry_project, gsc_property");
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        const clients = (data || [])
          .map((c: any) => {
            let domain = String(c.domain ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
            // ga4_property is stored as "properties/123" or "123" — expose the bare id for ga/connect.
            const ga4Property = c.ga4_property ? String(c.ga4_property).replace(/^properties\//, "") : null;
            return {
              id: String(c.id),
              name: String(c.name ?? ""),
              domain,
              ga4Property,
              canonryProject: c.canonry_project ? String(c.canonry_project) : null,
              gscProperty: c.gsc_property ? String(c.gsc_property) : null,
            };
          })
          .filter((c) => c.domain);
        return Response.json({ ok: true, count: clients.length, clients }, { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
