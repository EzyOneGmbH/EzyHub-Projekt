import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "@/server/google-tokens.server";
import { redactSecrets } from "@/server/google-oauth.server";
import { isProviderEnabled, canRunAudits } from "@/server/integrations.server";

// GA4 conversion detail: event-level counts bucketed into Phone / Mail / Contact / Maps,
// purchase revenue (CHF) and a daily key-events + revenue series.
// Persists audit_runs(audit_type="ga4_conversions"). Mirrors google.ga4-summary.ts.

const Body = z.object({
  clientId: z.string().uuid(),
  days: z.number().int().min(1).max(90).default(28),
});

// Bucket GA4 eventName values into the EzyRank conversion categories.
// Order matters: first match wins.
const BUCKETS: Array<{ key: "phone" | "mail" | "maps" | "contact"; re: RegExp }> = [
  { key: "phone", re: /phone|call|tel|anruf/i },
  { key: "mail", re: /mail|email/i },
  { key: "maps", re: /map|route|direction|wegbeschreibung|standort/i },
  { key: "contact", re: /contact|kontakt|form|lead|submit|anfrage|offerte/i },
];

function bucketOf(eventName: string): "phone" | "mail" | "maps" | "contact" | null {
  for (const b of BUCKETS) if (b.re.test(eventName)) return b.key;
  return null;
}

export const Route = createFileRoute("/api/google/ga4-conversions")({
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
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
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

          // Event counts by name (bucket client-side).
          let events: Array<{ eventName: string; count: number }> = [];
          const breakdown = { phone: 0, mail: 0, maps: 0, contact: 0 };
          try {
            const ev = await callGa4({
              dateRanges,
              dimensions: [{ name: "eventName" }],
              metrics: [{ name: "eventCount" }],
              orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
              limit: 200,
            });
            events = (ev.rows ?? []).map((r) => ({
              eventName: r.dimensionValues?.[0]?.value ?? "",
              count: Number(r.metricValues?.[0]?.value ?? 0),
            }));
            for (const e of events) {
              const b = bucketOf(e.eventName);
              if (b) breakdown[b] += e.count;
            }
          } catch {
            /* optional */
          }

          // Purchase revenue (CHF) + purchase count.
          let revenue = 0;
          let purchases = 0;
          try {
            const rev = await callGa4({
              dateRanges,
              metrics: [{ name: "totalRevenue" }, { name: "transactions" }],
            });
            const mv = rev.rows?.[0]?.metricValues ?? [];
            revenue = Number(mv[0]?.value ?? 0);
            purchases = Number(mv[1]?.value ?? 0);
          } catch {
            /* optional */
          }

          // Daily series: key events (leads) + revenue (purchase performance).
          let series: Array<{ date: string; conversions: number; revenue: number }> = [];
          try {
            const tr = await callGa4({
              dateRanges,
              dimensions: [{ name: "date" }],
              metrics: [{ name: "conversions" }, { name: "totalRevenue" }],
              orderBys: [{ dimension: { dimensionName: "date" } }],
            });
            series = (tr.rows ?? []).map((r) => ({
              date: r.dimensionValues?.[0]?.value ?? "",
              conversions: Number(r.metricValues?.[0]?.value ?? 0),
              revenue: Number(r.metricValues?.[1]?.value ?? 0),
            }));
          } catch {
            /* optional */
          }

          const result = {
            days: parsed.data.days,
            breakdown,
            events: events.slice(0, 25),
            revenue,
            purchases,
            series,
          };

          try {
            await supabaseAdmin.from("audit_runs").insert({
              client_id: client.id,
              organization_id: client.organization_id,
              triggered_by: user.id,
              audit_type: "ga4_conversions",
              status: "succeeded",
              input: { days: parsed.data.days },
              result: result as never,
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
