import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { askUtility } from "./admin.aivis-sync";

// KI-Konkurrenz (06.08.2026): GET ?client=<uuid>&platform=google|chat_gpt —
// welche Domains/Seiten/Marken die KI-Antworten im Markt des Kunden dominieren.
//
// Umbau 12.08.2026 nach Live-Vermessung der neuen LLM-Mentions-API:
// - Der Korpus ist NICHT rein englisch (Korrektur zum 10.08.): es gibt einen
//   DACH-Google-Slice (location_name/language_code auf aggregated_metrics +
//   search — "Kaffeemaschine" = 443 CH-Treffer). Die top_*-Endpoints kennen
//   diese Felder aber NICHT (40501) und liefern fix den globalen EN-Korpus.
// - platform=google misst deshalb jetzt ECHT SCHWEIZERISCH: deutsche Kern-
//   begriffe → search/live (CH/de, limit je Begriff) → Domains/URLs/Marken
//   werden aus den Antwort-Quellen SELBST aggregiert (~$0.15/Begriff).
// - platform=chat_gpt bleibt global/englisch (der ChatGPT-Slice akzeptiert
//   keine Location — live verifiziert): EN-Kernbegriffe via top_mentioned_*;
//   Marken über den neuen top_mentioned_brands-Endpoint (nur chat_gpt).
// - NEUE Endpoint-Namen (top_mentioned_domains etc.) haben ANDERE Shapes
//   (domain/brand statt key, limit statt items_list_limit) und KEINEN
//   location-Support — Umstellung der location-fähigen Alt-Pfade (search/
//   aggregated_metrics) wäre aktuell eine Verschlechterung. Bewusst gemischt.
// - ?trend=1: KI-Erwähnungs-Trend der KUNDEN-DOMAIN (historical/live +
//   timeseries_new_lost/live, Daten ab 2025-08, domain-basiert = sprach-
//   unabhängig), eigener 7-Tage-Cache (audit_type ki_mentions_trend).
// - Caches in audit_runs (Kosten pro Task!); ?refresh=1 erzwingt neu.
//
// Auth: eingeloggter EzyHub-User (RLS via can_access_client) oder
// ADMIN_AUTOMATION_SECRET (konsistent mit llm-traffic/site-health).

const BUILD = "2026-08-12-ch-corpus";

async function requireUser(request: Request): Promise<{ userClient: any | null } | Response> {
  const admin = process.env.ADMIN_AUTOMATION_SECRET;
  const auth = request.headers.get("authorization") || "";
  if (admin && auth === `Bearer ${admin}`) return { userClient: null };
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anon)
    return Response.json({ ok: false, error: "Server not configured" }, { status: 503 });
  const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data } = await userClient.auth.getUser();
  if (!data.user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return { userClient };
}

function dfsAuth(): string | null {
  const login = process.env.DATAFORSEO_LOGIN,
    pass = process.env.DATAFORSEO_PASSWORD;
  if (!login || !pass) return null;
  return "Basic " + Buffer.from(`${login}:${pass}`).toString("base64");
}

async function dfsLive(
  path: string,
  task: any,
): Promise<{ ok: boolean; result?: any; error?: string; cost?: number }> {
  const auth = dfsAuth();
  if (!auth) return { ok: false, error: "DATAFORSEO_LOGIN/PASSWORD fehlt" };
  try {
    const r = await fetch(`https://api.dataforseo.com/v3/${path}`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify([task]),
      signal: AbortSignal.timeout(90_000),
    });
    const j: any = await r.json().catch(() => ({}));
    const t = j?.tasks?.[0];
    if (j.status_code !== 20000 || !t || t.status_code !== 20000)
      return {
        ok: false,
        error: `${t?.status_code || j.status_code} ${t?.status_message || ""}`.trim(),
      };
    return { ok: true, result: t.result?.[0] || null, cost: Number(j.cost || 0) };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 160) };
  }
}

type Row = { key: string; mentions: number; aiVolume: number };
function mergeInto(map: Map<string, Row>, rows: Row[]) {
  for (const row of rows) {
    const m = map.get(row.key);
    if (m) {
      m.mentions += row.mentions;
      m.aiVolume += row.aiVolume;
    } else map.set(row.key, { ...row });
  }
}
const byMentions = (a: Row, b: Row) => b.mentions - a.mentions;

