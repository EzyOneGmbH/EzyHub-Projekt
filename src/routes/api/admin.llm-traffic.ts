import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "@/server/google-tokens.server";

// LLM Analytics (05.08.2026, Searchable-Nachbau "/ai-traffic"):
// GET ?client=<uuid>&days=<1..365, Default 30> liefert die GA4-Seite des
// Bereichs — KI-Referral-Sessions als Tages-Zeitreihe je Engine plus die
// meistbesuchten Landingpages je Engine. Die Crawler-Seite (ai_crawler_hits)
// liest die UI direkt über die RLS des eingeloggten Users.
//
// Auth: eingeloggter EzyHub-User; Kunden-Sichtbarkeit über RLS (can_access_client).

// GA4 sessionSource -> Engine-Label (identisch zur aivis-Attribution).
const ENGINES: Array<{ name: string; re: RegExp }> = [
  { name: "ChatGPT", re: /chatgpt|openai/i },
  { name: "Perplexity", re: /perplexity/i },
  { name: "Gemini", re: /gemini|bard/i },
  { name: "Claude", re: /claude|anthropic/i },
  { name: "Copilot", re: /copilot|bing/i },
  { name: "Grok", re: /grok|x\.ai/i },
  { name: "DeepSeek", re: /deepseek/i },
];

async function requireUser(request: Request): Promise<{ userClient: any } | Response> {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return Response.json({ ok: false, error: "Server not configured" }, { status: 503 });
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
  });
  const { data } = await userClient.auth.getUser();
  if (!data.user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return { userClient };
}

export const Route = createFileRoute("/api/admin/llm-traffic")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const u = new URL(request.url);
        const clientId = u.searchParams.get("client") || "";
        const days = Math.min(365, Math.max(1, Number(u.searchParams.get("days")) || 30));
        if (!/^[0-9a-f-]{36}$/i.test(clientId))
          return Response.json({ ok: false, error: "client (uuid) erforderlich" }, { status: 400 });
        // RLS-gefilterte Sicht: existiert der Kunde für diesen User?
        const { data: client } = await auth.userClient
          .from("clients")
          .select("id, name, ga4_property")
          .eq("id", clientId)
          .maybeSingle();
        if (!client) return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });
        if (!client.ga4_property) return Response.json({ ok: true, ga4: false });

        let token: string;
        try {
          token = (await getGoogleAccessToken(clientId)).accessToken;
        } catch (e) {
          return Response.json({ ok: true, ga4: false, note: "Google-Token: " + String((e as any)?.message || e).slice(0, 120) });
        }
        const propertyId = String(client.ga4_property).replace(/^properties\//, "");
        const run = (body: any) =>
          fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }], ...body }),
            signal: AbortSignal.timeout(25_000),
          });

        const [tsRes, pgRes] = await Promise.all([
          run({
            dimensions: [{ name: "date" }, { name: "sessionSource" }],
            metrics: [{ name: "sessions" }, { name: "newUsers" }],
            limit: 20000,
          }),
          run({
            dimensions: [{ name: "landingPagePlusQueryString" }, { name: "sessionSource" }],
            metrics: [{ name: "sessions" }],
            limit: 10000,
          }),
        ]);

        // Zeitreihe: Tag -> Engine -> {sessions, newUsers}
        const byDay = new Map<string, Record<string, { sessions: number; newUsers: number }>>();
        const totals: Record<string, { sessions: number; newUsers: number }> = {};
        if (tsRes.ok) {
          const j: any = await tsRes.json().catch(() => ({}));
          for (const row of j.rows ?? []) {
            const date = String(row.dimensionValues?.[0]?.value ?? "");
            const src = String(row.dimensionValues?.[1]?.value ?? "");
            const eng = ENGINES.find((e) => e.re.test(src));
            if (!eng || !date) continue;
            const sessions = Number(row.metricValues?.[0]?.value ?? 0);
            const newUsers = Number(row.metricValues?.[1]?.value ?? 0);
            const day = byDay.get(date) ?? {};
            day[eng.name] = {
              sessions: (day[eng.name]?.sessions ?? 0) + sessions,
              newUsers: (day[eng.name]?.newUsers ?? 0) + newUsers,
            };
            byDay.set(date, day);
            totals[eng.name] = {
              sessions: (totals[eng.name]?.sessions ?? 0) + sessions,
              newUsers: (totals[eng.name]?.newUsers ?? 0) + newUsers,
            };
          }
        }
        const timeseries = [...byDay.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([date, byEngine]) => ({ date, byEngine }));

        // Top-Landingpages je Engine (Top 10).
        const pagesByEngine: Record<string, Array<{ path: string; sessions: number }>> = {};
        if (pgRes.ok) {
          const j: any = await pgRes.json().catch(() => ({}));
          const agg = new Map<string, number>(); // engine \\n path -> sessions
          for (const row of j.rows ?? []) {
            const path = String(row.dimensionValues?.[0]?.value ?? "");
            const src = String(row.dimensionValues?.[1]?.value ?? "");
            const eng = ENGINES.find((e) => e.re.test(src));
            const n = Number(row.metricValues?.[0]?.value ?? 0);
            if (!eng || !path || n <= 0) continue;
            const key = `${eng.name}\\n${path}`;
            agg.set(key, (agg.get(key) ?? 0) + n);
          }
          for (const [key, sessions] of agg) {
            const [engine, path] = key.split("\\n");
            (pagesByEngine[engine] ??= []).push({ path, sessions });
          }
          for (const k of Object.keys(pagesByEngine))
            pagesByEngine[k] = pagesByEngine[k].sort((a, b) => b.sessions - a.sessions).slice(0, 10);
        }

        return Response.json({ ok: true, ga4: true, days, timeseries, totals, pagesByEngine });
      },
    },
  },
});
