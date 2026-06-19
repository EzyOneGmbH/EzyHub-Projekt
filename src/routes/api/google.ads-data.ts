import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "@/server/google-tokens.server";
import { redactSecrets } from "@/server/google-oauth.server";
import { isProviderEnabled, canRunAudits } from "@/server/integrations.server";

// Google Ads performance data: campaign metrics, daily series, cost breakdown.
// Persists audit_runs(audit_type="google_ads"). Requires GOOGLE_ADS_DEVELOPER_TOKEN.

const Body = z.object({
  clientId: z.string().uuid(),
  days: z.number().int().min(1).max(90).default(28),
});

const API_DISABLED = /has not been used|is disabled|accessNotConfigured|SERVICE_DISABLED/i;

export const Route = createFileRoute("/api/google/ads-data")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const supabaseUrl = process.env.SUPABASE_URL!;
          const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!;
          const sb = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
          });
          const {
            data: { user },
          } = await sb.auth.getUser();
          if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

          const parsed = Body.safeParse(await request.json().catch(() => ({})));
          if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });

          const { data: client } = await supabaseAdmin
            .from("clients")
            .select("id, organization_id, google_ads_customer")
            .eq("id", parsed.data.clientId)
            .maybeSingle();
          if (!client) return Response.json({ ok: false, error: "Client not found" });
          const { data: m } = await supabaseAdmin
            .from("app_users")
            .select("role")
            .eq("user_id", user.id)
            .eq("organization_id", client.organization_id)
            .maybeSingle();
          if (!m) return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
          if (!(await canRunAudits(user.id, client.organization_id)))
            return Response.json(
              { ok: false, error: "Keine Berechtigung für Audit-Läufe (viewer/read-only)." },
              { status: 403 },
            );
          if (!client.google_ads_customer)
            return Response.json({ ok: false, error: "Keine Google Ads Customer ID gesetzt." });
          if (!(await isProviderEnabled(client.id, "google")))
            return Response.json(
              { ok: false, error: "Google-Integration für diesen Kunden deaktiviert." },
              { status: 403 },
            );

          const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
          if (!devToken) {
            return Response.json({
              ok: false,
              error: "GOOGLE_ADS_DEVELOPER_TOKEN nicht konfiguriert.",
            });
          }

          const { accessToken } = await getGoogleAccessToken(client.id);
          const customerId = String(client.google_ads_customer).replace(/-/g, "");
          const days = parsed.data.days;

          // Date range for GAQL queries
          const today = new Date();
          const startDate = new Date(today);
          startDate.setDate(startDate.getDate() - days);
          const formatDate = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
          const dateFrom = formatDate(startDate);
          const dateTo = formatDate(today);

          const query = async (gaql: string) => {
            const res = await fetch(
              `https://googleads.googleapis.com/v24/customers/${customerId}/googleAds:searchStream`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  "developer-token": devToken,
                  "Content-Type": "application/json",
                  "login-customer-id": customerId,
                },
                body: JSON.stringify({ query: gaql }),
              },
            );
            if (!res.ok) {
              const t = await res.text().catch(() => "");
              if (API_DISABLED.test(t)) throw new Error("Google Ads API nicht aktiviert.");
              throw new Error(`Ads API HTTP ${res.status}: ${t.slice(0, 200)}`);
            }
            return (await res.json()) as Array<{ results?: Array<Record<string, unknown>> }>;
          };

          // 1. Account-level totals
          let totals = { cost: 0, clicks: 0, impressions: 0, conversions: 0, conversionValue: 0 };
          try {
            const r = await query(`
              SELECT
                metrics.cost_micros,
                metrics.clicks,
                metrics.impressions,
                metrics.conversions,
                metrics.conversions_value
              FROM customer
              WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
            `);
            const m = r?.[0]?.results?.[0]?.metrics as Record<string, unknown> | undefined;
            if (m) {
              totals.cost = Number(m.costMicros ?? 0) / 1_000_000;
              totals.clicks = Number(m.clicks ?? 0);
              totals.impressions = Number(m.impressions ?? 0);
              totals.conversions = Number(m.conversions ?? 0);
              totals.conversionValue = Number(m.conversionsValue ?? 0);
            }
          } catch {
            /* optional */
          }

          // 2. Daily series
          let series: Array<{ date: string; cost: number; clicks: number; impressions: number; conversions: number }> = [];
          try {
            const r = await query(`
              SELECT
                segments.date,
                metrics.cost_micros,
                metrics.clicks,
                metrics.impressions,
                metrics.conversions
              FROM customer
              WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
              ORDER BY segments.date
            `);
            series = (r?.[0]?.results ?? []).map((row: Record<string, unknown>) => {
              const seg = row.segments as Record<string, unknown> | undefined;
              const met = row.metrics as Record<string, unknown> | undefined;
              return {
                date: String(seg?.date ?? ""),
                cost: Number(met?.costMicros ?? 0) / 1_000_000,
                clicks: Number(met?.clicks ?? 0),
                impressions: Number(met?.impressions ?? 0),
                conversions: Number(met?.conversions ?? 0),
              };
            });
          } catch {
            /* optional */
          }

          // 3. Campaign breakdown
          let campaigns: Array<{ name: string; status: string; cost: number; clicks: number; impressions: number; conversions: number }> = [];
          try {
            const r = await query(`
              SELECT
                campaign.name,
                campaign.status,
                metrics.cost_micros,
                metrics.clicks,
                metrics.impressions,
                metrics.conversions
              FROM campaign
              WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
              ORDER BY metrics.cost_micros DESC
              LIMIT 20
            `);
            campaigns = (r?.[0]?.results ?? []).map((row: Record<string, unknown>) => {
              const c = row.campaign as Record<string, unknown> | undefined;
              const met = row.metrics as Record<string, unknown> | undefined;
              return {
                name: String(c?.name ?? ""),
                status: String(c?.status ?? "").replace("CAMPAIGN_STATUS_", ""),
                cost: Number(met?.costMicros ?? 0) / 1_000_000,
                clicks: Number(met?.clicks ?? 0),
                impressions: Number(met?.impressions ?? 0),
                conversions: Number(met?.conversions ?? 0),
              };
            });
          } catch {
            /* optional */
          }

          const result = {
            days,
            totals,
            series,
            campaigns,
            ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0,
            cpc: totals.clicks > 0 ? totals.cost / totals.clicks : 0,
            cpa: totals.conversions > 0 ? totals.cost / totals.conversions : 0,
            roas: totals.cost > 0 ? totals.conversionValue / totals.cost : 0,
          };

          // Persist snapshot
          const nowIso = () => new Date().toISOString();
          try {
            await supabaseAdmin.from("audit_runs").insert({
              client_id: client.id,
              organization_id: client.organization_id,
              triggered_by: user.id,
              audit_type: "google_ads",
              status: "succeeded",
              input: { days, customerId },
              result,
              started_at: nowIso(),
              finished_at: nowIso(),
            });
          } catch {
            /* non-fatal */
          }

          return Response.json({ ok: true, ...result });
        } catch (e) {
          return Response.json({ ok: false, error: redactSecrets(e) });
        }
      },
    },
  },
});
