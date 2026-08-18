import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Read-only metrics bridge for autonomous agents. Returns the latest stored
// audit_runs results per type (GSC, GA4, GA4-Traffic, GA4-Conversions, Ahrefs,
// Google Ads) for a client, so the agent can do GSC/GA4-based checklist tasks
// (performance review, coverage, traffic anomalies, AI-referrals) without
// needing per-client Google OAuth. Secret-gated (ADMIN_AUTOMATION_SECRET).

const TYPES = [
  "gsc_summary",
  "ga4_summary",
  "ga4_traffic",
  "ga4_conversions",
  "ahrefs",
  "google_ads",
  "pagespeed",
];

export const Route = createFileRoute("/api/admin/client-metrics")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret) return Response.json({ ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" }, { status: 503 });
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

        const url = new URL(request.url);
        const clientName = url.searchParams.get("clientName") || "";
        const clientIdParam = url.searchParams.get("clientId") || "";

        let clientId = clientIdParam || null;
        if (!clientId && clientName) {
          const { data } = await supabaseAdmin.from("clients").select("id").ilike("name", clientName).limit(1).maybeSingle();
          clientId = data?.id || null;
        }
        if (!clientId) return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });

        // Latest succeeded run per audit_type.
        const metrics: Record<string, any> = {};
        const dates: Record<string, string | null> = {};
        for (const t of TYPES) {
          const { data } = await supabaseAdmin
            .from("audit_runs")
            .select("result, finished_at")
            .eq("client_id", clientId)
            .eq("audit_type", t)
            .eq("status", "succeeded")
            .order("finished_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (data?.result) {
            metrics[t] = data.result;
            dates[t] = data.finished_at;
          }
        }

        return Response.json(
          { ok: true, clientId, generatedAt: new Date().toISOString(), dataDates: dates, metrics },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