// ── Global/EN-Pfad (chat_gpt): top_mentioned_*-Endpoints ─────────────────────
// Alte Shapes (key + platform/location-Split); ein toter Begriff leert das
// GESAMTE Batch-Ergebnis → bei Leere Einzel-Abfragen mit Merge (10.08.).
function rowsOf(result: any): Row[] {
  return ((result?.items as any[]) || [])
    .map((it) => {
      const split = Array.isArray(it.platform)
        ? it.platform
        : Array.isArray(it.location)
          ? it.location
          : [];
      return {
        key: String(it.key || it.domain || it.page || ""),
        mentions: split.reduce((a: number, p: any) => a + Number(p.mentions || 0), 0),
        aiVolume: split.reduce((a: number, p: any) => a + Number(p.ai_search_volume || 0), 0),
      };
    })
    .filter((r) => r.key);
}
function brandsOf(result: any): Row[] {
  return ((result?.total?.brand_entities_title as any[]) || [])
    .map((b) => ({
      key: String(b.key || ""),
      mentions: Number(b.mentions || 0),
      aiVolume: Number(b.ai_search_volume || 0),
    }))
    .filter((b) => b.key);
}
async function queryTerms(
  path: string,
  terms: string[],
  platform: string,
): Promise<{ ok: boolean; rows: Row[]; brands: Row[]; error?: string; cost: number }> {
  const mk = (kws: string[]) => ({
    target: kws.map((k) => ({ keyword: k, match_type: "partial_match" })),
    platform,
    items_list_limit: 10,
  });
  const batch = await dfsLive(path, mk(terms));
  let cost = batch.cost || 0;
  if (batch.ok && ((batch.result?.items || []).length || brandsOf(batch.result).length)) {
    return {
      ok: true,
      rows: rowsOf(batch.result).slice(0, 10),
      brands: brandsOf(batch.result).slice(0, 10),
      cost,
    };
  }
  const singles = await Promise.all(terms.map((t) => dfsLive(path, mk([t]))));
  const rowMap = new Map<string, Row>(),
    brandMap = new Map<string, Row>();
  let anyOk = false;
  for (const s of singles) {
    cost += s.cost || 0;
    if (!s.ok) continue;
    anyOk = true;
    mergeInto(rowMap, rowsOf(s.result));
    mergeInto(brandMap, brandsOf(s.result));
  }
  if (!anyOk && !batch.ok)
    return {
      ok: false,
      rows: [],
      brands: [],
      error: batch.error || singles.find((s) => !s.ok)?.error,
      cost,
    };
  return {
    ok: true,
    rows: [...rowMap.values()].sort(byMentions).slice(0, 10),
    brands: [...brandMap.values()].sort(byMentions).slice(0, 10),
    cost,
  };
}

// Neuer Marken-Endpoint (12.08.): top_mentioned_brands — NEUE Shape
// (brand + platform-Split), Daten nur für chat_gpt.
async function queryBrandsNew(terms: string[]): Promise<{ rows: Row[]; cost: number }> {
  const r = await dfsLive("ai_optimization/llm_mentions/top_mentioned_brands/live", {
    target: terms.map((k) => ({ keyword: k, match_type: "partial_match" })),
    platform: "chat_gpt",
    limit: 15,
  });
  if (!r.ok) return { rows: [], cost: r.cost || 0 };
  const rows = ((r.result?.items as any[]) || [])
    .map((it) => {
      const split = Array.isArray(it.platform) ? it.platform : [];
      return {
        key: String(it.brand || ""),
        mentions: split.reduce((a: number, p: any) => a + Number(p.mentions || 0), 0),
        aiVolume: split.reduce((a: number, p: any) => a + Number(p.ai_search_volume || 0), 0),
      };
    })
    .filter((b: Row) => b.key)
    .slice(0, 10);
  return { rows, cost: r.cost || 0 };
}

