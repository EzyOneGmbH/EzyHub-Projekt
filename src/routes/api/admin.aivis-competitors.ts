import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { askUtility } from "./admin.aivis-sync";

// KI-Konkurrenz (06.08.2026, DataForSEO LLM Mentions top_domains/top_pages):
// GET ?client=<uuid>&platform=google|chat_gpt liefert, welche Domains/Seiten
// in den LLM-Antworten zu den Mess-Themen des Kunden am häufigsten zitiert
// werden — die "Wer gewinnt die KI-Antworten in deinem Markt"-Sicht.
//
// Umbau 10.08.2026 nach Live-Vermessung des Mentions-Korpus:
// - Der Korpus ist praktisch REIN ENGLISCH ("Kaffeemaschine"/"Krankenkasse"
//   = 0 Treffer, "coffee machine" sofort Daten) → Themen werden per Utility-
//   LLM zu 5 englischen KERNBEGRIFFEN destilliert (bevorzugt Einzelwörter:
//   "charity" trifft, "water charity" nicht).
// - EIN Begriff ohne Treffer leert das GESAMTE Ergebnis (6 gute + 1 toter
//   = 0 Items) → bei leerem Batch werden die Begriffe einzeln abgefragt und
//   die Treffer per key zusammengeführt.
// - >10 Targets → 40501; lange Phrasen-Kombis → 50000 (internes ~50s-Limit).
// - Kosten sind PRO TASK (~0.10 USD) → 24h-Cache je Kunde+Plattform in
//   audit_runs (audit_type ki_konkurrenz), ?refresh=1 erzwingt neu.
// Die Mentions-DB kennt KEINEN location-Parameter (Länder stecken als
// Aggregat-Split in der Antwort).
//
// Auth: eingeloggter EzyHub-User (RLS via can_access_client) oder
// ADMIN_AUTOMATION_SECRET (konsistent mit llm-traffic/site-health).

const BUILD = "2026-08-10-core-terms";

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

// Aggregat-Zeile: mentions/ai_search_volume stecken je Eintrag im platform-
// bzw. location-Split (die API liefert je nach Filter das eine oder andere).
function rowsOf(result: any): Array<{ key: string; mentions: number; aiVolume: number }> {
  return ((result?.items as any[]) || []).map((it) => {
    const split = Array.isArray(it.platform) ? it.platform : Array.isArray(it.location) ? it.location : [];
    return {
      key: String(it.key || ""),
      mentions: split.reduce((a: number, p: any) => a + Number(p.mentions || 0), 0),
      aiVolume: split.reduce((a: number, p: any) => a + Number(p.ai_search_volume || 0), 0),
    };
  }).filter((r) => r.key);
}

type Row = { key: string; mentions: number; aiVolume: number };
function mergeInto(map: Map<string, Row>, rows: Row[]) {
  for (const row of rows) {
    const m = map.get(row.key);
    if (m) { m.mentions += row.mentions; m.aiVolume += row.aiVolume; }
    else map.set(row.key, { ...row });
  }
}
function brandsOf(result: any): Row[] {
  return (((result?.total?.brand_entities_title as any[]) || []))
    .map((b) => ({ key: String(b.key || ""), mentions: Number(b.mentions || 0), aiVolume: Number(b.ai_search_volume || 0) }))
    .filter((b) => b.key);
}

// Erst EIN Batch-Task mit allen Begriffen (günstig); bleibt er leer oder
// scheitert er, Einzel-Abfragen je Begriff parallel + Merge — tote Begriffe
// fallen dabei einfach weg statt alles zu leeren.
async function queryTerms(
  path: string, terms: string[], platform: string,
): Promise<{ ok: boolean; rows: Row[]; brands: Row[]; error?: string; cost: number; singles: boolean }> {
  const mk = (kws: string[]) => ({
    target: kws.map((k) => ({ keyword: k, match_type: "partial_match" })),
    platform, items_list_limit: 10,
  });
  const batch = await dfsLive(path, mk(terms));
  let cost = batch.cost || 0;
  if (batch.ok && ((batch.result?.items || []).length || brandsOf(batch.result).length)) {
    return { ok: true, rows: rowsOf(batch.result).slice(0, 10), brands: brandsOf(batch.result).slice(0, 10), cost, singles: false };
  }
  const singles = await Promise.all(terms.map((t) => dfsLive(path, mk([t]))));
  const rowMap = new Map<string, Row>(), brandMap = new Map<string, Row>();
  let anyOk = false;
  for (const s of singles) {
    cost += s.cost || 0;
    if (!s.ok) continue;
    anyOk = true;
    mergeInto(rowMap, rowsOf(s.result));
    mergeInto(brandMap, brandsOf(s.result));
  }
  const byMentions = (a: Row, b: Row) => b.mentions - a.mentions;
  if (!anyOk && !batch.ok) return { ok: false, rows: [], brands: [], error: batch.error || singles.find((s) => !s.ok)?.error, cost, singles: true };
  return {
    ok: true,
    rows: [...rowMap.values()].sort(byMentions).slice(0, 10),
    brands: [...brandMap.values()].sort(byMentions).slice(0, 10),
    cost, singles: true,
  };
}

const CACHE_TYPE = "ki_konkurrenz";
const CACHE_MS = 24 * 3600 * 1000;

