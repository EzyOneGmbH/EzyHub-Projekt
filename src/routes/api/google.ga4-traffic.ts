import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "@/server/google-tokens.server";
import { redactSecrets } from "@/server/google-oauth.server";
import { isProviderEnabled, canRunAudits } from "@/server/integrations.server";

// GA4 traffic intelligence: channel split, AI-referral (ChatGPT/Perplexity/Gemini/…),
// Google-vs-AI daily series, top pages and country share.
// Persists audit_runs(audit_type="ga4_traffic"). Mirrors google.ga4-summary.ts.

const Body = z.object({
  clientId: z.string().uuid(),
  days: z.number().int().min(1).max(90).default(28),
  // Datumsfilter-Abfragen (2026-08-10): persist:false liest nur — kein
  // audit_runs-Insert, damit Filterwechsel die Agent-Snapshots nicht ersetzen.
  persist: z.boolean().default(true),
});

// Source hostnames that indicate an AI assistant / answer-engine referral.
// Matched as a substring against GA4 sessionSource (case-insensitive).
const AI_SOURCE_PATTERNS = [
  "chatgpt",
  "openai",
  "perplexity",
  "gemini",
  "bard",
  "copilot",
  "claude",
  "anthropic",
  "you.com",
  "phind",
  "poe.com",
];

function isAiSource(source: string): boolean {
  const s = source.toLowerCase();
  return AI_SOURCE_PATTERNS.some((p) => s.includes(p));
}

export const Route = createFileRoute("/api/google/ga4-traffic")({
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

          // Channel split (sessions by default channel group).
          let channels: Array<{ channel: string; sessions: number }> = [];
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

          // AI-referral: sessions + users by source, filtered to AI hosts.
          let aiBySource: Array<{ source: string; sessions: number; users: number }> = [];
          try {
            const src = await callGa4({
              dateRanges,
              dimensions: [{ name: "sessionSource" }],
              metrics: [{ name: "sessions" }, { name: "totalUsers" }],
              orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
              limit: 200,
            });
            aiBySource = (src.rows ?? [])
              .map((r) => ({
                source: r.dimensionValues?.[0]?.value ?? "",
                sessions: Number(r.metricValues?.[0]?.value ?? 0),
                users: Number(r.metricValues?.[1]?.value ?? 0),
              }))
              .filter((r) => isAiSource(r.source));
          } catch {
            /* optional */
          }
          const aiSessions = aiBySource.reduce((a, r) => a + r.sessions, 0);
          const aiUsers = aiBySource.reduce((a, r) => a + r.users, 0);

          // Total sessions for the same window (for Google-vs-AI share).
          let totalSessions = 0;
          try {
            const tot = await callGa4({ dateRanges, metrics: [{ name: "sessions" }] });
            totalSessions = Number(tot.rows?.[0]?.metricValues?.[0]?.value ?? 0);
          } catch {
            /* optional */
          }
          const googleSessions = channels
            .filter((c) => /organic|paid|search|google/i.test(c.channel))
            .reduce((a, c) => a + c.sessions, 0);

          // Daily AI series (sessions from AI sources per day) — one filtered call.
          let aiSeries: Array<{ date: string; aiSessions: number }> = [];
          try {
            const ds = await callGa4({
              dateRanges,
              dimensions: [{ name: "date" }],
              metrics: [{ name: "sessions" }],
              dimensionFilter: {
                filter: {
                  fieldName: "sessionSource",
                  inListFilter: {
                    values: AI_SOURCE_PATTERNS,
                    caseSensitive: false,
                  },
                },
              },
              orderBys: [{ dimension: { dimensionName: "date" } }],
            });
            // inListFilter is exact-match; AI hosts vary, so this may be sparse.
            // Fall back to empty when GA4 returns nothing.
            aiSeries = (ds.rows ?? []).map((r) => ({
              date: r.dimensionValues?.[0]?.value ?? "",
              aiSessions: Number(r.metricValues?.[0]?.value ?? 0),
            }));
          } catch {
            /* optional */
          }

          // Top pages by views.
          let topPages: Array<{ path: string; views: number }> = [];
          try {
            const tp = await callGa4({
              dateRanges,
              dimensions: [{ name: "pagePath" }],
              metrics: [{ name: "screenPageViews" }],
              orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
              limit: 15,
            });
            topPages = (tp.rows ?? []).map((r) => ({
              path: r.dimensionValues?.[0]?.value ?? "",
              views: Number(r.metricValues?.[0]?.value ?? 0),
            }));
          } catch {
            /* optional */
          }

          // Country share (sessions by country).
          let countries: Array<{ country: string; sessions: number }> = [];
          try {
            const co = await callGa4({
              dateRanges,
              dimensions: [{ name: "country" }],
              metrics: [{ name: "sessions" }],
              orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
              limit: 10,
            });
            countries = (co.rows ?? []).map((r) => ({
              country: r.dimensionValues?.[0]?.value ?? "(unknown)",
              sessions: Number(r.metricValues?.[0]?.value ?? 0),
            }));
          } catch {
            /* optional */
          }

          // Country share, nur organische Suche (2026-08-13, User-Wunsch):
          // speist "Switzerland Traffic (organisch)" — gleiche Form wie countries.
          let countriesOrganic: Array<{ country: string; sessions: number }> = [];
          try {
            const co = await callGa4({
              dateRanges,
              dimensions: [{ name: "country" }],
              metrics: [{ name: "sessions" }],
              dimensionFilter: {
                filter: {
                  fieldName: "sessionDefaultChannelGroup",
                  stringFilter: { value: "Organic Search", matchType: "EXACT" },
                },
              },
              orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
              limit: 10,
            });
            countriesOrganic = (co.rows ?? []).map((r) => ({
              country: r.dimensionValues?.[0]?.value ?? "(unknown)",
              sessions: Number(r.metricValues?.[0]?.value ?? 0),
            }));
          } catch {
            /* optional */
          }

          const result = {
            days: parsed.data.days,
            channels,
            aiReferral: { sessions: aiSessions, users: aiUsers, bySource: aiBySource },
            googleVsAi: {
              google: googleSessions,
              ai: aiSessions,
              other: Math.max(0, totalSessions - googleSessions - aiSessions),
              total: totalSessions,
            },
            aiSeries,
            topPages,
            countries,
            countriesOrganic,
          };

          try {
            if (parsed.data.persist)
              await supabaseAdmin.from("audit_runs").insert({
                client_id: client.id,
                organization_id: client.organization_id,
                triggered_by: user.id,
                audit_type: "ga4_traffic",
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
