import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "@/server/google-tokens.server";
import { redactSecrets } from "@/server/google-oauth.server";
import { isProviderEnabled, canRunAudits } from "@/server/integrations.server";

const Body = z.object({
  clientId: z.string().uuid(),
  days: z.number().int().min(1).max(90).default(28),
});

export const Route = createFileRoute("/api/google/ga4-summary")({
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

          const body = await request.json().catch(() => ({}));
          const parsed = Body.safeParse(body);
          if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });

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
          if (!(await canRunAudits(user.id, client.organization_id)))
            return Response.json(
              { ok: false, error: "Keine Berechtigung für Audit-Läufe (viewer/read-only)." },
              { status: 403 },
            );
          if (!client.ga4_property)
            return Response.json({ ok: false, error: "Kein GA4-Property gesetzt." });
          if (!(await isProviderEnabled(client.id, "google")))
            return Response.json(
              { ok: false, error: "Google-Integration für diesen Kunden deaktiviert." },
              { status: 403 },
            );

          const { accessToken } = await getGoogleAccessToken(client.id);
          const propertyId = client.ga4_property.replace(/^properties\//, "");
          const base = `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`;
          const dateRanges = [{ startDate: `${parsed.data.days}daysAgo`, endDate: "today" }];
          const callGa4 = async (reqBody: unknown) => {
            const r = await fetch(base, {
              method: "POST",
              headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
              body: JSON.stringify(reqBody),
            });
            if (!r.ok) throw new Error(`GA4 HTTP ${r.status}: ${await r.text().catch(() => "")}`);
            return (await r.json()) as {
              rows?: Array<{
                dimensionValues?: Array<{ value: string }>;
                metricValues?: Array<{ value: string }>;
              }>;
            };
          };

          // Core metrics (all standard, always valid).
          const CORE = [
            "sessions",
            "totalUsers",
            "newUsers",
            "engagedSessions",
            "screenPageViews",
            "bounceRate",
            "averageSessionDuration",
          ];
          let core: Awaited<ReturnType<typeof callGa4>>;
          try {
            core = await callGa4({ dateRanges, metrics: CORE.map((name) => ({ name })) });
          } catch (e) {
            return Response.json({ ok: false, error: redactSecrets(e) });
          }
          const cv = core.rows?.[0]?.metricValues ?? [];
          const metrics: Record<string, number> = {};
          CORE.forEach((name, i) => (metrics[name] = Number(cv[i]?.value ?? 0)));

          // Conversions + revenue are optional (metric names vary by property / GA4 version).
          try {
            const opt = await callGa4({
              dateRanges,
              metrics: [{ name: "conversions" }, { name: "totalRevenue" }],
            });
            const ov = opt.rows?.[0]?.metricValues ?? [];
            metrics.conversions = Number(ov[0]?.value ?? 0);
            metrics.totalRevenue = Number(ov[1]?.value ?? 0);
          } catch {
            metrics.conversions = 0;
            metrics.totalRevenue = 0;
          }

          // Daily trend for charts (optional).
          let series: Array<Record<string, number | string>> = [];
          try {
            const tr = await callGa4({
              dateRanges,
              dimensions: [{ name: "date" }],
              metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "screenPageViews" }],
              orderBys: [{ dimension: { dimensionName: "date" } }],
            });
            series = (tr.rows ?? []).map((r) => ({
              date: r.dimensionValues?.[0]?.value ?? "",
              sessions: Number(r.metricValues?.[0]?.value ?? 0),
              totalUsers: Number(r.metricValues?.[1]?.value ?? 0),
              pageViews: Number(r.metricValues?.[2]?.value ?? 0),
            }));
          } catch {
            /* trend optional */
          }

          const result = { days: parsed.data.days, metrics, series };
          try {
            await supabaseAdmin.from("audit_runs").insert({
              client_id: client.id,
              organization_id: client.organization_id,
              triggered_by: user.id,
              audit_type: "ga4_summary",
              status: "succeeded",
              input: { days: parsed.data.days },
              result: result as any,
              started_at: new Date().toISOString(),
              finished_at: new Date().toISOString(),
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