// ── CH/de-Pfad (google): search/live mit location + Eigen-Aggregation ────────
// Je Begriff bis zu `limit` echte Antworten aus dem Schweizer Google-AIO-
// Korpus; Domains/URLs/Marken werden aus sources/brand_entities aggregiert.
async function queryChCorpus(
  terms: string[],
  lang: string,
): Promise<{
  ok: boolean;
  domains: Row[];
  pages: Row[];
  brands: Row[];
  answers: number;
  cost: number;
  error?: string;
}> {
  const calls = await Promise.all(
    terms.map((t) =>
      dfsLive("ai_optimization/llm_mentions/search/live", {
        target: [{ keyword: t, match_type: "partial_match" }],
        platform: "google",
        location_name: "Switzerland",
        language_code: lang,
        limit: 50,
      }),
    ),
  );
  const domMap = new Map<string, Row>(),
    pageMap = new Map<string, Row>(),
    brandMap = new Map<string, Row>();
  let cost = 0,
    answers = 0,
    anyOk = false;
  for (const c of calls) {
    cost += c.cost || 0;
    if (!c.ok) continue;
    anyOk = true;
    for (const it of (c.result?.items as any[]) || []) {
      answers += 1;
      const vol = Number(it.ai_search_volume || 0);
      const seenDom = new Set<string>();
      for (const s of it.sources || []) {
        const d = String(s.domain || "")
          .replace(/^www\./, "")
          .toLowerCase();
        if (!d) continue;
        if (!seenDom.has(d)) {
          seenDom.add(d);
          mergeInto(domMap, [{ key: d, mentions: 1, aiVolume: vol }]);
        }
        if (s.url) mergeInto(pageMap, [{ key: String(s.url), mentions: 1, aiVolume: vol }]);
      }
      for (const b of it.brand_entities || []) {
        const name = String(b?.name ?? b ?? "").trim();
        if (name) mergeInto(brandMap, [{ key: name, mentions: 1, aiVolume: vol }]);
      }
    }
  }
  return {
    ok: anyOk,
    answers,
    cost,
    domains: [...domMap.values()].sort(byMentions).slice(0, 10),
    pages: [...pageMap.values()].sort(byMentions).slice(0, 10),
    brands: [...brandMap.values()].sort(byMentions).slice(0, 10),
    error: anyOk ? undefined : calls.find((c) => !c.ok)?.error,
  };
}

// Kernbegriffe destillieren — Sprache je Pfad (de für CH-Korpus, en global).
async function distillTerms(
  clientName: string,
  topics: string[],
  lang: "de" | "en",
  n: number,
): Promise<string[]> {
  const spec =
    lang === "de"
      ? `die ${n} wichtigsten DEUTSCHEN Kernbegriffe ihrer Branche (bevorzugt EIN gängiges Substantiv wie "Architekt" oder "Spende", max. 2 Wörter nur bei festen Begriffen)`
      : `die ${n} gebräuchlichsten ENGLISCHEN Kernbegriffe ihrer Branche (bevorzugt EIN einzelnes gängiges Wort, max. 2 nur bei festen Begriffen wie "coffee machine"; generisch statt wörtlich)`;
  const txt = await askUtility(
    `Destilliere aus diesen Such-Themen der Firma "${clientName}" ${spec}. Keine Dubletten, keine seltenen Wörter. Antworte NUR mit JSON-Array aus ${n} Strings:\n${JSON.stringify(topics.slice(0, 15))}`,
    600,
  ).catch(() => null);
  const m = String(txt || "").match(/\[[\s\S]*\]/);
  const arr = (() => {
    try {
      return m ? JSON.parse(m[0]) : null;
    } catch {
      return null;
    }
  })();
  return Array.isArray(arr)
    ? [
        ...new Set(arr.map((s: any) => String(s).trim()).filter((s: string) => s.length >= 3)),
      ].slice(0, n)
    : [];
}

const CACHE_TYPE = "ki_konkurrenz";
const CACHE_MS = 24 * 3600 * 1000;
const TREND_TYPE = "ki_mentions_trend";
const TREND_CACHE_MS = 7 * 24 * 3600 * 1000;
const GAP_TYPE = "ki_gap_fragen";
const QUESTIONS_TYPE = "ki_korpus_fragen";

