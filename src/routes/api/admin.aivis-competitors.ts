import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { askUtility } from "./admin.aivis-sync";

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

// Gechunkte Live-Abfrage (10.08.): DataForSEO rechnet je Long-Tail-Target
// ~5-7s und bricht bei ~50s intern ab (50000 Internal Error) — 10 Targets in
// EINEM Task rissen das bei Kunden mit langen Themen-Phrasen (FiH); selbst 5
// schwere Phrasen zusammen scheiterten im Live-Test. Kosten sind PRO TASK
// (~0.10 USD, unabhängig von der Target-Zahl) — deshalb erst EIN Versuch mit
// allen Targets (Normalfall, günstig) und nur bei Fehler der Fallback: max. 3
// Targets pro Task (Worst Case ~21s), parallel, per key zusammengeführt.
async function dfsLiveChunked(
  path: string, targets: any[], platform: string,
): Promise<{ ok: boolean; rows: Array<{ key: string; mentions: number; aiVolume: number }>; brands: any[]; error?: string; cost: number }> {
  const first = await dfsLive(path, { target: targets, platform, items_list_limit: 10 });
  let res: Array<{ ok: boolean; result?: any; error?: string; cost?: number }>;
  if (first.ok || targets.length <= 3) {
    res = [first];
  } else {
    const chunks: any[][] = [];
    for (let i = 0; i < targets.length; i += 3) chunks.push(targets.slice(i, i + 3));
    res = await Promise.all(chunks.map((t) =>
      dfsLive(path, { target: t, platform, items_list_limit: 10 })));
    res.push(first); // fürs Cost-Aggregat; first.ok ist false → zählt nicht als Treffer
  }
  const okRes = res.filter((r) => r.ok);
  if (!okRes.length) return { ok: false, rows: [], brands: [], error: res[0]?.error, cost: 0 };
  const byKey = new Map<string, { key: string; mentions: number; aiVolume: number }>();
  const brandByKey = new Map<string, { key: string; mentions: number; aiVolume: number }>();
  for (const r of okRes) {
    for (const row of rowsOf(r.result)) {
      const m = byKey.get(row.key);
      if (m) { m.mentions += row.mentions; m.aiVolume += row.aiVolume; }
      else byKey.set(row.key, { ...row });
    }
    for (const b of (r.result?.total?.brand_entities_title as any[]) || []) {
      const key = String(b.key || "");
      if (!key) continue;
      const m = brandByKey.get(key);
      const mentions = Number(b.mentions || 0), aiVolume = Number(b.ai_search_volume || 0);
      if (m) { m.mentions += mentions; m.aiVolume += aiVolume; }
      else brandByKey.set(key, { key, mentions, aiVolume });
    }
  }
  const sortDesc = (a: any, b: any) => b.mentions - a.mentions;
  return {
    ok: true,
    rows: [...byKey.values()].sort(sortDesc).slice(0, 10),
    brands: [...brandByKey.values()].sort(sortDesc).slice(0, 10),
    error: okRes.length < res.length ? res.find((r) => !r.ok)?.error : undefined,
    cost: res.reduce((a, r) => a + (r.cost || 0), 0),
  };
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
          // Häufigste Themen zuerst — DataForSEO erlaubt max. 10 target-Items
          // (40501 bei mehr; fiel erst bei Kunden mit >10 Themen auf).
          const freq = new Map<string, number>();
          for (const p of prompts || []) {
            const t = String(p.topic || "").trim();
            if (t.length >= 3) freq.set(t, (freq.get(t) || 0) + 1);
          }
          topics = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
        }
        if (!topics.length) topics = [client.name];
        const targets = topics.slice(0, 10).map((t) => ({ keyword: t, match_type: "partial_match" }));

        let [domains, pages] = await Promise.all([
          dfsLiveChunked("ai_optimization/llm_mentions/top_domains/live", targets, platform),
          dfsLiveChunked("ai_optimization/llm_mentions/top_pages/live", targets, platform),
        ]);
        if (!domains.ok && !pages.ok)
          return Response.json({ ok: false, error: domains.error || pages.error }, { status: 502 });

        // Sprach-Fallback (10.08., live verifiziert): der LLM-Mentions-Korpus
        // ist praktisch rein englisch — selbst "Kaffeemaschine"/"Krankenkasse"
        // liefern 0 Treffer, "coffee machine" sofort Daten. Bleiben die
        // (deutschen) Themen komplett leer, werden sie einmal auf Englisch
        // übersetzt und erneut gemessen — als klar gekennzeichnete
        // internationale Sicht statt eines dauerhaft leeren Tabs.
        let note: string | undefined;
        let usedTargets = targets;
        // Debug-Sicht (10.08.): build + was der Sprach-Fallback getan hat —
        // ohne das ist "leer" von "Fallback lief nicht" extern nicht
        // unterscheidbar (kostete beim 12b5fb5-Rollout eine Debug-Runde).
        const fb: any = { tried: false };
        const empty = !domains.rows.length && !pages.rows.length && !domains.brands.length;
        if (empty) {
          fb.tried = true;
          // Die Mentions-DB matcht Phrasen als Wortfolge: Einzelwörter treffen
          // ("charity", "donation"), Mehrwort-Kombis fast nie ("water charity"
          // = 0; Ausnahme sehr gängige Produkt-Phrasen wie "coffee machine").
          // Deshalb Kern-BEGRIFFE statt Übersetzungen.
          const txt = await askUtility(
            `Destilliere aus diesen Such-Themen die gebräuchlichsten ENGLISCHEN Kernbegriffe der Branche (bevorzugt EIN einzelnes Wort, max. 2 nur bei festen Begriffen wie "coffee machine"; generisch statt wörtlich — "Günstiges Brunnengeschenk Schweiz" → "charity"). Dubletten weglassen, 5-10 Begriffe. Antworte NUR mit JSON-Array aus Strings:\n${JSON.stringify(topics.slice(0, 10))}`,
            800,
          ).catch(() => null);
          const arr = (() => { const m = String(txt || "").match(/\[[\s\S]*\]/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } })();
          const en = Array.isArray(arr) ? [...new Set(arr.map((s: any) => String(s).trim()).filter((s: string) => s.length >= 3))].slice(0, 10) : [];
          fb.en = en; fb.llmOk = !!txt;
          if (en.length) {
            const targetsEn = en.map((t) => ({ keyword: t, match_type: "partial_match" }));
            const [dEn, pEn] = await Promise.all([
              dfsLiveChunked("ai_optimization/llm_mentions/top_domains/live", targetsEn, platform),
              dfsLiveChunked("ai_optimization/llm_mentions/top_pages/live", targetsEn, platform),
            ]);
            fb.enRows = { domains: dEn.rows.length, pages: pEn.rows.length, brands: dEn.brands.length, dErr: dEn.error, pErr: pEn.error };
            if ((dEn.ok || pEn.ok) && (dEn.rows.length || pEn.rows.length || dEn.brands.length)) {
              dEn.cost += (domains.cost || 0); pEn.cost += (pages.cost || 0);
              domains = dEn; pages = pEn; usedTargets = targetsEn;
              note = "Die Mentions-Datenbank deckt deutschsprachige Themen (noch) nicht ab — gezeigt wird die internationale Sicht über die englisch übersetzten Themen.";
            }
          }
        }

        return Response.json(
          {
            ok: true,
            build: "2026-08-10-lang-fallback",
            client: { id: client.id, name: client.name, domain: client.domain || "" },
            platform,
            targets: usedTargets.map((t) => t.keyword),
            note,
            fallback: fb,
            domains: domains.rows,
            pages: pages.rows,
            brands: domains.brands,
            cost: (domains.cost || 0) + (pages.cost || 0),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
