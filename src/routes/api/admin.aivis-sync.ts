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
async function jobBrandRadar(c: any, comps: string[] = []) {
  const key = process.env.AHREFS_API_KEY;
  if (!key) return { skipped: "AHREFS_API_KEY fehlt" };
  if (!c.name && !c.domain) return { skipped: "kein Name/Domain" };
  const brand = brandName(c);
  // B) Konkurrenten als Kontext -> Ahrefs disambiguiert die Marke besser.
  const competitors = comps.length ? comps.slice(0, 10).join(",") : undefined;
  const errors: string[] = [];

  // 1) Total je Modell (1 Call pro data_source).
  const models: Array<{ name: string; mentions: number; byCountry: Record<string, number> }> = [];
  for (const s of SOURCES) {
    const r = await brandRadar("mentions-overview", {
      select: "brand,total",
      data_source: s.ds,
      brand,
      ...(competitors ? { competitors } : {}),
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
        ...(competitors ? { competitors } : {}),
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

async function askPerplexity(prompt: string, maxTokens = 600): Promise<{ text: string; sources: number } | null> {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) return null;
  const r = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "sonar", messages: [{ role: "user", content: prompt }], max_tokens: maxTokens }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) return null;
  const j: any = await r.json().catch(() => null);
  const text = String(j?.choices?.[0]?.message?.content ?? "").trim();
  const cits = Array.isArray(j?.citations) ? j.citations.length : urlsIn(text);
  return text ? { text, sources: cits } : null;
}

async function askGemini(prompt: string, maxTokens = 600): Promise<{ text: string; sources: number } | null> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) return null;
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: 0 } },
      }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!r.ok) return { text: "", sources: 0, error: `Gemini HTTP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 140)}` } as any;
  const j: any = await r.json().catch(() => null);
  const text = (j?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? "").join(" ").trim();
  return text ? { text, sources: urlsIn(text) } : null;
}

// OpenAI-kompatible Chat-APIs (ChatGPT / Grok / DeepSeek) — ein Helfer.
async function askOpenAICompat(
  url: string,
  key: string | undefined,
  model: string,
  prompt: string,
  maxTokens = 600,
): Promise<{ text: string; sources: number } | null> {
  if (!key) return null;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: maxTokens }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) return { text: "", sources: 0, error: `HTTP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 140)}` } as any;
  const j: any = await r.json().catch(() => null);
  const text = String(j?.choices?.[0]?.message?.content ?? "").trim();
  return text ? { text, sources: urlsIn(text) } : null;
}

// Engines aktivieren sich automatisch, sobald der jeweilige Key in der Env liegt.
const PROMPT_ENGINES: Array<{ name: string; ask: (p: string) => Promise<{ text: string; sources: number } | null> }> = [
  { name: "Claude", ask: askClaude },
  { name: "Perplexity", ask: askPerplexity },
  { name: "Gemini", ask: askGemini },
  {
    name: "ChatGPT",
    ask: (p) => askOpenAICompat("https://api.openai.com/v1/chat/completions", process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL ?? "gpt-5.1", p),
  },
  {
    name: "Grok",
    ask: (p) => askOpenAICompat("https://api.x.ai/v1/chat/completions", process.env.XAI_API_KEY || process.env.GROK_API_KEY, process.env.XAI_MODEL ?? "grok-4", p),
  },
  {
    name: "DeepSeek",
    ask: (p) => askOpenAICompat("https://api.deepseek.com/chat/completions", process.env.DEEPSEEK_API_KEY, process.env.DEEPSEEK_MODEL ?? "deepseek-chat", p),
  },
];

