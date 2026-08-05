import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "@/server/google-tokens.server";

// Traffic (05.08.2026, Searchable-Nachbau "Traffic"): der Gesamt-Traffic-Blick
// als Ergänzung zu LLM Analytics (das nur die KI-Hälfte zeigt).
//
// GET ?client=<uuid>&days=<1..365, Default 30> liefert:
//  - channels:   GA4-Sessions je Tag und Standard-Kanal (Zeitreihe)
//  - segments:   Engagement-Vergleich KI vs. Organisch vs. Direkt vs. Übrige
//                (Sessions, neue Besucher, Ø Dauer, Seiten/Session, Engagement-Rate)
//  - gsc:        Klicks/Impressionen/CTR/Ø-Position je Tag aus der Search Console
//
// Auth: eingeloggter User (RLS-Kundensicht) ODER Bearer ADMIN_AUTOMATION_SECRET.

const AI_SOURCE_RE = /chatgpt|openai|perplexity|gemini|bard|claude|anthropic|copilot|bing.*chat|grok|x\.ai|deepseek/i;

async function requireAccess(request: Request): Promise<{ userClient: any | null } | Response> {
  const admin = process.env.ADMIN_AUTOMATION_SECRET;
  const auth = request.headers.get("authorization") || "";
  if (admin && auth === `Bearer ${admin}`) return { userClient: null };
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return Response.json({ ok: false, error: "Server not configured" }, { status: 503 });
  const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data } = await userClient.auth.getUser();
  if (!data.user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return { userClient };
}

