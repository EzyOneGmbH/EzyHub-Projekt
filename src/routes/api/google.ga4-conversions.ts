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
  // Datumsfilter-Abfragen (2026-08-10): persist:false liest nur — kein
  // audit_runs-Insert, damit Filterwechsel die Agent-Snapshots nicht ersetzen.
  persist: z.boolean().default(true),
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

const BUCKET_LABEL: Record<string, string> = {
  phone: "Phone Click",
  mail: "Mail Click",
  maps: "Maps Click",
  contact: "Contact Form",
};
const PURCHASE_RE = /purchase|order|checkout|kauf|transaction/i;

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

          // Detailed conversion listing (EzyRank-style table rows): one row per
          // date × event × country × source × device for conversion-type events.
          // Filter the GA4 report to the conversion event NAMES (from the aggregate
          // above) so high-volume events (page_view, …) don't crowd out the rows.
          const convNames = events
            .map((e) => e.eventName)
            .filter((n) => bucketOf(n) || PURCHASE_RE.test(n));
          let rows: Array<Record<string, unknown>> = [];
          if (convNames.length > 0) {
            try {
              const dr = await callGa4({
                dateRanges,
                dimensions: [
                  { name: "date" },
                  { name: "eventName" },
                  { name: "country" },
                  { name: "sessionSource" },
                  { name: "deviceCategory" },
                ],
                metrics: [{ name: "eventCount" }, { name: "eventValue" }],
                dimensionFilter: {
                  filter: {
                    fieldName: "eventName",
                    inListFilter: { values: convNames },
                  },
                },
                orderBys: [{ dimension: { dimensionName: "date" }, desc: true }],
                limit: 250,
              });
              rows = (dr.rows ?? []).map((r) => {
                const dv = r.dimensionValues ?? [];
                const mv = r.metricValues ?? [];
                const eventName = dv[1]?.value ?? "";
                const b = bucketOf(eventName);
                return {
                  date: dv[0]?.value ?? "",
                  eventName,
                  description: b ? BUCKET_LABEL[b] : eventName,
                  country: dv[2]?.value ?? "",
                  source: dv[3]?.value ?? "",
                  device: dv[4]?.value ?? "",
                  count: Number(mv[0]?.value ?? 0),
                  value: Number(mv[1]?.value ?? 0),
                };
              });
            } catch {
              /* optional */
            }
          }

          // Kanal-Split (Datumsfilter-Fix 2026-08-11): der Agent-Snapshot hatte
          // channels immer dabei — seit die Live-Antwort den Snapshot im
          // Dashboard verdrängt (10.08.), verschwand das Kanäle-Widget, weil
          // dieses Feld hier fehlte. Gleiche Form wie im populate-Job.
          let channels: Array<Record<string, number | string>> = [];
          try {
            const ch = await callGa4({
              dateRanges,
              dimensions: [{ name: "sessionDefaultChannelGroup" }],
              metrics: [{ name: "sessions" }, { name: "conversions" }, { name: "totalRevenue" }],
              orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
            });
            channels = (ch.rows ?? []).map((r) => ({
              channel: r.dimensionValues?.[0]?.value ?? "(other)",
              sessions: Number(r.metricValues?.[0]?.value ?? 0),
              conversions: Number(r.metricValues?.[1]?.value ?? 0),
              revenue: Number(r.metricValues?.[2]?.value ?? 0),
            }));
          } catch {
            // Fallback ohne conversions/revenue (ältere Properties): nur sessions.
            try {
              const ch = await callGa4({
                dateRanges,
                dimensions: [{ name: "sessionDefaultChannelGroup" }],
                metrics: [{ name: "sessions" }],
                orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
              });
              channels = (ch.rows ?? []).map((r) => ({
                channel: r.dimensionValues?.[0]?.value ?? "(other)",
                sessions: Number(r.metricValues?.[0]?.value ?? 0),
              }));
            } catch {
              /* optional */
            }
          }

          const result = {
            days: parsed.data.days,
            breakdown,
            events: events.slice(0, 25),
            rows: rows.slice(0, 200),
            revenue,
            purchases,
            series,
            channels,
          };

          try {
            if (parsed.data.persist)
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
