import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { redactSecrets } from "@/server/google-oauth.server";
import { isProviderEnabled } from "@/server/integrations.server";
import { getGoogleAccessToken } from "@/server/google-tokens.server";

// Live GA4 comparison: runs a single runReport with two dateRanges (current +
// comparison) and returns totals for both, so the UI can show real YoY / MoM
// deltas for Conversions/Overview KPIs. Read-only, no persistence.

const Body = z.object({
  clientId: z.string().uuid(),
  // ISO dates (YYYY-MM-DD)
  start: z.string(),
  end: z.string(),
  compareStart: z.string(),
  compareEnd: z.string(),
});

const isoDay = (s: string) => String(s).slice(0, 10);

export const Route = createFileRoute("/api/google/ga4-compare")({
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
          if (!user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

          const parsed = Body.safeParse(await request.json().catch(() => ({})));
          if (!parsed.success)
            return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });

          const { data: client } = await supabaseAdmin
            .from("clients")
            .select("id, organization_id, ga4_property")
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
          if (!client.ga4_property)
            return Response.json({ ok: false, error: "Kein GA4-Property gesetzt." });
          if (!(await isProviderEnabled(client.id, "google")))
            return Response.json(
              { ok: false, error: "Google-Integration deaktiviert." },
              { status: 403 },
            );

          const { accessToken } = await getGoogleAccessToken(client.id);
          const propertyId = client.ga4_property.replace(/^properties\//, "");
          const url = `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`;

          // GA4 returns one row per dateRange (tagged via the dateRange dimension).
          const res = await fetch(url, {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              dateRanges: [
                {
                  startDate: isoDay(parsed.data.start),
                  endDate: isoDay(parsed.data.end),
                  name: "current",
                },
                {
                  startDate: isoDay(parsed.data.compareStart),
                  endDate: isoDay(parsed.data.compareEnd),
                  name: "compare",
                },
              ],
              dimensions: [{ name: "dateRange" }],
              metrics: [
                { name: "sessions" },
                { name: "totalUsers" },
                { name: "screenPageViews" },
                { name: "conversions" },
                { name: "totalRevenue" },
              ],
            }),
          });
          if (!res.ok) {
            const t = await res.text().catch(() => "");
            return Response.json({
              ok: false,
              error: redactSecrets(`GA4 HTTP ${res.status}: ${t}`),
            });
          }
          const json = (await res.json()) as {
            rows?: Array<{
              dimensionValues: Array<{ value: string }>;
              metricValues: Array<{ value: string }>;
            }>;
          };

          const parseRow = (row?: { metricValues: Array<{ value: string }> }) => ({
            sessions: Number(row?.metricValues?.[0]?.value ?? 0),
            totalUsers: Number(row?.metricValues?.[1]?.value ?? 0),
            screenPageViews: Number(row?.metricValues?.[2]?.value ?? 0),
            conversions: Number(row?.metricValues?.[3]?.value ?? 0),
            totalRevenue: Number(row?.metricValues?.[4]?.value ?? 0),
          });

          // Match rows by the dateRange dimension value ("current"/"compare" or date_range_0/1).
          const rows = json.rows ?? [];
          const currentRow =
            rows.find((r) => /current|date_range_0/i.test(r.dimensionValues?.[0]?.value ?? "")) ??
            rows[0];
          const compareRow =
            rows.find((r) => /compare|date_range_1/i.test(r.dimensionValues?.[0]?.value ?? "")) ??
            rows[1];

          return Response.json({
            ok: true,
            current: parseRow(currentRow),
            compare: parseRow(compareRow),
          });
        } catch (e) {
          return Response.json({ ok: false, error: redactSecrets(e) });
        }
      },
    },
  },
});