export const Route = createFileRoute("/api/admin/aivis-competitors")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const u = new URL(request.url);
        const clientId = u.searchParams.get("client") || "";
        const platform = u.searchParams.get("platform") === "chat_gpt" ? "chat_gpt" : "google";
        const refresh = u.searchParams.get("refresh") === "1";
        if (!/^[0-9a-f-]{36}$/i.test(clientId))
          return Response.json({ ok: false, error: "client (uuid) erforderlich" }, { status: 400 });

        // Zugriff prüft die RLS-Sicht des eingeloggten Users (oder Admin-Secret).
        const db = auth.userClient ?? (supabaseAdmin as any);
        const { data: client } = await db
          .from("clients").select("id, name, domain, organization_id").eq("id", clientId).maybeSingle();
        if (!client) return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });

        // 24h-Cache (audit_runs) — Kosten sind pro DataForSEO-Task.
        const sbA = supabaseAdmin as any;
        if (!refresh) {
          const since = new Date(Date.now() - CACHE_MS).toISOString();
          const { data: cached } = await sbA
            .from("audit_runs").select("result, created_at")
            .eq("client_id", clientId).eq("audit_type", CACHE_TYPE).eq("status", "succeeded")
            .eq("input->>platform", platform).gte("created_at", since)
            .order("created_at", { ascending: false }).limit(1).maybeSingle();
          if (cached?.result?.ok)
            return Response.json({ ...cached.result, cached: true, cachedAt: cached.created_at }, { headers: { "Cache-Control": "no-store" } });
        }

        // Themen des neuesten aivis-Reports, häufigste zuerst.
        const { data: rep } = await db
          .from("ai_visibility_reports").select("id").eq("client_id", clientId)
          .order("snapshot_date", { ascending: false }).limit(1).maybeSingle();
        let topics: string[] = [];
        if (rep?.id) {
          const { data: prompts } = await db
            .from("ai_visibility_prompts").select("topic").eq("report_id", rep.id).limit(1000);
          const freq = new Map<string, number>();
          for (const p of prompts || []) {
            const t = String(p.topic || "").trim();
            if (t.length >= 3) freq.set(t, (freq.get(t) || 0) + 1);
          }
          topics = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
        }
        if (!topics.length) topics = [client.name];

        // 5 englische Kernbegriffe der Branche destillieren (Korpus-Realität).
        const txt = await askUtility(
          `Destilliere aus diesen Such-Themen der Firma "${client.name}" die 5 gebräuchlichsten ENGLISCHEN Kernbegriffe ihrer Branche (bevorzugt EIN einzelnes gängiges Wort, max. 2 nur bei festen Begriffen wie "coffee machine"; generisch statt wörtlich — "Günstiges Brunnengeschenk Schweiz" → "charity"). Keine Dubletten, keine seltenen Wörter. Antworte NUR mit JSON-Array aus 5 Strings:\n${JSON.stringify(topics.slice(0, 15))}`,
          600,
        ).catch(() => null);
        const arr = (() => { const m = String(txt || "").match(/\[[\s\S]*\]/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } })();
        const terms = Array.isArray(arr)
          ? [...new Set(arr.map((s: any) => String(s).trim()).filter((s: string) => s.length >= 3))].slice(0, 5)
          : [];
        if (!terms.length)
          return Response.json({ ok: false, error: "Kernbegriffe nicht ableitbar (Utility-LLM)" }, { status: 502 });

        const [domains, pages] = await Promise.all([
          queryTerms("ai_optimization/llm_mentions/top_domains/live", terms, platform),
          queryTerms("ai_optimization/llm_mentions/top_pages/live", terms, platform),
        ]);
        if (!domains.ok && !pages.ok)
          return Response.json({ ok: false, error: domains.error || pages.error }, { status: 502 });

        const payload = {
          ok: true,
          build: BUILD,
          client: { id: client.id, name: client.name, domain: client.domain || "" },
          platform,
          targets: terms,
          note: "Messung über englische Kernbegriffe der Branche — der LLM-Mentions-Korpus von DataForSEO ist englischsprachig (internationale Sicht). Aktualisierung max. 1×/Tag.",
          domains: domains.rows,
          pages: pages.rows,
          brands: domains.brands,
          cost: (domains.cost || 0) + (pages.cost || 0),
        };

        // Cache-Write additiv; Fehler hier dürfen die Antwort nie kippen.
        // triggered_by ist NOT NULL → Org-Owner wie in ai-citations/llm-responses.
        try {
          const { data: users } = await sbA
            .from("app_users").select("user_id, role")
            .eq("organization_id", client.organization_id).limit(20);
          const owner = (users || []).find((u: any) => ["owner", "admin"].includes(u.role)) || (users || [])[0];
          if (owner) {
            const { error: insErr } = await sbA.from("audit_runs").insert({
              organization_id: client.organization_id,
              client_id: clientId,
              triggered_by: owner.user_id,
              audit_type: CACHE_TYPE,
              status: "succeeded",
              input: { platform, terms },
              result: payload,
              started_at: new Date().toISOString(),
              finished_at: new Date().toISOString(),
            });
            if (insErr) console.warn("ki_konkurrenz cache-write:", insErr.message);
          }
        } catch { /* Cache ist Komfort */ }

        return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