export const Route = createFileRoute("/api/admin/traffic-overview")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const acc = await requireAccess(request);
        if (acc instanceof Response) return acc;
        const u = new URL(request.url);
        const clientId = u.searchParams.get("client") || "";
        const days = Math.min(365, Math.max(1, Number(u.searchParams.get("days")) || 30));
        if (!/^[0-9a-f-]{36}$/i.test(clientId))
          return Response.json({ ok: false, error: "client (uuid) erforderlich" }, { status: 400 });
        const sb = acc.userClient ?? (supabaseAdmin as any);
        const { data: client } = await sb
          .from("clients")
          .select("id, name, ga4_property, gsc_property")
          .eq("id", clientId)
          .maybeSingle();
        if (!client) return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });
        if (!client.ga4_property && !client.gsc_property)
          return Response.json({ ok: true, ga4: false, gsc: false });

        let token = "";
        try {
          token = (await getGoogleAccessToken(clientId)).accessToken;
        } catch (e) {
          return Response.json({ ok: true, ga4: false, gsc: false, note: "Google-Token: " + String((e as any)?.message || e).slice(0, 120) });
        }

        const out: any = { ok: true, ga4: false, gsc: false, days };

        // ── GA4: Kanäle je Tag + Engagement je Quelle ───────────────────────
        if (client.ga4_property) {
          const propertyId = String(client.ga4_property).replace(/^properties\//, "");
          const run = (body: any) =>
            fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`, {
              method: "POST",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }], ...body }),
              signal: AbortSignal.timeout(25_000),
            });
          const [chRes, segRes] = await Promise.all([
            run({
              dimensions: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }],
              metrics: [{ name: "sessions" }],
              limit: 20000,
            }),
            run({
              dimensions: [{ name: "sessionDefaultChannelGroup" }, { name: "sessionSource" }],
              metrics: [
                { name: "sessions" }, { name: "newUsers" },
                { name: "averageSessionDuration" }, { name: "screenPageViewsPerSession" },
                { name: "engagementRate" },
              ],
              limit: 10000,
            }),
          ]);
          if (chRes.ok) {
            const j: any = await chRes.json().catch(() => ({}));
            const byDay = new Map<string, Record<string, number>>();
            const channelTotals: Record<string, number> = {};
            for (const row of j.rows ?? []) {
              const date = String(row.dimensionValues?.[0]?.value ?? "");
              const ch = String(row.dimensionValues?.[1]?.value ?? "");
              const n = Number(row.metricValues?.[0]?.value ?? 0);
              if (!date || !ch || n <= 0) continue;
              const day = byDay.get(date) ?? {};
              day[ch] = (day[ch] ?? 0) + n;
              byDay.set(date, day);
              channelTotals[ch] = (channelTotals[ch] ?? 0) + n;
            }
            out.ga4 = true;
            out.channels = {
              totals: channelTotals,
              timeseries: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, byChannel]) => ({ date, byChannel })),
            };
          }
          if (segRes.ok) {
            const j: any = await segRes.json().catch(() => ({}));
            // Segmente: KI (Quelle matcht KI-Regex) > Organisch > Direkt > Übrige.
            // Ø-Metriken werden sessions-gewichtet zusammengeführt.
            type Seg = { sessions: number; newUsers: number; durW: number; ppsW: number; engW: number };
            const segs: Record<string, Seg> = {};
            const add = (k: string, s: number, nu: number, dur: number, pps: number, eng: number) => {
              const t = segs[k] ?? { sessions: 0, newUsers: 0, durW: 0, ppsW: 0, engW: 0 };
              t.sessions += s; t.newUsers += nu; t.durW += dur * s; t.ppsW += pps * s; t.engW += eng * s;
              segs[k] = t;
            };
            for (const row of j.rows ?? []) {
              const ch = String(row.dimensionValues?.[0]?.value ?? "");
              const src = String(row.dimensionValues?.[1]?.value ?? "");
              const s = Number(row.metricValues?.[0]?.value ?? 0);
              if (s <= 0) continue;
              const nu = Number(row.metricValues?.[1]?.value ?? 0);
              const dur = Number(row.metricValues?.[2]?.value ?? 0);
              const pps = Number(row.metricValues?.[3]?.value ?? 0);
              const eng = Number(row.metricValues?.[4]?.value ?? 0);
              const seg = AI_SOURCE_RE.test(src) ? "KI-Antworten"
                : /organic search/i.test(ch) ? "Organische Suche"
                : /direct/i.test(ch) ? "Direkt"
                : "Übrige Kanäle";
              add(seg, s, nu, dur, pps, eng);
            }
            out.segments = Object.entries(segs).map(([name, t]) => ({
              name,
              sessions: t.sessions,
              newUsers: t.newUsers,
              avgDurationSec: t.sessions ? Math.round(t.durW / t.sessions) : 0,
              pagesPerSession: t.sessions ? Math.round((t.ppsW / t.sessions) * 10) / 10 : 0,
              engagementRate: t.sessions ? Math.round((t.engW / t.sessions) * 100) : 0,
            })).sort((a, b) => b.sessions - a.sessions);
          }
        }

        // ── GSC: Klicks/Impressionen je Tag ─────────────────────────────────
        if (client.gsc_property) {
          try {
            const site = String(client.gsc_property);
            const end = new Date().toISOString().slice(0, 10);
            const start = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
            const r = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
              method: "POST",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ startDate: start, endDate: end, dimensions: ["date"], rowLimit: 500 }),
              signal: AbortSignal.timeout(25_000),
            });
            if (r.ok) {
              const j: any = await r.json().catch(() => ({}));
              const rows = (j.rows ?? []).map((row: any) => ({
                date: String(row.keys?.[0] ?? ""),
                clicks: Number(row.clicks ?? 0),
                impressions: Number(row.impressions ?? 0),
                ctr: Math.round(Number(row.ctr ?? 0) * 1000) / 10,
                position: Math.round(Number(row.position ?? 0) * 10) / 10,
              })).sort((a: any, b: any) => a.date.localeCompare(b.date));
              if (rows.length) {
                const clicks = rows.reduce((a: number, x: any) => a + x.clicks, 0);
                const imps = rows.reduce((a: number, x: any) => a + x.impressions, 0);
                const posW = rows.reduce((a: number, x: any) => a + x.position * x.impressions, 0);
                out.gsc = true;
                out.search = {
                  timeseries: rows,
                  totals: { clicks, impressions: imps, ctr: imps ? Math.round((clicks / imps) * 1000) / 10 : 0, position: imps ? Math.round((posW / imps) * 10) / 10 : 0 },
                };
              }
            }
          } catch { /* GSC optional */ }
        }

        return Response.json(out);
      },
    },
  },
});
