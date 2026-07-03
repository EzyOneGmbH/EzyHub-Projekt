import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "@/server/google-tokens.server";
import { redactSecrets } from "@/server/google-oauth.server";

// AI-Visibility-Ingestion, Stufe 1 (Makro-Layer + Attribution). Befüllt die
// ai_visibility_*-Tabellen server-seitig (service_role; n8n kommt nicht an die
// Lovable-DB — gleiche Architektur wie admin.content-sync):
//   brand_radar : Ahrefs Brand Radar — Mentions je Modell (+ je Land, nur für
//                 Modelle mit Mentions > 0, spart API-Units) -> models +
//                 model_country; Citations/Cited Pages der eigenen Domain ->
//                 report + sources
//   attribution : GA4 AI-Referral-Sessions/Conversions je Engine -> attribution
//   report      : Upsert je (client_id, snapshot_date=heute) mit Deltas vs.
//                 letztem Snapshot; Score = dokumentierte Heuristik (TUNE)
// Stufe 2 (separat): Custom-Prompt-Runner -> prompts/topics.
// Secret-gated (ADMIN_AUTOMATION_SECRET). Freshness-Guard: skip, wenn ein
// Report der letzten `minIntervalDays` existiert (Brand Radar kostet Units).

const Body = z.object({
  client: z.string().optional(), // Name (ilike) oder uuid
  all: z.boolean().optional(),
  jobs: z.array(z.enum(["brand_radar", "attribution", "prompts"])).optional(),
  minIntervalDays: z.number().int().min(0).max(60).default(6),
  force: z.boolean().optional(),
});