// Utility-LLM für interne Aufgaben (Seeding, Judge) mit Failover-Kette: bei
// leerem Guthaben/Fehler automatisch das nächste verfügbare Modell. So bricht
// v2 nicht ab, nur weil EIN Anbieter (z. B. Claude) gerade kein Guthaben hat.
async function askUtility(prompt: string, maxTokens = 2000): Promise<string | null> {
  const chain: Array<() => Promise<any>> = [
    () => askClaude(prompt, maxTokens),
    () => askOpenAICompat("https://api.deepseek.com/chat/completions", process.env.DEEPSEEK_API_KEY, process.env.DEEPSEEK_MODEL ?? "deepseek-chat", prompt, maxTokens),
    () => askOpenAICompat("https://api.x.ai/v1/chat/completions", process.env.XAI_API_KEY || process.env.GROK_API_KEY, process.env.XAI_MODEL ?? "grok-4", prompt, maxTokens),
    () => askPerplexity(prompt, maxTokens),
    () => askOpenAICompat("https://api.openai.com/v1/chat/completions", process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL ?? "gpt-5.1", prompt, maxTokens),
    () => askGemini(prompt, maxTokens),
  ];
  for (const fn of chain) {
    try { const r = await fn(); if (r && r.text) return r.text as string; } catch { /* nächstes Modell */ }
  }
  return null;
}

// JSON aus LLM-Antworten robust extrahieren (Codefences etc.).
function parseJson(text: string): any {
  const m = text.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

// URLs/Domains aus Antworttext.
const urlListIn = (t: string) => (String(t).match(/https?:\/\/[^\s)\]"'>]+/g) || []).map((u) => u.replace(/[.,);]+$/, ""));
const domOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; } };

