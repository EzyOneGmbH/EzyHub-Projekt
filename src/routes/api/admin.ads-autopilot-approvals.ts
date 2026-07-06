import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Lists pending Google Ads Autopilot approvals for delivery (n8n Slack/Teams/
// Mail with Approve button). Server-to-server, ADMIN_AUTOMATION_SECRET.
// Optional ?clientId=<uuid> to scope; defaults to all pending, non-expired.

export const Route = createFileRoute("/api/admin/ads-autopilot-approvals")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret)
          return Response.json({ ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" }, { status: 503 });
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

        const url = new URL(request.url);
        const clientId = url.searchParams.get("clientId");
        let q = supabaseAdmin
          .from("ads_approvals")
          .select("id, client_id, customer_id, run_id, action_id, type, entity, current_value, proposed_value, rationale, estimated_impact, expires_at, created_at")
          .eq("status", "pending")
          .order("created_at", { ascending: false });
        if (clientId) q = q.eq("client_id", clientId);

        const { data, error } = await q;
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        const now = Date.now();
        const actions = (data || []).filter((a: any) => !a.expires_at || new Date(a.expires_at).getTime() > now);
        return Response.json({ ok: true, count: actions.length, actions });
      },
    },
  },
});