// Marken-SoV im Mentions-Korpus (12.08., cross_aggregated_metrics): Kunde vs.
// Top-SoV-Rivalen in EINEM Call; items[].key = aggregation_key, Werte im
// platform/location-Split. google → CH/de-Slice, chat_gpt → global.
async function queryMentionsSov(
  names: Array<{ name: string; isSelf: boolean }>,
  platform: string,
  lang: string,
): Promise<{
  rows: Array<{ name: string; isSelf: boolean; mentions: number; aiVolume: number; share: number }>;
  cost: number;
}> {
  if (names.length < 2) return { rows: [], cost: 0 };
  const task: any = {
    targets: names.slice(0, 6).map((n, i) => ({
      aggregation_key: `t${i}`,
      target: [{ keyword: n.name, match_type: "word_match" }],
    })),
  };
  if (platform === "google") {
    task.location_name = "Switzerland";
    task.language_code = lang;
  } else task.platform = "chat_gpt";
  const r = await dfsLive("ai_optimization/llm_mentions/cross_aggregated_metrics/live", task);
  if (!r.ok) return { rows: [], cost: r.cost || 0 };
  const byKey = new Map<string, { mentions: number; aiVolume: number }>();
  for (const it of (r.result?.items as any[]) || []) {
    const split =
      Array.isArray(it.platform) && it.platform.length
        ? it.platform
        : Array.isArray(it.location)
          ? it.location
          : [];
    byKey.set(String(it.key), {
      mentions: split.reduce((a: number, p: any) => a + Number(p.mentions || 0), 0),
      aiVolume: split.reduce((a: number, p: any) => a + Number(p.ai_search_volume || 0), 0),
    });
  }
  const rows = names.slice(0, 6).map((n, i) => {
    const v = byKey.get(`t${i}`) || { mentions: 0, aiVolume: 0 };
    return { name: n.name, isSelf: n.isSelf, ...v, share: 0 };
  });
  const total = rows.reduce((a, b) => a + b.mentions, 0);
  for (const row of rows) row.share = total ? Math.round((row.mentions / total) * 100) : 0;
  return { rows: rows.sort((a, b) => b.mentions - a.mentions), cost: r.cost || 0 };
}

// Brand-Kategorien (12.08., top_mentioned_brand_categories, nur chat_gpt):
// in welche Kategorien die KI die Branche der Kernbegriffe einsortiert.
async function queryBrandCategories(terms: string[]): Promise<{ rows: Row[]; cost: number }> {
  const r = await dfsLive("ai_optimization/llm_mentions/top_mentioned_brand_categories/live", {
    target: terms.map((k) => ({ keyword: k, match_type: "partial_match" })),
    platform: "chat_gpt",
    limit: 10,
  });
  if (!r.ok) return { rows: [], cost: r.cost || 0 };
  const rows = ((r.result?.items as any[]) || [])
    .map((it) => {
      const split = Array.isArray(it.platform) ? it.platform : [];
      return {
        key: String(it.category ?? it.brand_category ?? it.key ?? ""),
        mentions: split.reduce((a: number, p: any) => a + Number(p.mentions || 0), 0),
        aiVolume: split.reduce((a: number, p: any) => a + Number(p.ai_search_volume || 0), 0),
      };
    })
    .filter((b: Row) => b.key)
    .slice(0, 8);
  return { rows, cost: r.cost || 0 };
}

async function cacheRead(
  sbA: any,
  clientId: string,
  type: string,
  maxAge: number,
  platform?: string,
) {
  const since = new Date(Date.now() - maxAge).toISOString();
  let q = sbA
    .from("audit_runs")
    .select("result, created_at")
    .eq("client_id", clientId)
    .eq("audit_type", type)
    .eq("status", "succeeded")
    .gte("created_at", since);
  if (platform) q = q.eq("input->>platform", platform);
  const { data } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data?.result?.ok ? { ...data.result, cached: true, cachedAt: data.created_at } : null;
}