const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ""));
const today = () => new Date().toISOString().slice(0, 10);
const cleanDomain = (d: string) =>
  String(d || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");

// Spec §9: die 6 Makro-Datenquellen des Ahrefs Brand Radar (+ Anzeigename).
const SOURCES: Array<{ ds: string; name: string }> = [
  { ds: "chatgpt", name: "ChatGPT" },
  { ds: "google_ai_overviews", name: "Google AI Overviews" },
  { ds: "google_ai_mode", name: "Google AI Mode" },
  { ds: "gemini", name: "Gemini" },
  { ds: "perplexity", name: "Perplexity" },
  { ds: "copilot", name: "Copilot" },
];
// Länder-Splits (ISO alpha-2 -> Anzeigename im Dashboard).
const COUNTRIES: Array<{ code: string; name: string }> = [
  { code: "ch", name: "Schweiz" },
  { code: "de", name: "Deutschland" },
  { code: "at", name: "Österreich" },
  { code: "it", name: "Italien" },
];

// GA4 sessionSource -> Engine-Label (erste Übereinstimmung gewinnt).
const ENGINES: Array<{ name: string; re: RegExp }> = [
  { name: "ChatGPT", re: /chatgpt|openai/i },
  { name: "Perplexity", re: /perplexity/i },
  { name: "Gemini", re: /gemini|bard/i },
  { name: "Claude", re: /claude|anthropic/i },
  { name: "Copilot", re: /copilot|bing/i },
  { name: "Grok", re: /grok|x\.ai/i },
  { name: "DeepSeek", re: /deepseek/i },
];

// Ahrefs v3 Brand Radar (live validiert): Pfade OHNE "-entities"-Suffix;
// Arrays als CSV, `brand` als Plain-Name, nur `where` als JSON-String.
async function brandRadar(path: string, params: Record<string, unknown>, key: string) {
  const u = new URL(`https://api.ahrefs.com/v3/brand-radar/${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) u.searchParams.set(k, v.join(","));
    else if (typeof v === "object" && v !== null) u.searchParams.set(k, JSON.stringify(v));
    else u.searchParams.set(k, String(v));
  }
  const r = await fetch(u, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) {
    const body = (await r.text().catch(() => "")).slice(0, 160);
    return { ok: false as const, error: `HTTP ${r.status}: ${body}` };
  }
  return { ok: true as const, data: (await r.json().catch(() => null)) as any };
}

// REST-Form nimmt den Brand als Plain-Namen (die entities-Struktur ist MCP-only).
function brandName(c: any) {
  return String(c.name || "").trim() || cleanDomain(c.domain).split(".")[0];
}

// ── Ahrefs Brand Radar: Mentions je Modell (+ Land) + Citations ─────────────
async function jobBrandRadar(c: any) {
  const key = process.env.AHREFS_API_KEY;
  if (!key) return { skipped: "AHREFS_API_KEY fehlt" };
  if (!c.name && !c.domain) return { skipped: "kein Name/Domain" };
  const brand = brandName(c);
  const errors: string[] = [];

  // 1) Total je Modell (1 Call pro data_source).
  const models: Array<{ name: string; mentions: number; byCountry: Record<string, number> }> = [];
  for (const s of SOURCES) {
    const r = await brandRadar("mentions-overview", {
      select: "brand,total",
      data_source: s.ds,
      brand,
    }, key);
    if (!r.ok) { errors.push(`${s.name}: ${r.error}`); models.push({ name: s.name, mentions: 0, byCountry: {} }); continue; }
    const total = Number(r.data?.metrics?.[0]?.total ?? 0);
    models.push({ name: s.name, mentions: total, byCountry: {} });
  }

  // 2) Länder-Split NUR für Modelle mit Mentions > 0 (spart Units).
  for (const m of models) {
    if (m.mentions <= 0) continue;
    const ds = SOURCES.find((s) => s.name === m.name)!.ds;
    for (const co of COUNTRIES) {
      const r = await brandRadar("mentions-overview", {
        select: "brand,total",
        data_source: ds,
        country: co.code,
        brand,
      }, key);
      const v = r.ok ? Number(r.data?.metrics?.[0]?.total ?? 0) : 0;
      if (v > 0) m.byCountry[co.name] = v;
    }
    // Rest, der keinem der Split-Länder zuzuordnen ist -> "International".
    const split = Object.values(m.byCountry).reduce((a, b) => a + b, 0);
    if (m.mentions - split > 0) m.byCountry["International"] = m.mentions - split;
  }

  // 3) Citations + referenzierte Seiten der eigenen Domain (1 Call).
  let citations = 0;
  let citedPages: Array<{ url: string; responses: number }> = [];
  const domain = cleanDomain(c.domain);
  if (domain) {
    const r = await brandRadar("cited-pages", {
      select: "url,responses",
      data_source: SOURCES.map((s) => s.ds),
      where: { field: "cited_domain_subdomains", is: ["eq", domain] },
      brand,
      limit: 200,
    }, key);
    if (r.ok) {
      citedPages = (r.data?.pages ?? []).map((p: any) => ({
        url: String(p.url ?? ""),
        responses: Number(p.responses ?? 0),
      }));
      citations = citedPages.reduce((a, p) => a + p.responses, 0);
    } else errors.push(`cited-pages: ${r.error}`);
  }

  const mentions = models.reduce((a, m) => a + m.mentions, 0);
  return { models, mentions, citations, citedPagesCount: citedPages.length, citedPages, errors };
}

// ── GA4: AI-Referral-Sessions -> Conversions je Engine ──────────────────────
async function jobAttribution(c: any) {
  if (!c.ga4_property) return { skipped: "kein ga4_property" };
  let token: string;
  try {
    token = (await getGoogleAccessToken(c.id)).accessToken;
  } catch (e) {
    return { error: "Google-Token: " + redactSecrets(e) };
  }
  const propertyId = String(c.ga4_property).replace(/^properties\//, "");
  const r = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
        dimensions: [{ name: "sessionSource" }],
        metrics: [{ name: "sessions" }, { name: "keyEvents" }],
        limit: 250,
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!r.ok) return { error: `GA4 HTTP ${r.status}` };
  const json: any = await r.json().catch(() => ({}));
  const agg: Record<string, { sessions: number; conversions: number }> = {};
  for (const row of json.rows ?? []) {
    const src = String(row.dimensionValues?.[0]?.value ?? "");
    const eng = ENGINES.find((e) => e.re.test(src));
    if (!eng) continue;
    agg[eng.name] ??= { sessions: 0, conversions: 0 };
    agg[eng.name].sessions += Number(row.metricValues?.[0]?.value ?? 0);
    agg[eng.name].conversions += Number(row.metricValues?.[1]?.value ?? 0);
  }
  return {
    engines: Object.entries(agg).map(([engine, v]) => ({ engine, ...v })),
  };
}

// ── Stufe 2: Custom-Prompt-Runner (Claude / Perplexity / Gemini) ─────────────
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
const PARSE_MODEL = process.env.ANTHROPIC_PARSE_MODEL ?? "claude-haiku-4-5-20251001";
const urlsIn = (t: string) => (t.match(/https?:\/\/[^\s)\]"']+/g) || []).length;

async function askClaude(prompt: string, maxTokens = 600): Promise<{ text: string; sources: number; error?: string } | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) return { text: "", sources: 0, error: `Claude HTTP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 140)}` };
  const j: any = await r.json().catch(() => null);
  const text = (j?.content ?? []).map((b: any) => b?.text ?? "").join(" ").trim();
  return text ? { text, sources: urlsIn(text) } : null;
}

async function askPerplexity(prompt: string): Promise<{ text: string; sources: number } | null> {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) return null;
  const r = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "sonar", messages: [{ role: "user", content: prompt }], max_tokens: 600 }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) return null;
  const j: any = await r.json().catch(() => null);
  const text = String(j?.choices?.[0]?.message?.content ?? "").trim();
  const cits = Array.isArray(j?.citations) ? j.citations.length : urlsIn(text);
  return text ? { text, sources: cits } : null;
}

async function askGemini(prompt: string): Promise<{ text: string; sources: number } | null> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) return null;
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 600, thinkingConfig: { thinkingBudget: 0 } },
      }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!r.ok) return null;
  const j: any = await r.json().catch(() => null);
  const text = (j?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? "").join(" ").trim();
  return text ? { text, sources: urlsIn(text) } : null;
}

const PROMPT_ENGINES: Array<{ name: string; ask: (p: string) => Promise<{ text: string; sources: number } | null> }> = [
  { name: "Claude", ask: askClaude },
  { name: "Perplexity", ask: askPerplexity },
  { name: "Gemini", ask: askGemini },
];

// JSON aus LLM-Antworten robust extrahieren (Codefences etc.).
function parseJson(text: string): any {
  const m = text.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

// Erstes Seeding: 8 realistische Nutzer-Prompts je Kunde generieren.
async function seedPromptDefs(c: any, sbAny: any): Promise<{ defs: any[]; error?: string }> {
  const gen = await askClaude(
    `Du bist SEO/GEO-Analyst. Erzeuge 8 realistische Suchanfragen (Prompts), die potenzielle Kunden an KI-Assistenten (ChatGPT/Claude/Perplexity) stellen würden und bei denen die Firma "${c.name}" (${cleanDomain(c.domain)}, Markt ${c.country || "CH"}) idealerweise empfohlen werden sollte. Mische Sprachen passend zum Markt (v. a. ${c.language || "de"}), Länder (Schweiz/Deutschland/Österreich/Italien/International) und Such-Intents. WICHTIG: Die Prompts dürfen den Firmennamen NICHT enthalten (außer max. 1 Navigations-Prompt). Antworte NUR mit einem JSON-Array: [{"prompt":"...","topic":"kurzes Themen-Label","intent":"Kommerziell|Informativ|Transaktional|Navigativ","country":"Schweiz|Deutschland|Österreich|Italien|International"}]`,
    1600, // 8 Objekte als JSON brauchen deutlich mehr als die 600 Antwort-Tokens des Runners
  );
  if (gen?.error) return { defs: [], error: gen.error };
  const arr = gen ? parseJson(gen.text) : null;
  if (!Array.isArray(arr) || !arr.length) return { defs: [], error: "Claude lieferte kein parsebares JSON" };
  const rows = arr.slice(0, 10).map((p: any) => ({
    client_id: c.id,
    prompt: String(p.prompt ?? "").slice(0, 500),
    topic: String(p.topic ?? "").slice(0, 120) || null,
    intent: ["Kommerziell", "Informativ", "Transaktional", "Navigativ"].includes(p.intent) ? p.intent : "Informativ",
    country: String(p.country ?? "Schweiz").slice(0, 40),
    language: c.language || "de",
  })).filter((r: any) => r.prompt);
  if (!rows.length) return { defs: [], error: "keine gültigen Prompts im JSON" };
  const { data, error } = await sbAny.from("ai_visibility_prompt_defs").insert(rows).select("*");
  if (error) return { defs: [], error: error.message };
  return { defs: data || [] };
}

async function jobPromptRunner(c: any, sbAny: any) {
  if (!process.env.ANTHROPIC_API_KEY) return { skipped: "ANTHROPIC_API_KEY fehlt" };
  let { data: defs } = await sbAny
    .from("ai_visibility_prompt_defs")
    .select("*")
    .eq("client_id", c.id)
    .eq("active", true)
    .limit(12);
  let seeded = 0;
  if (!defs?.length) {
    const s = await seedPromptDefs(c, sbAny);
    defs = s.defs;
    seeded = defs.length;
    if (!defs.length) return { skipped: `Seeding fehlgeschlagen: ${s.error || "unbekannt"}` };
  }

  const nameRe = new RegExp(String(c.name || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const domain = cleanDomain(c.domain);

  // Alle Engines × Prompts (je Engine parallel über die Prompts).
  const rows: any[] = [];
  for (const eng of PROMPT_ENGINES) {
    const answers = await Promise.all(defs.map((d: any) => eng.ask(d.prompt).catch(() => null)));
    answers.forEach((a, i) => {
      if (!a || !a.text) return; // Engine ohne Key / Fehler -> graceful skip
      const d = defs[i];
      const mentioned = nameRe.test(a.text);
      const cited = domain ? a.text.toLowerCase().includes(domain.toLowerCase()) : false;
      rows.push({
        def: d,
        platform: eng.name,
        text: a.text,
        sources: a.sources,
        mentioned: mentioned || cited,
        status: cited ? "Referenziert" : mentioned ? "Erwähnt" : null,
      });
    });
  }
  if (!rows.length) return { skipped: "keine Engine-Antworten", seeded };

  // Konkurrenz-Marken: EIN Batch-Parse-Call (Haiku) über alle Antworten.
  let brandsByIdx: Record<number, string[]> = {};
  try {
    const batch = rows.map((r, i) => `#${i} [${r.platform}] ${r.text.slice(0, 700)}`).join("\n---\n");
    const parsed = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: PARSE_MODEL,
        max_tokens: 1500,
        messages: [{
          role: "user",
          content: `Extrahiere aus jeder der folgenden KI-Antworten die genannten FIRMEN-/MARKENNAMEN (ohne "${c.name}", ohne generische Begriffe, max. 6 je Antwort). Antworte NUR mit JSON: [{"i":0,"brands":["..."]}]\n\n${batch}`,
        }],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (parsed.ok) {
      const j: any = await parsed.json().catch(() => null);
      const arr = parseJson((j?.content ?? []).map((b: any) => b?.text ?? "").join(" "));
      if (Array.isArray(arr)) for (const e of arr) brandsByIdx[Number(e.i)] = Array.isArray(e.brands) ? e.brands.map(String).slice(0, 6) : [];
    }
  } catch { /* comps optional */ }

  // Ergebnis-Objekte für die DB.
  const promptRows = rows.map((r, i) => ({
    prompt: r.def.prompt,
    platform: r.platform,
    country: r.def.country || "Schweiz",
    status: r.mentioned ? r.status : null,
    is_opportunity: !r.mentioned,
    intent: r.def.intent || null,
    brands_count: (brandsByIdx[i]?.length || 0) + (r.mentioned ? 1 : 0),
    sources_count: r.sources,
    response: r.text.slice(0, 1500),
    competitors: brandsByIdx[i] || [],
  }));

  // Custom-Layer: Mentions je Engine (+ Land).
  const customModels = PROMPT_ENGINES.map((eng) => {
    const er = rows.filter((r) => r.platform === eng.name);
    if (!er.length) return null;
    const byCountry: Record<string, number> = {};
    for (const r of er) if (r.mentioned) byCountry[r.def.country || "Schweiz"] = (byCountry[r.def.country || "Schweiz"] || 0) + 1;
    return { name: eng.name, mentions: er.filter((r) => r.mentioned).length, byCountry };
  }).filter(Boolean) as Array<{ name: string; mentions: number; byCountry: Record<string, number> }>;

  // Themen: je topic-Label Sichtbarkeit = Anteil erwähnter Antworten.
  const topicMap: Record<string, { total: number; mentioned: number; intent: string | null }> = {};
  for (const r of rows) {
    const t = r.def.topic || r.def.prompt.slice(0, 60);
    topicMap[t] ??= { total: 0, mentioned: 0, intent: r.def.intent || null };
    topicMap[t].total += 1;
    if (r.mentioned) topicMap[t].mentioned += 1;
  }
  const topics = Object.entries(topicMap).map(([topic, v]) => ({
    topic,
    visibility: Math.round((v.mentioned / Math.max(1, v.total)) * 100),
    mentions: v.mentioned,
    volume: 0,
    intent: v.intent,
  }));

  return {
    promptRows,
    customModels,
    topics,
    seeded,
    answered: rows.length,
    mentions: customModels.reduce((a, m) => a + m.mentions, 0),
  };
}

