import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Machine-readable list of clients that have a Google Ads customer ID configured.
// Consumed by the n8n "Google Ads Hype-Mail" workflow so it can loop over every
// client instead of a hardcoded account. Protected by the same
// ADMIN_AUTOMATION_SECRET as /api/admin/populate (inert until that env is set).
// Read-only. Returns the normalized (digits-only) Ads customer ID plus the
// per-client contact email (stored in clients.metadata.contactEmail).

export const Route = createFileRoute("/api/admin/ads-clients")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret)
          return Response.json(
            { ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" },
            { status: 503 },
          );
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

        const { data, error } = await supabaseAdmin
          .from("clients")
          .select("id, name, google_ads_customer, metadata");
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        const clients = (data || [])
          .map((c: any) => {
            const customerId = String(c.google_ads_customer ?? "").replace(/\D/g, "");
            const m = c.metadata && typeof c.metadata === "object" ? c.metadata : {};
            return {
              id: String(c.id),
              name: String(c.name ?? ""),
              googleAdsCustomer: customerId,
              contactEmail: String(m.contactEmail ?? "").trim(),
            };
          })
          .filter((c) => c.googleAdsCustomer);

        return Response.json({ ok: true, count: clients.length, clients });
      },
    },
  },
});