async function cacheWrite(sbA: any, client: any, type: string, input: any, payload: any) {
  // triggered_by ist NOT NULL → Org-Owner-Muster (wie ai-citations).
  try {
    const { data: users } = await sbA
      .from("app_users")
      .select("user_id, role")
      .eq("organization_id", client.organization_id)
      .limit(20);
    const owner =
      (users || []).find((u: any) => ["owner", "admin"].includes(u.role)) || (users || [])[0];
    if (!owner) return;
    const { error } = await sbA.from("audit_runs").insert({
      organization_id: client.organization_id,
      client_id: client.id,
      triggered_by: owner.user_id,
      audit_type: type,
      status: "succeeded",
      input,
      result: payload,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    });
    if (error) console.warn(`${type} cache-write:`, error.message);
  } catch {
    /* Cache ist Komfort */
  }
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
        const refresh = u.searchParams.get("refresh") === "1";
        const wantTrend = u.searchParams.get("trend") === "1";
        if (!/^[0-9a-f-]{36}$/i.test(clientId))
          return Response.json({ ok: false, error: "client (uuid) erforderlich" }, { status: 400 });

        // Zugriff prüft die RLS-Sicht des eingeloggten Users (oder Admin-Secret).
        const db = auth.userClient ?? (supabaseAdmin as any);
        const { data: client } = await db
          .from("clients")
          .select("id, name, domain, organization_id, language")
          .eq("id", clientId)
          .maybeSingle();
        if (!client)
          return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });
        const sbA = supabaseAdmin as any;

        // ── Trend-Modus: KI-Erwähnungs-Verlauf der Kunden-Domain ─────────────
        if (wantTrend) {
          const domain = String(client.domain || "")
            .replace(/^https?:\/\//, "")
            .replace(/^www\./, "")
            .replace(/\/.*$/, "");
          if (!domain)
            return Response.json({ ok: false, error: "Kunde hat keine Domain" }, { status: 400 });
          if (!refresh) {
            const hit = await cacheRead(sbA, clientId, TREND_TYPE, TREND_CACHE_MS);
            if (hit) return Response.json(hit, { headers: { "Cache-Control": "no-store" } });
          }
          const now = new Date();
          const dateTo = now.toISOString().slice(0, 10);
          const dateFrom = new Date(now.getTime() - 365 * 864e5).toISOString().slice(0, 10);
          const tgt = { target: [{ domain }] };
          const [histG, histC, nl] = await Promise.all([
            dfsLive("ai_optimization/llm_mentions/historical/live", { ...tgt, platform: "google" }),
            dfsLive("ai_optimization/llm_mentions/historical/live", {
              ...tgt,
              platform: "chat_gpt",
            }),
            dfsLive("ai_optimization/llm_mentions/timeseries_new_lost/live", {
              ...tgt,
              platform: "chat_gpt",
              date_from: dateFrom,
              date_to: dateTo,
              group_range: "month",
            }),
          ]);
          const monthly = (r: any) =>
            ((r?.result?.items as any[]) || [])
              .map((it) => ({
                y: Number(it.year),
                m: Number(it.month),
                mentions: Number(it.metrics?.mentions || 0),
                aiVolume: Number(it.metrics?.ai_search_volume || 0),
              }))
              .sort((a, b) => a.y - b.y || a.m - b.m);
          const payload = {
            ok: true,
            build: BUILD,
            trend: true,
            client: { id: client.id, name: client.name, domain },
            google: histG.ok ? monthly(histG) : [],
            chatgpt: histC.ok ? monthly(histC) : [],
            newLost: nl.ok
              ? ((nl.result?.items as any[]) || []).map((it) => ({
                  date: String(it.date || ""),
                  new: Number(it.new_mentions || 0),
                  lost: Number(it.lost_mentions || 0),
                }))
              : [],
            cost: (histG.cost || 0) + (histC.cost || 0) + (nl.cost || 0),
          };
          if (!payload.google.length && !payload.chatgpt.length && !histG.ok && !histC.ok)
            return Response.json({ ok: false, error: histG.error || histC.error }, { status: 502 });
          await cacheWrite(sbA, client, TREND_TYPE, { domain }, payload);
          return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
        }

        // ── Gap-Modus (?gaps=1): echte Fragen, bei denen Rivalen zitiert ─────
        // werden und der Kunde nicht (include/exclude-Domain-Targets, CH/de-
        // Google-Korpus). Rival-Domains kommen aus den Judge-Feldern
        // comp_positions (d) des neuesten Reports. 7-Tage-Cache.
        if (u.searchParams.get("gaps") === "1") {
          const own = String(client.domain || "")
            .replace(/^https?:\/\//, "")
            .replace(/^www\./, "")
            .replace(/\/.*$/, "");
          if (!own)
            return Response.json({ ok: false, error: "Kunde hat keine Domain" }, { status: 400 });
          if (!refresh) {
            const hit = await cacheRead(sbA, clientId, GAP_TYPE, TREND_CACHE_MS);
            if (hit) return Response.json(hit, { headers: { "Cache-Control": "no-store" } });
          }
          const { data: rep2 } = await db
            .from("ai_visibility_reports")
            .select("id")
            .eq("client_id", clientId)
            .order("snapshot_date", { ascending: false })
            .limit(1)
            .maybeSingle();
          const rivalFreq = new Map<string, { n: number; name: string }>();
          if (rep2?.id) {
            const { data: rows } = await db
              .from("ai_visibility_prompts")
              .select("comp_positions")
              .eq("report_id", rep2.id)
              .not("comp_positions", "is", null)
              .limit(1000);
            for (const r of rows || [])
              for (const cp of (r.comp_positions as any[]) || []) {
                const d = String(cp?.d || "")
                  .replace(/^www\./, "")
                  .toLowerCase();
                if (!d || d === own || d.endsWith("." + own)) continue;
                const e = rivalFreq.get(d) || { n: 0, name: String(cp?.n || d) };
                e.n += 1;
                rivalFreq.set(d, e);
              }
          }
          const rivals = [...rivalFreq.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 2);
          if (!rivals.length)
            return Response.json(
              {
                ok: true,
                build: BUILD,
                gaps: [],
                note: "Noch keine Konkurrenz-Domains aus dem Messlauf bekannt.",
              },
              { headers: { "Cache-Control": "no-store" } },
            );
          const lang = (client.language || "de").slice(0, 2);
          const calls = await Promise.all(
            rivals.map(([dom]) =>
              dfsLive("ai_optimization/llm_mentions/search/live", {
                target: [
                  { domain: dom, search_filter: "include" },
                  { domain: own, search_filter: "exclude" },
                ],
                platform: "google",
                location_name: "Switzerland",
                language_code: lang,
                limit: 20,
              }),
            ),
          );
          let cost = 0;
          const gaps = rivals
            .map(([dom, meta], i) => {
              const c = calls[i];
              cost += c.cost || 0;
              const seen = new Set<string>();
              const questions: Array<{ q: string; vol: number }> = [];
              for (const it of (c.ok ? (c.result?.items as any[]) : []) || []) {
                const q = String(it.question || "").trim();
                if (!q || seen.has(q.toLowerCase())) continue;
                seen.add(q.toLowerCase());
                questions.push({ q, vol: Number(it.ai_search_volume || 0) });
              }
              questions.sort((a, b) => b.vol - a.vol);
              return {
                rival: meta.name,
                rivalDomain: dom,
                total: c.ok ? Number(c.result?.total_count || 0) : 0,
                questions: questions.slice(0, 8),
              };
            })
            .filter((g) => g.questions.length);
          const payload = { ok: true, build: BUILD, gaps, cost };
          await cacheWrite(sbA, client, GAP_TYPE, { own }, payload);
          return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
        }

        // ── Frage-Mining (?questions=1): echte Korpus-Fragen zum Thema ──────
        // search_scope ["question"] auf deutschen Kernbegriffen (CH/de) —
        // liefert reale Nutzerfragen als Prompt-Kandidaten. 7-Tage-Cache.
        if (u.searchParams.get("questions") === "1") {
          if (!refresh) {
            const hit = await cacheRead(sbA, clientId, QUESTIONS_TYPE, TREND_CACHE_MS);
            if (hit) return Response.json(hit, { headers: { "Cache-Control": "no-store" } });
          }
          const { data: rep3 } = await db
            .from("ai_visibility_reports")
            .select("id")
            .eq("client_id", clientId)
            .order("snapshot_date", { ascending: false })
            .limit(1)
            .maybeSingle();
          let topics3: string[] = [];
          if (rep3?.id) {
            const { data: prompts } = await db
              .from("ai_visibility_prompts")
              .select("topic")
              .eq("report_id", rep3.id)
              .limit(1000);
            const freq = new Map<string, number>();
            for (const p of prompts || []) {
              const t = String(p.topic || "").trim();
              if (t.length >= 3) freq.set(t, (freq.get(t) || 0) + 1);
            }
            topics3 = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
          }
          if (!topics3.length) topics3 = [client.name];
          const lang = (client.language || "de").slice(0, 2);
          const termsDe = await distillTerms(client.name, topics3, "de", 3);
          if (!termsDe.length)
            return Response.json(
              { ok: false, error: "Kernbegriffe nicht ableitbar" },
              { status: 502 },
            );
          const mkTask = (t: string, scopeQuestion: boolean) => ({
            target: [
              {
                keyword: t,
                match_type: "partial_match",
                ...(scopeQuestion ? { search_scope: ["question"] } : {}),
              },
            ],
            platform: "google",
            location_name: "Switzerland",
            language_code: lang,
            limit: 30,
          });
          const calls = await Promise.all(
            termsDe.map((t) =>
              dfsLive("ai_optimization/llm_mentions/search/live", mkTask(t, true)),
            ),
          );
          let cost = 0;
          const seen = new Set<string>();
          const questions: Array<{ q: string; vol: number; term: string }> = [];
          const harvest = (c: any, term: string) => {
            for (const it of (c?.ok ? (c.result?.items as any[]) : []) || []) {
              const q = String(it.question || "").trim();
              if (q.length < 8 || seen.has(q.toLowerCase())) continue;
              seen.add(q.toLowerCase());
              questions.push({ q, vol: Number(it.ai_search_volume || 0), term });
            }
          };
          calls.forEach((c, i) => {
            cost += c.cost || 0;
            harvest(c, termsDe[i]);
          });
          // Fallback (12.08., live-Befund Gasser): bei Nischen-Begriffen steht
          // der Begriff selten in der FRAGE selbst — dann die Fragen jener
          // Antworten nehmen, die ihn im ANTWORTTEXT erwähnen (scope any).
          if (questions.length < 5) {
            const calls2 = await Promise.all(
              termsDe.map((t) =>
                dfsLive("ai_optimization/llm_mentions/search/live", mkTask(t, false)),
              ),
            );
            calls2.forEach((c, i) => {
              cost += c.cost || 0;
              harvest(c, termsDe[i]);
            });
          }
          questions.sort((a, b) => b.vol - a.vol);
          const payload = {
            ok: true,
            build: BUILD,
            terms: termsDe,
            questions: questions.slice(0, 20),
            cost,
          };
          await cacheWrite(sbA, client, QUESTIONS_TYPE, { terms: termsDe }, payload);
          return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
        }

        // ── Konkurrenz-Modus ─────────────────────────────────────────────────
        if (!refresh) {
          const hit = await cacheRead(sbA, clientId, CACHE_TYPE, CACHE_MS, platform);
          if (hit) return Response.json(hit, { headers: { "Cache-Control": "no-store" } });
        }

        // Themen des neuesten aivis-Reports, häufigste zuerst.
        const { data: rep } = await db
          .from("ai_visibility_reports")
          .select("id")
          .eq("client_id", clientId)
          .order("snapshot_date", { ascending: false })
          .limit(1)
          .maybeSingle();
        let topics: string[] = [];
        if (rep?.id) {
          const { data: prompts } = await db
            .from("ai_visibility_prompts")
            .select("topic")
            .eq("report_id", rep.id)
            .limit(1000);
          const freq = new Map<string, number>();
          for (const p of prompts || []) {
            const t = String(p.topic || "").trim();
            if (t.length >= 3) freq.set(t, (freq.get(t) || 0) + 1);
          }
          topics = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
        }
        if (!topics.length) topics = [client.name];

        // Marken-Roster für den Mentions-SoV: Kunde + Top-Rivalen aus dem
        // prompt-basierten SoV des neuesten Reports (unabhängige Zweitmessung).
        let sovNames: Array<{ name: string; isSelf: boolean }> = [];
        if (rep?.id) {
          const { data: sovRows } = await db
            .from("ai_visibility_sov")
            .select("brand, is_self, share")
            .eq("report_id", rep.id)
            .order("share", { ascending: false })
            .limit(12);
          const self = (sovRows || []).find((s: any) => s.is_self);
          sovNames = [
            { name: String(self?.brand || client.name), isSelf: true },
            ...(sovRows || [])
              .filter((s: any) => !s.is_self)
              .slice(0, 5)
              .map((s: any) => ({ name: String(s.brand), isSelf: false })),
          ];
        }

        let payload: any;
        if (platform === "google") {
          // Echte Schweizer Sicht: deutsche Kernbegriffe gegen den CH-Korpus.
          const lang = (client.language || "de").slice(0, 2);
          const termsDe = await distillTerms(client.name, topics, "de", 3);
          const [ch, sov] = await Promise.all([
            termsDe.length
              ? queryChCorpus(termsDe, lang)
              : Promise.resolve({
                  ok: false,
                  domains: [] as Row[],
                  pages: [] as Row[],
                  brands: [] as Row[],
                  answers: 0,
                  cost: 0,
                  error: "keine Kernbegriffe",
                }),
            queryMentionsSov(sovNames, "google", lang),
          ]);
          if (ch.ok && (ch.domains.length || ch.pages.length)) {
            payload = {
              ok: true,
              build: BUILD,
              client: { id: client.id, name: client.name, domain: client.domain || "" },
              platform,
              targets: termsDe,
              note: `Echte Schweizer Messung: ${ch.answers} gespeicherte Google-KI-Antworten (Standort Schweiz, ${lang.toUpperCase()}) zu den Kernbegriffen ausgewertet. Aktualisierung max. 1×/Tag.`,
              domains: ch.domains,
              pages: ch.pages,
              brands: ch.brands,
              sov: sov.rows,
              cost: ch.cost + sov.cost,
            };
          } else {
            // Fallback: globaler EN-Korpus (wie chat_gpt-Pfad).
            const termsEn = await distillTerms(client.name, topics, "en", 5);
            if (!termsEn.length)
              return Response.json(
                { ok: false, error: ch.error || "Kernbegriffe nicht ableitbar" },
                { status: 502 },
              );
            const [domains, pages] = await Promise.all([
              queryTerms("ai_optimization/llm_mentions/top_domains/live", termsEn, "google"),
              queryTerms("ai_optimization/llm_mentions/top_pages/live", termsEn, "google"),
            ]);
            if (!domains.ok && !pages.ok)
              return Response.json(
                { ok: false, error: domains.error || pages.error },
                { status: 502 },
              );
            payload = {
              ok: true,
              build: BUILD,
              client: { id: client.id, name: client.name, domain: client.domain || "" },
              platform,
              targets: termsEn,
              note: "Der Schweizer Korpus lieferte zu den deutschen Kernbegriffen (noch) keine Daten — gezeigt wird die internationale Sicht über englische Kernbegriffe. Aktualisierung max. 1×/Tag.",
              domains: domains.rows,
              pages: pages.rows,
              brands: domains.brands,
              sov: sov.rows,
              cost: (domains.cost || 0) + (pages.cost || 0) + ch.cost + sov.cost,
            };
          }
        } else {
          // ChatGPT: globaler Korpus (Location wird API-seitig nicht unterstützt).
          const termsEn = await distillTerms(client.name, topics, "en", 5);
          if (!termsEn.length)
            return Response.json(
              { ok: false, error: "Kernbegriffe nicht ableitbar (Utility-LLM)" },
              { status: 502 },
            );
          const [domains, pages, brandsNew, cats, sov] = await Promise.all([
            queryTerms("ai_optimization/llm_mentions/top_domains/live", termsEn, "chat_gpt"),
            queryTerms("ai_optimization/llm_mentions/top_pages/live", termsEn, "chat_gpt"),
            queryBrandsNew(termsEn),
            queryBrandCategories(termsEn),
            queryMentionsSov(sovNames, "chat_gpt", "en"),
          ]);
          if (!domains.ok && !pages.ok)
            return Response.json(
              { ok: false, error: domains.error || pages.error },
              { status: 502 },
            );
          payload = {
            ok: true,
            build: BUILD,
            client: { id: client.id, name: client.name, domain: client.domain || "" },
            platform,
            targets: termsEn,
            note: "ChatGPT-Korpus ist global/englischsprachig (Standort-Filter werden API-seitig nicht unterstützt) — Messung über englische Kernbegriffe. Aktualisierung max. 1×/Tag.",
            domains: domains.rows,
            pages: pages.rows,
            brands: brandsNew.rows.length ? brandsNew.rows : domains.brands,
            categories: cats.rows,
            sov: sov.rows,
            cost: (domains.cost || 0) + (pages.cost || 0) + brandsNew.cost + cats.cost + sov.cost,
          };
        }

        await cacheWrite(sbA, client, CACHE_TYPE, { platform, terms: payload.targets }, payload);
        return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