export const Route = createFileRoute("/api/admin/aivis-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret)
          return Response.json({ ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" }, { status: 503 });
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });
        const { client: sel, all, jobs, minIntervalDays, force } = parsed.data;
        const wanted = jobs && jobs.length ? jobs : (["brand_radar", "attribution", "prompts"] as const);

        const query = supabaseAdmin
          .from("clients")
          .select("id, name, domain, organization_id, ga4_property, country");
        let clients: any[] = [];
        if (all) clients = (await query).data || [];
        else if (sel && isUuid(sel)) clients = (await query.eq("id", sel)).data || [];
        else if (sel) clients = (await query.ilike("name", `%${sel}%`)).data || [];
        else return Response.json({ ok: false, error: "client oder all erforderlich" }, { status: 400 });
        if (!clients.length)
          return Response.json({ ok: false, error: "Kein Kunde gefunden" }, { status: 404 });

        const sb = supabaseAdmin as any;
        const snapshot = today();
        const results: any[] = [];
        for (const c of clients) {
          const jr: Record<string, unknown> = {};
          try {
            // Freshness-Guard (Brand Radar kostet Units).
            if (!force && minIntervalDays > 0) {
              const since = new Date(Date.now() - minIntervalDays * 86400_000).toISOString().slice(0, 10);
              const { data: recent } = await sb
                .from("ai_visibility_reports")
                .select("id")
                .eq("client_id", c.id)
                .gte("snapshot_date", since)
                .limit(1)
                .maybeSingle();
              if (recent) {
                results.push({ client: c.name, skipped: "fresh" });
                continue;
              }
            }

            const br: any = wanted.includes("brand_radar") ? await jobBrandRadar(c) : null;
            const at: any = wanted.includes("attribution") ? await jobAttribution(c) : null;
            const pr: any = wanted.includes("prompts") ? await jobPromptRunner(c, sb) : null;
            jr.brand_radar = br ? (br.skipped ? { skipped: br.skipped } : { mentions: br.mentions, citations: br.citations, pages: br.citedPagesCount, errors: br.errors?.length || 0 }) : "skipped";
            jr.attribution = at ? (at.skipped || at.error ? at : { engines: at.engines.length }) : "skipped";
            jr.prompts = pr ? (pr.skipped ? { skipped: pr.skipped, seeded: pr.seeded } : { answered: pr.answered, mentions: pr.mentions, seeded: pr.seeded, topics: pr.topics.length }) : "skipped";

            const hasBr = br && !br.skipped;
            const hasPr = pr && !pr.skipped && pr.promptRows?.length;
            if (hasBr || hasPr) {
              // Kombinierte Totale: Makro (Brand Radar) + Custom (Prompt-Runner).
              const macroMentions = hasBr ? br.mentions : 0;
              const customMentions = hasPr ? pr.mentions : 0;
              const mentions = macroMentions + customMentions;
              const citations = hasBr ? br.citations : 0;
              const citedPagesCount = hasBr ? br.citedPagesCount : 0;
              // Deltas vs. letztem Snapshot.
              const { data: prev } = await sb
                .from("ai_visibility_reports")
                .select("mentions, citations, cited_pages, score")
                .eq("client_id", c.id)
                .lt("snapshot_date", snapshot)
                .order("snapshot_date", { ascending: false })
                .limit(1)
                .maybeSingle();
              // Score-Heuristik (TUNE): logarithmisch gedämpfte Summe aus
              // Mentions/Citations/Seiten — 0 Daten -> 0; ~30 Mentions+15 Cit. -> ~60.
              const score = Math.min(
                100,
                Math.round(
                  28 * Math.log10(1 + mentions) +
                  22 * Math.log10(1 + citations) +
                  14 * Math.log10(1 + citedPagesCount),
                ),
              );
              const { data: rep, error: repErr } = await sb
                .from("ai_visibility_reports")
                .upsert(
                  {
                    client_id: c.id,
                    market: c.country || null,
                    snapshot_date: snapshot,
                    score,
                    score_delta: score - Number(prev?.score ?? 0),
                    mentions,
                    mentions_delta: mentions - Number(prev?.mentions ?? 0),
                    citations,
                    citations_delta: citations - Number(prev?.citations ?? 0),
                    cited_pages: citedPagesCount,
                    cited_pages_delta: citedPagesCount - Number(prev?.cited_pages ?? 0),
                  },
                  { onConflict: "client_id,snapshot_date" },
                )
                .select("id")
                .single();
              if (repErr) throw new Error(repErr.message);
              const reportId = rep.id;

              // Kind-Tabellen idempotent: alte Zeilen des Reports ersetzen.
              await sb.from("ai_visibility_models").delete().eq("report_id", reportId);
              await sb.from("ai_visibility_sources").delete().eq("report_id", reportId);
              await sb.from("ai_visibility_attribution").delete().eq("report_id", reportId);
              await sb.from("ai_visibility_prompts").delete().eq("report_id", reportId);
              await sb.from("ai_visibility_topics").delete().eq("report_id", reportId);

              // Modelle: Makro (Brand Radar) + Custom (Prompt-Runner) in einer Liste.
              const allModels = [
                ...(hasBr ? br.models.map((m: any) => ({ ...m, layer: "macro" })) : []),
                ...(hasPr ? pr.customModels.map((m: any) => ({ ...m, layer: "custom" })) : []),
              ];
              const totalMentions = Math.max(1, mentions);
              const { data: modelRows, error: mErr } = await sb
                .from("ai_visibility_models")
                .insert(
                  allModels.map((m: any) => ({
                    report_id: reportId,
                    client_id: c.id,
                    model_name: m.name,
                    layer: m.layer,
                    mentions: m.mentions,
                    sov: Math.round((m.mentions / totalMentions) * 100),
                  })),
                )
                .select("id, model_name");
              if (mErr) throw new Error(mErr.message);
              const mcInserts: any[] = [];
              for (const m of allModels) {
                const row = (modelRows || []).find((x: any) => x.model_name === m.name);
                if (!row) continue;
                for (const [country, mentions2] of Object.entries(m.byCountry)) {
                  mcInserts.push({ model_id: row.id, client_id: c.id, country, mentions: mentions2 });
                }
              }
              if (mcInserts.length) await sb.from("ai_visibility_model_country").insert(mcInserts);

              // Prompts + Themen (Custom-Layer, Stufe 2).
              if (hasPr) {
                await sb.from("ai_visibility_prompts").insert(
                  pr.promptRows.map((p: any) => ({ ...p, report_id: reportId, client_id: c.id })),
                );
                if (pr.topics.length)
                  await sb.from("ai_visibility_topics").insert(
                    pr.topics.map((t: any) => ({ ...t, report_id: reportId, client_id: c.id })),
                  );
              }

              if (hasBr && br.citedPages?.length) {
                const domain = cleanDomain(c.domain);
                await sb.from("ai_visibility_sources").insert({
                  report_id: reportId,
                  client_id: c.id,
                  domain,
                  mentions: br.citations,
                  share: 100,
                  urls: br.citedPagesCount,
                  traffic: 0,
                });
              }
              if (at?.engines?.length) {
                await sb.from("ai_visibility_attribution").insert(
                  at.engines.map((e: any) => ({
                    report_id: reportId,
                    client_id: c.id,
                    engine: e.engine,
                    sessions: e.sessions,
                    conversions: e.conversions,
                  })),
                );
              }
              jr.report = { id: reportId, score, snapshot };
            }
          } catch (e) {
            jr.error = redactSecrets(e);
          }
          results.push({ client: c.name, domain: c.domain, jobs: jr });
        }
        return Response.json({ ok: true, count: clients.length, snapshot, results });
      },
    },
  },
});
