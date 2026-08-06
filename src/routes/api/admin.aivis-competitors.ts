import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// KI-Konkurrenz (06.08.2026, DataForSEO LLM Mentions top_domains/top_pages):
// GET ?client=<uuid>&platform=google|chat_gpt liefert, welche Domains/Seiten
// in den LLM-Antworten zu den Mess-Themen des Kunden am häufigsten zitiert
// werden — die "Wer gewinnt die KI-Antworten in deinem Markt"-Sicht.
// Targets = die Topics der aivis-Prompts des neuesten Reports (max 30).
// Die Mentions-DB kennt KEINEN location-Parameter (Länder stecken als
// Aggregat-Split in der Antwort); Antwort-Shape live verifiziert 2026-08-06:
// result[0].items[] = { key: domain|url, platform:[{mentions, ai_search_volume}] },
// result[0].total.brand_entities_title = meist-genannte Marken.
//
// Auth: eingeloggter EzyHub-User (RLS via can_access_client) oder
// ADMIN_AUTOMATION_SECRET (konsistent mit llm-traffic/site-health).

async function requireUser(request: Request): Promise<{ userClient: any | null } | Response> {
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

function dfsAuth(): string | null {
  const login = process.env.DATAFORSEO_LOGIN, pass = process.env.DATAFORSEO_PASSWORD;
  if (!login || !pass) return null;
  return "Basic " + Buffer.from(`${login}:${pass}`).toString("base64");
}

async function dfsLive(path: string, task: any): Promise<{ ok: boolean; result?: any; error?: string; cost?: number }> {
  const auth = dfsAuth();
  if (!auth) return { ok: false, error: "DATAFORSEO_LOGIN/PASSWORD fehlt" };
  try {
    const r = await fetch(`https://api.dataforseo.com/v3/${path}`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify([task]),
      signal: AbortSignal.timeout(60_000),
    });
    const j: any = await r.json().catch(() => ({}));
    const t = j?.tasks?.[0];
    if (j.status_code !== 20000 || !t || t.status_code !== 20000)
      return { ok: false, error: `${t?.status_code || j.status_code} ${t?.status_message || ""}`.trim() };
    return { ok: true, result: t.result?.[0] || null, cost: Number(j.cost || 0) };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 160) };
  }
}

// Aggregat-Zeile: mentions/ai_search_volume stecken je Eintrag im platform-Split.
function rowsOf(result: any): Array<{ key: string; mentions: number; aiVolume: number }> {
  return ((result?.items as any[]) || []).map((it) => {
    const plat = Array.isArray(it.platform) ? it.platform : [];
    return {
      key: String(it.key || ""),
      mentions: plat.reduce((a: number, p: any) => a + Number(p.mentions || 0), 0),
      aiVolume: plat.reduce((a: number, p: any) => a + Number(p.ai_search_volume || 0), 0),
    };
  }).filter((r) => r.key);
}

export const Route = createFileRoute("/api/admin/aivis-competitors")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const u = new URL(request.url);
        const clientId = u.searchParams.get("client") || "";
        const platform = u.searchParams.get("platform") === "chat_gpt" ? "chat_gpt" : "google";
        if (!/^[0-9a-f-]{36}$/i.test(clientId))
          return Response.json({ ok: false, error: "client (uuid) erforderlich" }, { status: 400 });

        const db = auth.userClient ?? (supabaseAdmin as any);
        const { data: client } = await db
          .from("clients").select("id, name, domain").eq("id", clientId).maybeSingle();
        if (!client) return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });

        // Themen des neuesten aivis-Reports als Mess-Targets.
        const { data: rep } = await db
          .from("ai_visibility_reports").select("id").eq("client_id", clientId)
          .order("snapshot_date", { ascending: false }).limit(1).maybeSingle();
        let topics: string[] = [];
        if (rep?.id) {
          const { data: prompts } = await db
            .from("ai_visibility_prompts").select("topic").eq("report_id", rep.id).limit(1000);
          topics = [...new Set((prompts || []).map((p: any) => String(p.topic || "").trim()).filter((t: string) => t.length >= 3))] as string[];
        }
        if (!topics.length) topics = [client.name];
        const targets = topics.slice(0, 30).map((t) => ({ keyword: t, match_type: "partial_match" }));

        const base = { target: targets, platform, items_list_limit: 10 };
        const [domains, pages] = await Promise.all([
          dfsLive("ai_optimization/llm_mentions/top_domains/live", base),
          dfsLive("ai_optimization/llm_mentions/top_pages/live", base),
        ]);
        if (!domains.ok && !pages.ok)
          return Response.json({ ok: false, error: domains.error || pages.error }, { status: 502 });

        const brands = (((domains.result?.total?.brand_entities_title as any[]) || []))
          .map((b) => ({ key: String(b.key || ""), mentions: Number(b.mentions || 0), aiVolume: Number(b.ai_search_volume || 0) }))
          .filter((b) => b.key).slice(0, 10);

        return Response.json(
          {
            ok: true,
            client: { id: client.id, name: client.name, domain: client.domain || "" },
            platform,
            targets: targets.map((t) => t.keyword),
            domains: rowsOf(domains.result),
            pages: rowsOf(pages.result),
            brands,
            cost: (domains.cost || 0) + (pages.cost || 0),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