// Erstes Seeding: ~16 realistische, strategisch gemischte Nutzer-Prompts je Kunde.
async function seedPromptDefs(c: any, sbAny: any): Promise<{ defs: any[]; error?: string }> {
  const text = await askUtility(
    `Du bist SEO/GEO-Analyst. Erzeuge 16 realistische Suchanfragen (Prompts), die echte potenzielle Kunden an KI-Assistenten stellen und bei denen die Firma "${c.name}" (${cleanDomain(c.domain)}, Markt ${c.country || "CH"}) idealerweise empfohlen werden sollte. Decke bewusst ab: (a) generische Empfehlungsfragen ("bestes …"), (b) direkte Vergleichs-/Alternativfragen ("Alternativen zu …", "X oder Y"), (c) Long-Tail/Nischen mit spezifischen Anforderungen, (d) transaktionale und (e) lokale Fragen je Land. Mische Sprachen passend zum Markt (v. a. ${c.language || "de"}) und Länder (Schweiz/Deutschland/Österreich/Italien/International). WICHTIG: Prompts dürfen den Firmennamen NICHT enthalten (außer max. 1 Navigations-Prompt). Antworte NUR mit JSON-Array: [{"prompt":"...","topic":"kurzes Themen-Label","intent":"Kommerziell|Informativ|Transaktional|Navigativ","country":"Schweiz|Deutschland|Österreich|Italien|International"}]`,
    3000,
  );
  if (!text) return { defs: [], error: "kein Modell verfügbar (Seeding)" };
  const arr = parseJson(text);
  if (!Array.isArray(arr) || !arr.length) return { defs: [], error: "Claude lieferte kein parsebares JSON" };
  const rows = arr.slice(0, 20).map((p: any) => ({
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

// LLM-Judge (A): jede Antwort strukturiert bewerten statt Regex.
async function judgeAnswers(brand: string, comps: string[], items: Array<{ i: number; platform: string; text: string }>) {
  const list = items.map((a) => `#${a.i} [${a.platform}] ${String(a.text).slice(0, 650)}`).join("\n---\n");
  const hint = comps.length ? `Bekannte Konkurrenten (nutze diese Schreibweise, ergänze neue): ${comps.join(", ")}. ` : "";
  const content = `Du bewertest KI-Antworten für die Zielmarke "${brand}". ${hint}Für JEDE Antwort ein Objekt:\n{"i":<nr>,"mentioned":true|false (wird die Zielmarke genannt?),"cited":true|false (wird ihre Website/Domain als Quelle genannt/verlinkt?),"position":"top"|"list"|"passing"|"none" (top=klare Top-Empfehlung, list=eine von mehreren gleichrangig, passing=nur Randnotiz, none=nicht genannt),"sentiment":"pos"|"neu"|"neg"|null (Tonalität ggü. der Zielmarke),"competitors":["andere genannte Firmen/Marken OHNE die Zielmarke, max 8"],"sources":["explizit genannte Quell-URLs, max 8"]}\nSei streng: Substring-Zufallstreffer sind KEINE Erwähnung. Antworte NUR mit JSON-Array.\n\n${list}`;
  const text = await askUtility(content, 4000); // Failover-Kette: Claude -> DeepSeek -> ...
  if (!text) return null;
  const arr = parseJson(text);
  if (!Array.isArray(arr)) return null;
  const map: Record<number, any> = {};
  for (const e of arr) map[Number(e.i)] = e;
  return map;
}

async function jobPromptRunner(c: any, sbAny: any, fixedComps: string[] = []) {
  let { data: defs } = await sbAny
    .from("ai_visibility_prompt_defs")
    .select("*")
    .eq("client_id", c.id)
    .eq("active", true)
    .limit(24);
  let seeded = 0;
  if (!defs?.length) {
    const s = await seedPromptDefs(c, sbAny);
    defs = s.defs;
    seeded = defs.length;
    if (!defs.length) return { skipped: `Seeding fehlgeschlagen: ${s.error || "unbekannt"}` };
  }

  const nameRe = new RegExp(String(c.name || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const domain = cleanDomain(c.domain);

  // Alle Engines × Prompts.
  const rows: any[] = [];
  const engineErrors: Record<string, string> = {};
  for (const eng of PROMPT_ENGINES) {
    const answers = await Promise.all(defs.map((d: any) => eng.ask(d.prompt).catch(() => null)));
    answers.forEach((a: any, i) => {
      if (!a || !a.text) {
        if (a?.error && !engineErrors[eng.name]) engineErrors[eng.name] = a.error;
        return;
      }
      rows.push({ i: rows.length, def: defs[i], platform: eng.name, text: a.text });
    });
  }
  if (!rows.length) return { skipped: "keine Engine-Antworten", seeded };

  // A) LLM-Judge über alle Antworten; Fallback = Regex, falls Judge ausfällt.
  const judged = await judgeAnswers(c.name, fixedComps, rows.map((r) => ({ i: r.i, platform: r.platform, text: r.text })));
  const evals = rows.map((r) => {
    const j = judged?.[r.i];
    if (j) {
      return {
        mentioned: !!j.mentioned || !!j.cited,
        cited: !!j.cited,
        position: ["top", "list", "passing", "none"].includes(j.position) ? j.position : (j.mentioned ? "list" : "none"),
        sentiment: ["pos", "neu", "neg"].includes(j.sentiment) ? j.sentiment : null,
        competitors: Array.isArray(j.competitors) ? j.competitors.map((x: any) => String(x).trim()).filter(Boolean).slice(0, 8) : [],
        sources: Array.isArray(j.sources) ? j.sources.map(String) : urlListIn(r.text),
      };
    }
    const cited = domain ? r.text.toLowerCase().includes(domain.toLowerCase()) : false;
    const mentioned = nameRe.test(r.text) || cited;
    return { mentioned, cited, position: mentioned ? "list" : "none", sentiment: null as string | null, competitors: [] as string[], sources: urlListIn(r.text) };
  });

  // Prompt-Ergebnisse für die DB (mit Sentiment/Position).
  const promptRows = rows.map((r, k) => {
    const e = evals[k];
    return {
      prompt: r.def.prompt,
      platform: r.platform,
      country: r.def.country || "Schweiz",
      status: e.cited ? "Referenziert" : e.mentioned ? "Erwähnt" : null,
      is_opportunity: !e.mentioned,
      intent: r.def.intent || null,
      sentiment: e.sentiment,
      position: e.position,
      brands_count: e.competitors.length + (e.mentioned ? 1 : 0),
      sources_count: e.sources.length,
      response: r.text.slice(0, 1500),
      competitors: e.competitors,
    };
  });

  // C) Share-of-Voice: eigene Marke vs. Konkurrenten über alle Antworten.
  const compTally: Record<string, { name: string; n: number }> = {};
  const selfMentions = evals.filter((e) => e.mentioned).length;
  for (const e of evals) {
    for (const name of e.competitors) {
      const kk = name.toLowerCase();
      (compTally[kk] ??= { name, n: 0 }).n += 1;
    }
  }
  // Fixliste zusätzlich per Substring absichern (falls Judge sie mal übersieht).
  for (const fc of fixedComps) {
    const kk = fc.toLowerCase();
    if (!compTally[kk]) {
      const n = rows.filter((r) => r.text.toLowerCase().includes(kk)).length;
      if (n > 0) compTally[kk] = { name: fc, n };
    }
  }
  const compList = Object.values(compTally).sort((a, b) => b.n - a.n).slice(0, 12);
  const sovTotal = Math.max(1, selfMentions + compList.reduce((a, b) => a + b.n, 0));
  const sov = [
    { brand: c.name, is_self: true, mentions: selfMentions, share: Math.round((selfMentions / sovTotal) * 100) },
    ...compList.map((cc) => ({ brand: cc.name, is_self: false, mentions: cc.n, share: Math.round((cc.n / sovTotal) * 100) })),
  ];
  // Auto-Learning: neue Konkurrenten (nicht in Fixliste), ab 2 Nennungen.
  const fixedLower = new Set(fixedComps.map((x) => x.toLowerCase()));
  const learnedComps = compList.filter((cc) => cc.n >= 2 && !fixedLower.has(cc.name.toLowerCase())).map((cc) => cc.name);

  // E) Quellen aus den Antworten (Custom-Layer) nach Domain aggregiert.
  const srcTally: Record<string, number> = {};
  for (const e of evals) for (const u of e.sources) { const dd = domOf(u); if (dd) srcTally[dd] = (srcTally[dd] || 0) + 1; }
  const customSources = Object.entries(srcTally)
    .map(([dom, n]) => ({ domain: dom, mentions: n, layer: "custom" }))
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 15);

  // Custom-Modelle je Engine (+ Land), Basis = Judge-Erwähnungen.
  const customModels = PROMPT_ENGINES.map((eng) => {
    const idx = rows.map((r, k) => ({ r, e: evals[k] })).filter((x) => x.r.platform === eng.name);
    if (!idx.length) return null;
    const byCountry: Record<string, number> = {};
    for (const x of idx) if (x.e.mentioned) byCountry[x.r.def.country || "Schweiz"] = (byCountry[x.r.def.country || "Schweiz"] || 0) + 1;
    return { name: eng.name, mentions: idx.filter((x) => x.e.mentioned).length, byCountry };
  }).filter(Boolean) as Array<{ name: string; mentions: number; byCountry: Record<string, number> }>;

  // Themen: Sichtbarkeit = Anteil erwähnter Antworten je Themen-Label.
  const topicMap: Record<string, { total: number; mentioned: number; intent: string | null }> = {};
  rows.forEach((r, k) => {
    const t = r.def.topic || r.def.prompt.slice(0, 60);
    topicMap[t] ??= { total: 0, mentioned: 0, intent: r.def.intent || null };
    topicMap[t].total += 1;
    if (evals[k].mentioned) topicMap[t].mentioned += 1;
  });
  const topics = Object.entries(topicMap).map(([topic, v]) => ({
    topic, visibility: Math.round((v.mentioned / Math.max(1, v.total)) * 100), mentions: v.mentioned, volume: 0, intent: v.intent,
  }));

  // Positions-Qualität (0..1): top=1, list=0.6, passing=0.3.
  const posScore = evals.filter((e) => e.mentioned).reduce((a, e) => a + (e.position === "top" ? 1 : e.position === "list" ? 0.6 : 0.3), 0);
  const positionQuality = selfMentions ? posScore / selfMentions : 0;

  const byEngine: Record<string, number> = {};
  for (const r of rows) byEngine[r.platform] = (byEngine[r.platform] || 0) + 1;

  return {
    promptRows, customModels, topics, sov, customSources, learnedComps,
    seeded, answered: rows.length, byEngine, engineErrors,
    mentions: customModels.reduce((a, m) => a + m.mentions, 0),
    selfShare: sov[0]?.share ?? 0,
    positionQuality: Math.round(positionQuality * 100),
    judged: !!judged,
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

            // Konkurrentenliste (Fixliste, editierbar) einmal laden -> beide Layer.
            const { data: compRows } = await sb
              .from("ai_visibility_competitors").select("name").eq("client_id", c.id).eq("active", true);
            const fixedComps: string[] = (compRows || []).map((r: any) => String(r.name)).filter(Boolean);

            const br: any = wanted.includes("brand_radar") ? await jobBrandRadar(c, fixedComps) : null;
            const at: any = wanted.includes("attribution") ? await jobAttribution(c) : null;
            const pr: any = wanted.includes("prompts") ? await jobPromptRunner(c, sb, fixedComps) : null;
            jr.brand_radar = br ? (br.skipped ? { skipped: br.skipped } : { mentions: br.mentions, citations: br.citations, pages: br.citedPagesCount, errors: br.errors?.length || 0 }) : "skipped";
            jr.attribution = at ? (at.skipped || at.error ? at : { engines: at.engines.length }) : "skipped";
            jr.prompts = pr ? (pr.skipped ? { skipped: pr.skipped, seeded: pr.seeded } : { answered: pr.answered, byEngine: pr.byEngine, engineErrors: pr.engineErrors, mentions: pr.mentions, seeded: pr.seeded, topics: pr.topics.length, selfShare: pr.selfShare, sov: pr.sov?.length, judged: pr.judged, learned: pr.learnedComps?.length }) : "skipped";

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
              // Score (TUNE, F): log-gedämpfte Mengen + Qualitäts-Boni. Share-of-
              // Voice und Positions-Qualität aus dem Custom-Layer heben den Wert,
              // wenn die Marke nicht nur oft, sondern PROMINENT genannt wird.
              const selfShare = hasPr ? (pr.selfShare ?? 0) : 0; // 0..100
              const posQ = hasPr ? (pr.positionQuality ?? 0) : 0; // 0..100
              const score = Math.min(
                100,
                Math.round(
                  26 * Math.log10(1 + mentions) +
                  20 * Math.log10(1 + citations) +
                  12 * Math.log10(1 + citedPagesCount) +
                  0.18 * selfShare +
                  0.12 * posQ,
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
              await sb.from("ai_visibility_sov").delete().eq("report_id", reportId);

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

              // Prompts + Themen + SoV + Quellen + Auto-Learning (Custom-Layer).
              if (hasPr) {
                await sb.from("ai_visibility_prompts").insert(
                  pr.promptRows.map((p: any) => ({ ...p, report_id: reportId, client_id: c.id })),
                );
                if (pr.topics.length)
                  await sb.from("ai_visibility_topics").insert(
                    pr.topics.map((t: any) => ({ ...t, report_id: reportId, client_id: c.id })),
                  );
                // C) Share-of-Voice
                if (pr.sov?.length)
                  await sb.from("ai_visibility_sov").insert(
                    pr.sov.map((s: any) => ({ report_id: reportId, client_id: c.id, brand: s.brand, is_self: s.is_self, mentions: s.mentions, share: s.share })),
                  );
                // E) Quellen aus den Antworten (Custom-Layer)
                if (pr.customSources?.length)
                  await sb.from("ai_visibility_sources").insert(
                    pr.customSources.map((s: any) => ({ report_id: reportId, client_id: c.id, domain: s.domain, mentions: s.mentions, share: 0, urls: 0, traffic: 0, layer: "custom" })),
                  );
                // Auto-Learning: neue Konkurrenten in die Fixliste (source='auto').
                if (pr.learnedComps?.length)
                  await sb.from("ai_visibility_competitors").upsert(
                    pr.learnedComps.map((n: string) => ({ client_id: c.id, name: n, source: "auto", active: true })),
                    { onConflict: "client_id,name", ignoreDuplicates: true },
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
