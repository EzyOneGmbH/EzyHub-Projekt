// redeploy-marker: aivis v2 (Semrush-Diagnose, isolierter Worktree) — 2026-07-06d
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "@/server/google-tokens.server";
import { redactSecrets } from "@/server/google-oauth.server";
import { getEnabledServices } from "@/server/integrations.server";
import { generateViaSubscription } from "@/server/claude-generate.server";
import { normalizeCanonryBase } from "@/lib/canonry-url";
import SCORE_CFG from "@/lib/score-config.json";
import JUDGE_ANCHORS from "@/lib/judge-calibration.json";
import COST_CFG from "@/lib/cost-config.json";

// ── LLM-Token-Kostenerfassung (2026-07-21) ──────────────────────────────────
// Provider-Billing-APIs sind hinter Admin-Keys gesperrt — deshalb rechnen wir
// selbst: jede Antwort trägt Token-Zahlen, × hinterlegter Preis (cost-config).
// Summiert im Speicher (COST_ACC), am Job-Ende idempotent in api_cost_daily
// (RPC add_api_cost) geflusht. Kein Admin-Key nötig, exakt statt geschätzt.
const COST_ACC: Record<string, { calls: number; in: number; out: number; cost: number }> = {};
function recordUsage(label: string, tokIn: number, tokOut: number) {
  const p = (COST_CFG.prices as any)[label] || COST_CFG.fallback;
  const cost = (Math.max(0, tokIn) / 1e6) * p.in + (Math.max(0, tokOut) / 1e6) * p.out;
  const e = (COST_ACC[label] ??= { calls: 0, in: 0, out: 0, cost: 0 });
  e.calls += 1; e.in += Math.max(0, tokIn); e.out += Math.max(0, tokOut); e.cost += cost;
}
async function flushCost(sbAny: any) {
  const labels = Object.keys(COST_ACC);
  if (!labels.length) return;
  const day = today();
  for (const label of labels) {
    const e = COST_ACC[label];
    delete COST_ACC[label];
    try {
      await sbAny.rpc("add_api_cost", {
        p_day: day, p_provider: label, p_calls: e.calls,
        p_in: e.in, p_out: e.out, p_cost: Math.round(e.cost * 1e6) / 1e6,
      });
    } catch { /* Kostenerfassung darf den Lauf nie scheitern lassen */ }
  }
}

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
  jobs: z.array(z.enum(["brand_radar", "attribution", "prompts", "canonry", "serp_ai"])).optional(),
  serpKeywords: z.number().int().min(0).max(25000).optional(), // pro Request: serp_ai-Keyword-Limit (0 = alle)
  minIntervalDays: z.number().int().min(0).max(60).default(6),
  force: z.boolean().optional(),
  // live | backfill (Monats-Reports Historie) | brand-backfill (Marken-Check-
  // Korpus retro) | citations-backfill (Citations+referenzierte Seiten retro
  // in bestehende Monats-Reports — Erwähnungen bleiben unangetastet)
  mode: z.enum(["live", "backfill", "brand-backfill", "citations-backfill"]).default("live"),
  months: z.number().int().min(1).max(12).default(6),  // Backfill-Tiefe
  async: z.boolean().default(false), // true = sofort 202 + runId, Verarbeitung im Hintergrund
  // Prompt-Chunking (2026-07-17): das ~300s-Gateway-Kap begrenzt EINEN Request
  // auf ~30 Prompts. promptOffset teilt den prompts-Job in Häppchen: jeder
  // Request fragt max AIVIS_PROMPT_CHUNK Defs ab Offset; die Antwort nennt
  // `next` (nächster Offset oder null). Aggregation (Themen/SoV/Parts) läuft
  // erst im letzten Häppchen über ALLE Zeilen des Tagesreports.
  promptOffset: z.number().int().min(0).optional(),
  // Seed-Ziel für diesen Kunden (überschreibt AIVIS_PROMPT_TARGET, default 30).
  promptTarget: z.number().int().min(1).max(200).optional(),
  // Engine-Nachzieh-Modus (07.08., Anlass Grok-Wochentagsfilter): misst NUR
  // die genannten Engines und ersetzt nur DEREN Zeilen — bestehende Antworten
  // der übrigen Engines bleiben stehen, Aggregate rechnen am Ende über alles.
  // Explizite Nennung übersteuert den Grok-Wochentagsfilter.
  engines: z.array(z.enum(["Claude", "Perplexity", "Gemini", "ChatGPT", "Grok", "DeepSeek"])).min(1).optional(),
  // Korpus-Provider für mode brand-backfill (Standard: dataforseo seit 2026-07-19).
  backfillProvider: z.enum(["dataforseo", "ahrefs-br"]).default("dataforseo"),
});

// Async-Design: fire-and-forget IM Prozess wird vom Hosting nach der Response
// beendet (2026-07-14 verifiziert: Lauf startete, DB blieb leer). Deshalb:
// async:true legt eine Zeile in ai_visibility_sync_runs an und feuert einen
// SELBST-Aufruf als eigenen HTTP-Request (Header x-sync-run) — Requests laufen
// serverseitig zu Ende, auch wenn der Aufrufer trennt (2026-07-13 bewiesen).
// Status/Ergebnis liegen in der DB: GET ?run=<id> bzw. GET ohne Param = Liste.

const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ""));
const today = () => new Date().toISOString().slice(0, 10);
const cleanDomain = (d: string) =>
  String(d || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");

// ── Semrush Analytics API (CSV): Suchvolumina + organische Konkurrenten ───────
// Ergänzt Ahrefs (AI-Mentions) + GA4 (Attribution) um die Such-Markt-Ebene.
function semrushDb(country?: string) {
  const c = String(country || "ch").toLowerCase();
  return ["ch", "de", "at", "it", "us", "uk", "fr", "es", "nl"].includes(c) ? c : "ch";
}
async function semrush(params: Record<string, string>): Promise<string[][] | null> {
  const key = process.env.SEMRUSH_API_KEY;
  if (!key) return null;
  try {
    // withDeadline zusaetzlich zum AbortSignal: die Runtime ignoriert
    // AbortSignal (2026-07-14 verifiziert) — ohne Race haengt der Lauf hier.
    const r = await withDeadline(
      fetch("https://api.semrush.com/?" + new URLSearchParams({ ...params, key }).toString(), { signal: AbortSignal.timeout(20_000) }),
      25_000,
      "semrush",
    );
    if (!r.ok) return null;
    const lines = (await r.text()).trim().split(/\r?\n/).filter(Boolean);
    return lines.length < 2 ? [] : lines.slice(1).map((l) => l.split(";"));
  } catch { return null; }
}
async function semrushVolume(phrase: string, db: string): Promise<number> {
  const rows = await semrush({ type: "phrase_this", phrase, database: db, export_columns: "Ph,Nq" });
  return rows && rows[0] ? Number(rows[0][1] ?? 0) || 0 : 0;
}
async function semrushCompetitors(domain: string, db: string): Promise<string[]> {
  if (!domain) return [];
  const rows = await semrush({ type: "domain_organic_organic", domain, database: db, export_columns: "Dn,Cr", display_limit: "8" });
  if (!rows) return [];
  return rows
    .map((r) => String(r[0] || "").replace(/^www\./, "").replace(/\.[a-z.]+$/i, ""))
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
}

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

// GA4 sessionSource -> Engine-Label (erste Übereinstimmung gewinnt;
// edgeservices = Copilot-Verweise aus Edge/Windows).
const ENGINES: Array<{ name: string; re: RegExp }> = [
  { name: "ChatGPT", re: /chatgpt|openai/i },
  { name: "Perplexity", re: /perplexity/i },
  { name: "Gemini", re: /gemini|bard/i },
  { name: "Claude", re: /claude|anthropic/i },
  { name: "Copilot", re: /copilot|bing|edgeservices/i },
  { name: "Grok", re: /grok|x\.ai/i },
  { name: "DeepSeek", re: /deepseek/i },
];
// Bing-Sonderfall (06.08.): plain "bing" aus der ORGANISCHEN Bing-Suche ist
// klassisches SEO, kein KI-Traffic — sonst zählt Bing-SEO als Copilot.
const isOrganicBing = (src: string, channel: string) =>
  /(^|\.)bing\b/i.test(src) && !/copilot|chat|edgeservices/i.test(src) && /organic/i.test(channel);

// Ahrefs v3 Brand Radar (live validiert): Pfade OHNE "-entities"-Suffix;
// Arrays als CSV, `brand` als Plain-Name, nur `where` als JSON-String.
async function brandRadar(path: string, params: Record<string, unknown>, key: string) {
  const u = new URL(`https://api.ahrefs.com/v3/brand-radar/${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) u.searchParams.set(k, v.join(","));
    else if (typeof v === "object" && v !== null) u.searchParams.set(k, JSON.stringify(v));
    else u.searchParams.set(k, String(v));
  }
  let r: Response;
  try {
    r = await fetch(u, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    return { ok: false as const, error: `fetch: ${String((e as any)?.message || e).slice(0, 80)}` };
  }
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

// Kunden-Berechtigung für die EzyAI-Befüllung (06.08., Volkan): Service aktiv
// (canonry|perplexity) UND keine explizite geo-Sperre in client_app_access
// (Admin-Umbau 06.08.; kein Eintrag = erlaubt, enabled=false = gesperrt).
// Anlass: Hotel Bernina wurde gemessen, obwohl EzyAI dort deaktiviert ist.
async function aivisAllowed(sb: any, clientId: string): Promise<{ ok: boolean; grund?: string }> {
  const svc = await getEnabledServices(clientId);
  if (!(svc.canonry || svc.perplexity)) return { ok: false, grund: "KI-Sichtbarkeit nicht aktiv" };
  try {
    const { data } = await sb.from("client_app_access").select("enabled").eq("client_id", clientId).eq("app", "geo").maybeSingle();
    if (data && data.enabled === false) return { ok: false, grund: "EzyAI für diesen Kunden deaktiviert (App-Zugriff)" };
  } catch { /* Tabelle optional — dann zählt nur der Service-Schalter */ }
  return { ok: true };
}

// ── Zusatz-Messmärkte (06.08., Anlass Morosani: Besucher aus 11 Ländern,
// Messung nur DACH). Konfiguration je Kunde in score-config.intlMarkets —
// bewusst opt-in: EN-Korpora sind bei Generika-Wortmarken gefährlich
// (Generika-Falle). land = deutsches Label für die Standorte-Karte (muss in
// der DE2EN-Map des Dashboards existieren).
const MARKET_DEFS: Record<string, { location_name: string; language_code: string; land: string }> = {
  uk: { location_name: "United Kingdom", language_code: "en", land: "Grossbritannien" },
  us: { location_name: "United States", language_code: "en", land: "USA" },
  fr: { location_name: "France", language_code: "fr", land: "Frankreich" },
  it: { location_name: "Italy", language_code: "it", land: "Italien" },
  nl: { location_name: "Netherlands", language_code: "nl", land: "Niederlande" },
  es: { location_name: "Spain", language_code: "es", land: "Spanien" },
};
function intlMarketsFor(brand: string): Array<{ location_name: string; language_code: string; land: string }> {
  const codes = (SCORE_CFG as any).intlMarkets?.[brand.toLowerCase()];
  if (!Array.isArray(codes)) return [];
  return codes.map((c: string) => MARKET_DEFS[c]).filter(Boolean);
}

// ── DataForSEO: eigener AI-Overview/AI-Mode-Tracker (Makro-Quelle 2) ─────────
// Copilot & Co. sind nicht per API abfragbar — aber Google AI Overviews und
// AI Mode stehen in der Google-SERP. Wir prüfen die GSC-Top-Suchanfragen des
// Kunden per DataForSEO (pay-per-call) darauf, ob eine AI-Antwort erscheint
// und ob der Kunde darin zitiert/erwähnt wird. Macht die beiden Modelle
// unabhängig vom Ahrefs-Korpus und misst auf den EIGENEN Keywords.
// Kosten-Bremse (User-Entscheid 2026-07-13): Default 500 GSC-Suchanfragen je
// Kunde (28 Tage, GSC-Reihenfolge = Klicks absteigend, d. h. die wichtigsten
// zuerst). AIVIS_SERP_KEYWORDS=0 = ALLE (bis GSC-Max 25000), Zahl > 0 = Limit.
// WELTWEIT (User-Entscheid 2026-07-13): Das Limit zählt Query-LAND-Paare —
// jedes Keyword wird im Land seiner GSC-Impressionen geprüft (Dimension
// query+country), nicht mehr nur im Heimatland. Kosten je Paar unverändert
// (2 Calls); die Treffer landen pro Land in ai_visibility_model_country,
// damit der Länder-Filter im Dashboard greift.
const DFS_SERP_KEYWORDS = (() => {
  const raw = Number(process.env.AIVIS_SERP_KEYWORDS ?? 500);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 500;
})();
const DFS_CONCURRENCY = 8; // parallele SERP-Checks (DataForSEO-Live-Limit ~30)
// DataForSEO location_code = 2000 + ISO-3166-numerisch; a3 = GSC-Ländercode.
const DFS_LOCATION: Record<string, { code: number; lang: string; name: string; a3: string }> = {
  CH: { code: 2756, lang: "de", name: "Schweiz", a3: "che" },
  DE: { code: 2276, lang: "de", name: "Deutschland", a3: "deu" },
  AT: { code: 2040, lang: "de", name: "Österreich", a3: "aut" },
  IT: { code: 2380, lang: "it", name: "Italien", a3: "ita" },
  FR: { code: 2250, lang: "fr", name: "Frankreich", a3: "fra" },
  LI: { code: 2438, lang: "de", name: "Liechtenstein", a3: "lie" },
  LU: { code: 2442, lang: "de", name: "Luxemburg", a3: "lux" },
  US: { code: 2840, lang: "en", name: "USA", a3: "usa" },
  GB: { code: 2826, lang: "en", name: "Grossbritannien", a3: "gbr" },
  IE: { code: 2372, lang: "en", name: "Irland", a3: "irl" },
  CA: { code: 2124, lang: "en", name: "Kanada", a3: "can" },
  AU: { code: 2036, lang: "en", name: "Australien", a3: "aus" },
  NL: { code: 2528, lang: "nl", name: "Niederlande", a3: "nld" },
  BE: { code: 2056, lang: "fr", name: "Belgien", a3: "bel" },
  ES: { code: 2724, lang: "es", name: "Spanien", a3: "esp" },
  PT: { code: 2620, lang: "pt", name: "Portugal", a3: "prt" },
  SE: { code: 2752, lang: "sv", name: "Schweden", a3: "swe" },
  DK: { code: 2208, lang: "da", name: "Dänemark", a3: "dnk" },
  NO: { code: 2578, lang: "no", name: "Norwegen", a3: "nor" },
  PL: { code: 2616, lang: "pl", name: "Polen", a3: "pol" },
  CZ: { code: 2203, lang: "cs", name: "Tschechien", a3: "cze" },
  AE: { code: 2784, lang: "en", name: "VAE", a3: "are" },
  TR: { code: 2792, lang: "tr", name: "Türkei", a3: "tur" },
  IN: { code: 2356, lang: "en", name: "Indien", a3: "ind" },
};
const DFS_LOC_BY_A3: Record<string, { code: number; lang: string; name: string }> = Object.fromEntries(
  Object.values(DFS_LOCATION).map((l) => [l.a3, { code: l.code, lang: l.lang, name: l.name }]),
);

function dfsAuth(): string | null {
  const login = process.env.DATAFORSEO_LOGIN, pass = process.env.DATAFORSEO_PASSWORD;
  if (!login || !pass) return null;
  return "Basic " + Buffer.from(`${login}:${pass}`).toString("base64");
}

// Generischer DataForSEO-Live-Call (AI-Optimization-APIs). Shapes live
// verifiziert 2026-07-19: llm_mentions/search liefert items[] mit platform,
// model_name, question, answer (Volltext), sources[{domain,url,title}],
// ai_search_volume, first/last_response_at; ai_keyword_data liefert items[]
// mit keyword, ai_search_volume, ai_monthly_searches.
async function dfsAiCall(path: string, task: any): Promise<{ ok: boolean; result?: any; error?: string }> {
  const auth = dfsAuth();
  if (!auth) return { ok: false, error: "DATAFORSEO_LOGIN/PASSWORD fehlt" };
  try {
    const r = await fetch(`https://api.dataforseo.com/v3/${path}`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify([task]),
      signal: AbortSignal.timeout(60_000),
    });
    const j: any = await r.json().catch(() => null);
    const t = j?.tasks?.[0];
    if (!r.ok || !t) return { ok: false, error: `HTTP ${r.status}` };
    if (Number(t.status_code) >= 40000) return { ok: false, error: `${t.status_code}: ${String(t.status_message || "").slice(0, 140)}` };
    return { ok: true, result: t.result };
  } catch (e) {
    return { ok: false, error: String((e as any)?.message || e).slice(0, 140) };
  }
}

// Plattform-Keys der LLM-Mentions-API -> Anzeigenamen (Korpus: ChatGPT + Google).
const DFS_LLM_LABEL: Record<string, string> = {
  chat_gpt: "ChatGPT", chatgpt: "ChatGPT",
  google: "Google AI Overviews", google_ai_overview: "Google AI Overviews", google_ai_overviews: "Google AI Overviews",
  google_ai_mode: "Google AI Mode",
};
const dfsLlmLabel = (k: string) => DFS_LLM_LABEL[String(k).toLowerCase()] || (k ? k.charAt(0).toUpperCase() + k.slice(1) : "KI");

// Harte Deadline UNABHÄNGIG vom AbortSignal: Beobachtung 2026-07-14 — serp_ai
// hing trotz AbortSignal.timeout endlos (Runtime ignoriert das Signal bei
// toten Verbindungen). Promise.race garantiert, dass jeder Call terminiert.
function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: any;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error(`${label}: Deadline ${Math.round(ms / 1000)}s überschritten`)), ms); }),
  ]);
}

// DIAGNOSE (2026-07-16, temporaer): Laeufe sterben stumm am Hosting-Kap —
// Phasen-Zeitstempel werden fortlaufend in die sync_runs-Zeile geschrieben,
// damit die letzte erreichte Phase den Taeter zeigt. Modul-State = bewusst
// simpel; bei parallelen Laeufen vermischen sich Marks (fuer Diagnose ok).
const BUILD_TAG = "2026-07-23-relevanz"; // Deploy-Verifikation via GET-Antwort

// ── Score v2 (2026-07-18): Sättigung statt harter Deckel ─────────────────────
// Konstanten in src/lib/score-config.json (REFs, Gewichte, Glättung, Judge).
// scoreV1 (Referenz, NICHT löschen — alte Formel bis 2026-07-17):
//   score = min(100, round(26*log10(1+mentions) + 20*log10(1+citations)
//         + 12*log10(1+citedPages) + 0.18*selfShare + 0.12*posQ))
const MEASUREMENT_VERSION: string = SCORE_CFG.measurementVersion;
const sat = (x: number, ref: number) => Math.min(1, Math.log10(1 + Math.max(0, x)) / Math.log10(1 + ref));
const satRaw = (x: number, ref: number) => Math.log10(1 + Math.max(0, x)) / Math.log10(1 + ref);
function scoreV2Terms(f: (x: number, ref: number) => number, m: number, cit: number, pages: number, sovPct: number, posQPct: number): number {
  const W = SCORE_CFG.weights, R = SCORE_CFG.refs;
  return W.mentions * f(m, R.M_REF) + W.citations * f(cit, R.C_REF) + W.citedPages * f(pages, R.R_REF)
    + W.sov * (sovPct / 100) + W.posQual * (posQPct / 100);
}

// URL-Normalisierung fürs br/sa-Dedupe: Host lowercase, utm_* raus, kein
// trailing slash. Engine-Familie: google-aio aus br und sa = EINE Familie —
// br liefert Seiten quellen-aggregiert, deshalb dedupet die URL-Identität.
function normUrl(u: string): string | null {
  try {
    const x = new URL(String(u));
    x.hostname = x.hostname.toLowerCase().replace(/^www\./, "");
    const keep = [...x.searchParams.entries()].filter(([k]) => !/^utm_/i.test(k));
    x.search = keep.length ? "?" + keep.map(([k, v]) => `${k}=${v}`).join("&") : "";
    x.hash = "";
    return (x.origin + x.pathname).replace(/\/$/, "") + x.search;
  } catch { return null; }
}

// Wrapper-Redirects (Vertex-Lektion): Gemini-Grounding- und Bing-Klick-URLs
// zeigen auf Zwischenhosts — als Quelle zählt IMMER der aufgelöste Zielhost.
const WRAPPER_HOSTS = ["vertexaisearch.cloud.google.com", "bing.com"];
const isWrapperUrl = (u: string) => {
  const d = domOf(u);
  if (!d) return false;
  if (d === "vertexaisearch.cloud.google.com") return true;
  return (d === "bing.com" || d.endsWith(".bing.com")) && /\/ck\//.test(u);
};
async function resolveWrapper(u: string, cache: Map<string, string | null>): Promise<string | null> {
  if (cache.has(u)) return cache.get(u) ?? null;
  let out: string | null = null;
  try {
    const r = await fetch(u, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(10_000) });
    const loc = r.headers.get("location");
    if (loc && !isWrapperUrl(loc)) out = loc;
  } catch { /* resolved:false — Wrapper wird verworfen, nie als Quelle gezählt */ }
  cache.set(u, out);
  return out;
}

// Begrenzte Parallelitaet: volle Promise.all-Salven (30+ Calls gleichzeitig
// je Provider) loesten 429/529 aus (Claude "Overloaded", Gemini/Perplexity
// Teilausfaelle, 2026-07-17). Worker-Pool statt Salve.
async function pMap<T, R>(items: T[], fn: (t: T, i: number) => Promise<R>, conc: number): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(conc, items.length)) }, async () => {
    while (idx < items.length) { const i = idx++; out[i] = await fn(items[i], i); }
  }));
  return out;
}
let diagLog: string[] = [];
let diagWrite: ((log: string[]) => void) | null = null;
function diag(m: string) {
  diagLog.push(new Date().toISOString().slice(11, 19) + " " + m);
  try { diagWrite?.(diagLog); } catch { /* Diagnose darf nie den Lauf brechen */ }
}

async function dfsSerp(auth: string, kind: "organic" | "ai_mode", keyword: string, loc: { code: number; lang: string }) {
  const url = kind === "organic"
    ? "https://api.dataforseo.com/v3/serp/google/organic/live/advanced"
    : "https://api.dataforseo.com/v3/serp/google/ai_mode/live/advanced";
  const body: any = { keyword, location_code: loc.code, language_code: loc.lang, device: "desktop" };
  if (kind === "organic") { body.depth = 20; body.load_async_ai_overview = true; } // AI Overview lädt teils async
  const r = await withDeadline(fetch(url, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify([body]),
    signal: AbortSignal.timeout(60_000),
  }), 70_000, `dfs ${kind}`);
  if (!r.ok) throw new Error(`DataForSEO ${kind} -> HTTP ${r.status}`);
  const j: any = await r.json().catch(() => ({}));
  const t = j?.tasks?.[0];
  if (j.status_code !== 20000 || !t || t.status_code !== 20000)
    throw new Error(`DataForSEO ${kind} -> ${t?.status_code || j.status_code} ${t?.status_message || ""}`.trim());
  return t.result?.[0]?.items || [];
}

// GSC-Top-Suchanfragen als Query-LAND-Paare (28 Tage, GSC-Reihenfolge =
// Klicks absteigend). country = ISO-3166-1 alpha-3 kleingeschrieben (GSC).
async function gscTopQueryCountryPairs(c: any, limit: number): Promise<Array<{ kw: string; a3: string }>> {
  if (!c.gsc_property) return [];
  let token: string;
  try { token = (await getGoogleAccessToken(c.id)).accessToken; } catch { return []; }
  const d = (back: number) => { const x = new Date(); x.setDate(x.getDate() - back); return x.toISOString().slice(0, 10); };
  try {
    const r = await withDeadline(fetch(
      `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(c.gsc_property)}/searchAnalytics/query`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: d(31), endDate: d(3), dimensions: ["query", "country"], rowLimit: Math.min(limit, 25000) }),
        signal: AbortSignal.timeout(30_000),
      },
    ), 40_000, "gsc pairs");
    if (!r.ok) return [];
    const j: any = await r.json().catch(() => ({}));
    return (j.rows ?? [])
      .map((row: any) => ({ kw: String(row.keys?.[0] ?? ""), a3: String(row.keys?.[1] ?? "").toLowerCase() }))
      .filter((p: any) => p.kw && p.a3);
  } catch { return []; }
}

// Eigene (Kunden-)URLs aus einem SERP-Element einsammeln — speist Citations +
// Referenzierte Seiten (nur Links auf die Kunden-Domain, ohne Fragment).
function dfsCollectOwnUrls(node: any, domain: string, out: Set<string>) {
  if (!node || !domain) return;
  if (Array.isArray(node)) { for (const x of node) dfsCollectOwnUrls(x, domain, out); return; }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if ((k === "url" || k === "source_url") && typeof v === "string" && v.includes("://")) {
        if (domOf(v) === domain) out.add(v.split("#")[0]);
      } else dfsCollectOwnUrls(v, domain, out);
    }
  }
}

// Alle Domains aus einem SERP-Element rekursiv einsammeln (Schema-robust).
function dfsCollectDomains(node: any, out: Set<string>) {
  if (!node) return;
  if (Array.isArray(node)) { for (const x of node) dfsCollectDomains(x, out); return; }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if ((k === "domain" || k === "url" || k === "source_url") && typeof v === "string") {
        const dom = v.includes("://") ? domOf(v) : v.replace(/^www\./, "").toLowerCase();
        if (dom) out.add(dom);
      } else dfsCollectDomains(v, out);
    }
  }
}

async function jobSerpAi(c: any, limitOverride?: number) {
  const auth = dfsAuth();
  if (!auth) return { skipped: "DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD fehlt (Lovable-Env)" };
  // Preflight (kostenlos): Ist DataForSEO von HIER erreichbar? Beobachtet
  // 2026-07-14: Nach ~2500 Calls in 2h kamen keine Requests mehr an (IP-
  // Drossel, Verbindungen hingen) — dann sauber überspringen statt hängen.
  try {
    const ping = await withDeadline(
      fetch("https://api.dataforseo.com/v3/appendix/user_data", {
        headers: { Authorization: auth },
        signal: AbortSignal.timeout(12_000),
      }),
      15_000,
      "dfs preflight",
    );
    if (!ping.ok) return { skipped: `DataForSEO Preflight: HTTP ${ping.status}` };
  } catch (e) {
    return { skipped: `DataForSEO nicht erreichbar: ${String((e as any)?.message || e).slice(0, 100)}` };
  }
  // Keyword-Deckel: expliziter Override > score-config.serp.keywords > Env-Default.
  const kwLimit = limitOverride ?? Number((SCORE_CFG as any).serp?.keywords ?? DFS_SERP_KEYWORDS) ?? DFS_SERP_KEYWORDS;
  const allPairs = await gscTopQueryCountryPairs(c, kwLimit || 25000); // 0 = alle
  if (!allPairs.length) return { skipped: "keine GSC-Keywords (gsc_property/Google-Verbindung prüfen)" };
  // Nur Länder mit bekannter DataForSEO-Location; Rest zählen statt raten.
  const homeLoc = DFS_LOCATION[String(c.country || "CH").toUpperCase()] || DFS_LOCATION.CH;
  const skippedCountries: Record<string, number> = {};
  const pairs = allPairs.filter((p) => {
    if (DFS_LOC_BY_A3[p.a3]) return true;
    skippedCountries[p.a3] = (skippedCountries[p.a3] || 0) + 1;
    return false;
  });
  if (!pairs.length) return { skipped: "keine GSC-Keywords in unterstützten Ländern", skippedCountries };
  const domain = cleanDomain(c.domain);
  const nameRe = new RegExp(String(c.name || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  // Treffer-Art unterscheiden: Domain in den Antwort-Referenzen = echtes ZITAT
  // (zählt in Citations + Referenzierte Seiten), reine Namens-Nennung = nur
  // Erwähnung. ownPages sammelt die zitierten eigenen URLs (dedupliziert).
  const ownPages = new Set<string>();
  const hitDetail = (el: any) => {
    const doms = new Set<string>();
    dfsCollectDomains(el, doms);
    const urls = new Set<string>();
    if (domain) dfsCollectOwnUrls(el, domain, urls);
    const cited = (!!domain && doms.has(domain)) || urls.size > 0;
    return { hit: cited || nameRe.test(JSON.stringify(el)), cited, urls };
  };
  const errors: string[] = [];
  const aio = { checked: 0, present: 0, cited: 0, citations: 0, keywords: [] as string[], byCountry: {} as Record<string, number> };
  const aim = { checked: 0, present: 0, cited: 0, citations: 0, keywords: [] as string[], byCountry: {} as Record<string, number> };
  // Query-Fanout light (03.08.): Googles Folgefragen (People Also Ask) + verwandte
  // Suchen aus den OHNEHIN bezahlten organic-Calls — 0 Zusatzkosten. Bewusst als
  // Google-Folgefragen beschriftet, NICHT als KI-interne Sub-Queries (die liefert
  // DataForSEO nicht — geprüft 03.08.).
  const fanout = new Map<string, { kw: string; country: string; questions: string[]; related: string[] }>();
  // Parallel in Blöcken — bei "alle Keywords" sonst zu langsam (2 Calls je Paar).
  const checkPair = async (p: { kw: string; a3: string }) => {
    const loc = DFS_LOC_BY_A3[p.a3] || homeLoc;
    const jobs = [
      withDeadline(dfsSerp(auth, "organic", p.kw, loc), 90_000, "dfs organic").then((items) => {
        aio.checked++;
        // Fanout light: PAA-Fragen + verwandte Suchen einsammeln (max 200 Keywords).
        if (fanout.size < 200) {
          const paa = (items as any[]).find((i: any) => i?.type === "people_also_ask");
          const rel = (items as any[]).find((i: any) => i?.type === "related_searches");
          const questions = Array.isArray(paa?.items) ? paa.items.map((x: any) => String(x?.title || "")).filter(Boolean).slice(0, 8) : [];
          const related = Array.isArray(rel?.items) ? rel.items.map((x: any) => (typeof x === "string" ? x : String(x?.title || ""))).filter(Boolean).slice(0, 8) : [];
          if (questions.length || related.length) fanout.set(`${p.kw}|${loc.name}`, { kw: p.kw, country: loc.name, questions, related });
        }
        const el = (items as any[]).find((i: any) => i?.type === "ai_overview");
        if (el) {
          aio.present++;
          const d = hitDetail(el);
          if (d.hit) {
            aio.cited++; aio.keywords.push(`${p.kw} (${loc.name})`); aio.byCountry[loc.name] = (aio.byCountry[loc.name] || 0) + 1;
            if (d.cited) { aio.citations++; for (const u of d.urls) ownPages.add(u); }
          }
        }
      }).catch((e) => { errors.push(`aio "${p.kw}"@${p.a3}: ${String((e as any)?.message || e).slice(0, 80)}`); }),
      withDeadline(dfsSerp(auth, "ai_mode", p.kw, loc), 90_000, "dfs ai_mode").then((items) => {
        aim.checked++;
        if ((items as any[])?.length) {
          aim.present++;
          const d = hitDetail(items);
          if (d.hit) {
            aim.cited++; aim.keywords.push(`${p.kw} (${loc.name})`); aim.byCountry[loc.name] = (aim.byCountry[loc.name] || 0) + 1;
            if (d.cited) { aim.citations++; for (const u of d.urls) ownPages.add(u); }
          }
        }
      }).catch((e) => { errors.push(`aim "${p.kw}"@${p.a3}: ${String((e as any)?.message || e).slice(0, 80)}`); }),
    ];
    await Promise.all(jobs);
  };
  // Schutzschalter: schlagen ZWEI komplette Blöcke in Folge fehl (alle Calls),
  // ist DataForSEO weg — Rest abbrechen statt sich durch Timeouts zu quälen.
  let deadBlocks = 0;
  for (let i = 0; i < pairs.length; i += DFS_CONCURRENCY) {
    const block = pairs.slice(i, i + DFS_CONCURRENCY);
    const before = errors.length;
    await Promise.all(block.map(checkPair));
    deadBlocks = errors.length - before >= block.length * 2 ? deadBlocks + 1 : 0;
    if (deadBlocks >= 2) {
      errors.push(`Abbruch nach ${i + block.length}/${pairs.length} Paaren: DataForSEO antwortet nicht mehr`);
      break;
    }
  }
  const models = [
    { name: "Google AI Overviews", mentions: aio.cited, byCountry: aio.byCountry },
    { name: "Google AI Mode", mentions: aim.cited, byCountry: aim.byCountry },
  ];
  const countries = [...new Set(pairs.map((p) => DFS_LOC_BY_A3[p.a3].name))];
  return {
    models,
    mentions: aio.cited + aim.cited,
    citations: aio.citations + aim.citations, // Domain stand in den Referenzen
    citedPages: [...ownPages], // zitierte eigene URLs, dedupliziert
    keywords: pairs.length,
    countries,
    ...(Object.keys(skippedCountries).length ? { skippedCountries } : {}),
    aio,
    aim,
    fanout: [...fanout.values()],
    errors,
  };
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

// ── br-Schicht NEU (2026-07-19): DataForSEO LLM Mentions statt Ahrefs BR ────
// Entscheid: Ahrefs komplett raus aus der KI-Sichtbarkeit. Der DFS-Korpus
// deckt ChatGPT + Google AI Overviews/AI Mode ab (weniger Engines als Ahrefs,
// dafür CH-Heimmarkt-stark) — Instrumentierungswechsel => measurementVersion
// v3 (Delta-Sperre + UI-Marker greifen automatisch). jobBrandRadar (Ahrefs)
// bleibt als Referenz im Code, wird aber nicht mehr aufgerufen.
// Generika-Abzug (2026-07-21): Wortmarken, die zugleich in generischen Phrasen
// stecken, zaehlen sonst die Phrase mit — "Benedict" traf 3'041x, ueberwiegend
// "Eggs Benedict" (auch im DACH-Google-Korpus). Ausschluss-Phrasen je Marke in
// score-config.json (mentionExcludes); deren Treffer werden abgezogen.
const mentionExcludes = (brand: string): string[] =>
  ((SCORE_CFG as any).mentionExcludes || {})[brand.toLowerCase()] || [];
// mentionTargets (2026-07-21): Wortmarken wie "Benedict" (Schule) treffen als
// word_match Promis/Serien/Formeln (Cumberbatch, Bridgerton, Harris-Benedict —
// 2'624 Fehltreffer, live belegt). Override liefert praezise Marken-Phrasen
// ("benedict schule"); Default bleibt der Markenname selbst.
const mentionTargets = (brand: string): string[] => {
  const t = ((SCORE_CFG as any).mentionTargets || {})[brand.toLowerCase()];
  return Array.isArray(t) && t.length ? t.map(String) : [brand];
};

async function jobBrandRadarDfs(c: any, comps: string[] = []) {
  const brand = brandName(c);
  const domain = cleanDomain(c.domain);
  const lang = (c.language || "de").slice(0, 2);
  const errors: string[] = [];
  const excludes = mentionExcludes(brand);
  const targets = mentionTargets(brand).map((k) => ({ keyword: k, match_type: "word_match", search_scope: ["answer"] }));

  // 1) Marken-Erwähnungen je Plattform × DACH-Markt (Option B, 2026-07-20:
  //    vorher nur CH — jetzt CH/DE/AT; word_match, weil partial_match
  //    Substrings wie "Studioformate" traf, live verifiziert 2026-07-19).
  const modelAgg: Record<string, { name: string; mentions: number; byCountry: Record<string, number> }> = {};
  // DACH immer (Kundensprache) + konfigurierte Zusatz-Märkte (eigene Sprache).
  const mentionMarkets: Array<{ location_name: string; land: string; language_code?: string }> = [
    { location_name: "Switzerland", land: "Schweiz" },
    { location_name: "Germany", land: "Deutschland" },
    { location_name: "Austria", land: "Österreich" },
    ...intlMarketsFor(brand),
  ];
  for (const loc of mentionMarkets) {
    const agg = await dfsAiCall("ai_optimization/llm_mentions/aggregated_metrics/live", {
      target: targets,
      location_name: loc.location_name, language_code: loc.language_code || lang,
    });
    if (!agg.ok) { errors.push(`aggregated_metrics/${loc.land}: ${agg.error}`); continue; }
    const byPlatform: Record<string, number> = {};
    for (const p of (agg.result?.[0]?.total || {}).platform || []) byPlatform[p.key] = Number(p.mentions || 0);
    // Generika-Abzug: aggregierte Phrasen-Treffer (z.B. "Eggs Benedict") je
    // Plattform abziehen; Antworten mit Marke UND Phrase gehen dabei bewusst
    // mit unter (konservativ — besser zu wenig als Generika mitzaehlen).
    for (const phrase of excludes) {
      const ex = await dfsAiCall("ai_optimization/llm_mentions/aggregated_metrics/live", {
        target: [{ keyword: phrase, match_type: "word_match", search_scope: ["answer"] }],
        location_name: loc.location_name, language_code: loc.language_code || lang,
      });
      if (!ex.ok) { errors.push(`excl(${phrase}/${loc.land}): ${ex.error}`); continue; }
      for (const p of (ex.result?.[0]?.total || {}).platform || [])
        byPlatform[p.key] = Math.max(0, (byPlatform[p.key] || 0) - Number(p.mentions || 0));
    }
    for (const [key, m] of Object.entries(byPlatform)) {
      if (m <= 0) continue;
      const name = dfsLlmLabel(key);
      const e = (modelAgg[name] ??= { name, mentions: 0, byCountry: {} });
      e.mentions += m;
      e.byCountry[loc.land] = (e.byCountry[loc.land] || 0) + m;
    }
  }
  // BEWUSST KEIN globaler ChatGPT-Erwähnungs-Aggregat (Generika-Falle,
  // 2026-07-20 live belegt): word_match auf den globalen EN-Korpus traf bei
  // Wortmarken die PHRASE — "faith in humanity" 9'971 Redewendungs-Treffer,
  // "Benedict" 13'080 (Eggs Benedict). Erwähnungen (Score-Input!) bleiben
  // deshalb auf dem DACH-Google-Korpus; der globale ChatGPT-Korpus fliesst
  // nur DOMAIN-basiert in die Citations-Slices ein (eindeutig, keine Generika).
  const models = Object.values(modelAgg);

  // 2) Citations + referenzierte eigene Seiten: Antworten, die die eigene
  //    Domain als Quelle führen — über beide Plattformen × DACH-Märkte.
  let citations = 0;
  const pageTally: Record<string, number> = {};
  if (domain) {
    // Citations sind DOMAIN-basiert (keine Generika-Falle) — Zusatz-Märkte
    // dürfen hier bedenkenlos mitzählen.
    const citationSlices = [
      ...DFS_CORPUS_SLICES,
      ...intlMarketsFor(brand).map((m) => ({ platform: "google", location_name: m.location_name, language_code: m.language_code, land: m.land })),
    ];
    for (const slice of citationSlices) {
      const cite = await dfsAiCall("ai_optimization/llm_mentions/search/live", {
        target: [{ domain }],
        ...dfsSliceParams(slice), limit: 100,
      });
      if (!cite.ok) { errors.push(`search(${slice.platform}/${slice.land}): ${cite.error}`); continue; }
      const items: any[] = (cite.result?.[0]?.items ?? cite.result?.items ?? []) as any[];
      for (const it of items) {
        const own = (it.sources || []).filter((s: any) => {
          const d = String(s.domain || "").replace(/^www\./, "").toLowerCase();
          return d === domain || d.endsWith("." + domain);
        });
        if (own.length) {
          citations += own.length;
          for (const s of own) { const u = normUrl(String(s.url || "")); if (u) pageTally[u] = (pageTally[u] || 0) + 1; }
        }
      }
    }
  }
  const citedPages = Object.entries(pageTally).map(([url, responses]) => ({ url, responses }));
  const mentions = models.reduce((a, m) => a + m.mentions, 0);
  // HOMONYM-WÄCHTER (Standard 06.08., Volkan): auffällig hohe Korpus-Mentions
  // OHNE mentionTargets-Override sind fast immer Fremdtreffer gleichnamiger
  // Betriebe/Begriffe (Belege 06.08.: Black Summit 1'864 US, Bernina 952,
  // Ezy One 432 = easyJet-Code). Flag statt stillem Score-Einfluss.
  const HOMONYM_GUARD = Number(process.env.AIVIS_HOMONYM_GUARD ?? 300);
  const hasTargetOverride = Array.isArray(((SCORE_CFG as any).mentionTargets || {})[brand.toLowerCase()]);
  const homonymVerdacht = !hasTargetOverride && mentions > HOMONYM_GUARD;
  if (homonymVerdacht)
    errors.push(`HOMONYM-VERDACHT: ${mentions} Korpus-Mentions ohne mentionTargets-Override (Schwelle ${HOMONYM_GUARD}) — Marke auf gleichnamige Fremdbetriebe prüfen und mentionTargets pflegen`);
  return { models, mentions, citations, citedPagesCount: citedPages.length, citedPages, errors, ...(homonymVerdacht ? { homonymVerdacht } : {}) };
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
  let r: Response;
  try {
    r = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
          // country zusätzlich: liefert die Besucher-Herkunft je Engine
          // (Totale werden hier selbst aufsummiert — sessions/keyEvents sind additiv).
          // channelGroup für den Bing-Sonderfall (organische Bing-Suche ≠ Copilot).
          dimensions: [{ name: "sessionSource" }, { name: "country" }, { name: "sessionDefaultChannelGroup" }],
          metrics: [{ name: "sessions" }, { name: "keyEvents" }],
          limit: 10000,
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
  } catch (e) {
    return { error: "GA4 fetch: " + redactSecrets(e) };
  }
  if (!r.ok) return { error: `GA4 HTTP ${r.status}` };
  const json: any = await r.json().catch(() => ({}));
  const agg: Record<string, { sessions: number; conversions: number }> = {};
  // Besucher-Herkunft je Engine: { Land(englisch, GA4) -> Sessions }
  const visitors: Record<string, Record<string, number>> = {};
  for (const row of json.rows ?? []) {
    const src = String(row.dimensionValues?.[0]?.value ?? "");
    const eng = ENGINES.find((e) => e.re.test(src));
    if (!eng) continue;
    if (isOrganicBing(src, String(row.dimensionValues?.[2]?.value ?? ""))) continue;
    const country = String(row.dimensionValues?.[1]?.value ?? "");
    const sess = Number(row.metricValues?.[0]?.value ?? 0);
    agg[eng.name] ??= { sessions: 0, conversions: 0 };
    agg[eng.name].sessions += sess;
    agg[eng.name].conversions += Number(row.metricValues?.[1]?.value ?? 0);
    if (sess > 0) {
      visitors[eng.name] ??= {};
      visitors[eng.name][country] = (visitors[eng.name][country] ?? 0) + sess;
    }
  }
  // Detail: WELCHE Key-Events (Conversion-Namen) je Engine ausgelöst wurden —
  // inkl. Land, Gerät, Datum und Wert (wie die Zeilen im Conversions-Tab).
  // Session-scoped über sessionSource (event-scoped landet oft in "(not set)").
  // Setup-Auto-Erkennung je Property: Buchungs-Setups (GTM) senden den Betrag
  // NICHT als GA4-value/Umsatz, sondern als Custom Dimension dl_value — und
  // dl_reservationid/transactionId vereinzelt die Conversions (statt Sammelzeile).
  const events: Record<string, Array<{ name: string; count: number; value: number; country: string; device: string; date: string; txn?: string; currency?: string }>> = {};
  if (Object.values(agg).some((v) => v.conversions > 0)) {
    try {
      const custom = new Set<string>();
      try {
        const rd = await fetch(
          `https://analyticsadmin.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}/customDimensions?pageSize=200`,
          { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
        );
        if (rd.ok) {
          const jd: any = await rd.json().catch(() => ({}));
          for (const d of jd.customDimensions ?? []) if (d?.scope === "EVENT") custom.add(String(d.parameterName || ""));
        }
      } catch { /* Erkennung optional — Fallback unten deckt alles ab */ }
      const hasDlValue = custom.has("dl_value");
      const hasDlCurrency = custom.has("dl_currency");
      // Manuell hinterlegte Conversion-Werte (Admin-Bereich → Einstellungen →
      // Conversions) — letzte Stufe der Betrags-Kaskade für Kunden, deren
      // GA4 keine Werte sendet (Formular-Conversions o. Ä.).
      const manual = new Map<string, { value: number; currency: string }>();
      try {
        const { data: mv } = await (supabaseAdmin as any)
          .from("client_conversion_values")
          .select("event_name, value, currency")
          .eq("client_id", c.id);
        for (const m of mv ?? []) manual.set(String(m.event_name), { value: Number(m.value), currency: String(m.currency || "CHF") });
      } catch { /* optional */ }
      // transactionId ist eingebaut (immer zulässig, "(not set)" ohne E-Commerce);
      // dl_reservationid gewinnt, wo das Buchungs-Setup sie registriert hat.
      const idDim = custom.has("dl_reservationid") ? "customEvent:dl_reservationid" : "transactionId";
      const dims = (withCustom: boolean) => [
        { name: "sessionSource" },
        { name: "eventName" },
        { name: "country" },
        { name: "deviceCategory" },
        { name: "date" },
        { name: "sessionDefaultChannelGroup" }, // Bing-Sonderfall (max 9 Dims mit Custom)
        ...(withCustom
          ? [
              { name: idDim },
              ...(hasDlValue ? [{ name: "customEvent:dl_value" }] : []),
              ...(hasDlCurrency ? [{ name: "customEvent:dl_currency" }] : []),
            ]
          : []),
      ];
      const runDetail = (withCustom: boolean) =>
        fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
            dimensions: dims(withCustom),
            metrics: [{ name: "keyEvents" }, { name: "eventValue" }, { name: "totalRevenue" }],
            limit: 5000,
          }),
          signal: AbortSignal.timeout(30_000),
        });
      let r2 = await runDetail(true);
      // Unbekannte Custom-Dimension o. Ä. → einmal ohne Zusatz-Dimensionen.
      if (!r2.ok) r2 = await runDetail(false);
      if (r2.ok) {
        const j2: any = await r2.json().catch(() => ({}));
        const dh: string[] = (j2.dimensionHeaders ?? []).map((h: any) => String(h?.name ?? ""));
        for (const row of j2.rows ?? []) {
          const get = (nm: string) => {
            const i = dh.indexOf(nm);
            return i >= 0 ? String(row.dimensionValues?.[i]?.value ?? "") : "";
          };
          const src = get("sessionSource");
          const eng = ENGINES.find((e) => e.re.test(src));
          const n = Number(row.metricValues?.[0]?.value ?? 0);
          if (!eng || n <= 0 || isOrganicBing(src, get("sessionDefaultChannelGroup"))) continue;
          const idRaw = get(idDim);
          const txn = idRaw && idRaw !== "(not set)" ? idRaw : undefined;
          const cur = get("customEvent:dl_currency");
          const dlVal = Number(get("customEvent:dl_value")) || 0;
          const evName = get("eventName");
          const man = manual.get(evName);
          // Betrags-Kaskade: dl_value (Buchungs-Setup) > totalRevenue
          // (Purchase-Umsatz) > eventValue (value-Parameter) > manuell
          // hinterlegter Wert je Conversion (× Anzahl).
          const gaVal = dlVal || Number(row.metricValues?.[2]?.value ?? 0) || Number(row.metricValues?.[1]?.value ?? 0);
          const val = gaVal || (man ? man.value * n : 0);
          const curFinal = (cur && cur !== "(not set)" ? cur : "") || (!gaVal && man ? man.currency : "");
          (events[eng.name] ??= []).push({
            name: evName,
            count: n,
            value: val,
            country: get("country"),
            device: get("deviceCategory"),
            date: get("date"),
            ...(txn ? { txn } : {}),
            ...(curFinal ? { currency: curFinal } : {}),
          });
        }
        // neueste zuerst, pro Engine gedeckelt (jsonb klein halten)
        for (const k of Object.keys(events))
          events[k] = events[k]
            .sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.count - a.count)
            .slice(0, 100);
      }
    } catch { /* Detail optional — Totale bleiben gültig */ }
  }
  return {
    engines: Object.entries(agg).map(([engine, v]) => ({
      engine,
      ...v,
      events: events[engine] ?? [],
      // Top-Länder der Besucher, absteigend, gedeckelt (jsonb klein halten)
      visitors: Object.entries(visitors[engine] ?? {})
        .map(([country, sessions]) => ({ country, sessions }))
        .sort((a, b) => b.sessions - a.sessions)
        .slice(0, 50),
    })),
  };
}

// ── Stufe 2: Custom-Prompt-Runner (Claude / Perplexity / Gemini) ─────────────
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
const PARSE_MODEL = process.env.ANTHROPIC_PARSE_MODEL ?? "claude-haiku-4-5-20251001";
const urlsIn = (t: string) => (t.match(/https?:\/\/[^\s)\]"']+/g) || []).length;

async function askClaude(prompt: string, maxTokens = 600, temperature?: number): Promise<{ text: string; sources: number; model?: string; error?: string } | null> {
  // Subscription-Routing (2026-08-05): OPT-IN, Default AUS. Getestet am 05.08. mit
  // dem Voll-Durchlauf — die Subscription läuft nur über den Agent-SDK (/generate),
  // und jede Antwort startet eine eigene SDK-Session: bei aivis-Volumen ~1 Claude-
  // Antwort/Min + Dutzende Prozesse => für 100+ Prompts/Kunde unbrauchbar. Deshalb
  // misst die Claude-Engine standardmäßig wieder über den schnellen API-Key
  // (messages.create, hohe Parallelität). Wer die Subscription doch will (kleine
  // Kadenz), setzt AIVIS_CLAUDE_VIA_SUBSCRIPTION=1. Nur Engine-ANTWORTEN (ohne
  // temperature) wären betroffen; Judge/Seed liefen ohnehin nur direkt.
  if (temperature == null && process.env.AIVIS_CLAUDE_VIA_SUBSCRIPTION === "1") {
    const viaSub = await generateViaSubscription({
      prompt,
      model: ANTHROPIC_MODEL,
      label: "aivis-Claude",
      timeoutMs: 85_000, // unter dem 90s-Ask-Deadline des Runners bleiben
    });
    if (viaSub?.text) {
      const u = viaSub.usage || {};
      // Kosten sichtbar halten (Modellwert-Schätzung, wie bei allen Engines).
      recordUsage("Claude", Number(u.input_tokens || 0), Number(u.output_tokens || 0));
      return { text: viaSub.text, sources: urlsIn(viaSub.text), model: ANTHROPIC_MODEL };
    }
    // Subscription aus/leer/Limit/Timeout -> Direktweg unten (kein Mess-Loch).
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }], ...(temperature != null ? { temperature } : {}) }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) return { text: "", sources: 0, error: `Claude HTTP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 140)}` };
  const j: any = await r.json().catch(() => null);
  const text = (j?.content ?? []).map((b: any) => b?.text ?? "").join(" ").trim();
  recordUsage("Claude", Number(j?.usage?.input_tokens || 0), Number(j?.usage?.output_tokens || 0));
  // j.model = aufgelöster Modell-Snapshot (nie nur der Alias aus der Anfrage)
  return text ? { text, sources: urlsIn(text), model: String(j?.model || ANTHROPIC_MODEL) } : null;
}

async function askPerplexity(prompt: string, maxTokens = 600, temperature?: number): Promise<{ text: string; sources: number; model?: string } | null> {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) return null;
  const r = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "sonar", messages: [{ role: "user", content: prompt }], max_tokens: maxTokens, ...(temperature != null ? { temperature } : {}) }),
    signal: AbortSignal.timeout(60_000),
  });
  // Fehlertext durchreichen statt null — sonst ist ein Quota-401 von "kein Key"
  // nicht zu unterscheiden (siehe engineProbe).
  if (!r.ok) return { text: "", sources: 0, error: `Perplexity HTTP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 140)}` } as any;
  const j: any = await r.json().catch(() => null);
  const text = String(j?.choices?.[0]?.message?.content ?? "").trim();
  recordUsage("Perplexity", Number(j?.usage?.prompt_tokens || 0), Number(j?.usage?.completion_tokens || 0));
  const cits = Array.isArray(j?.citations) ? j.citations.length : urlsIn(text);
  return text ? { text, sources: cits, model: String(j?.model || "sonar") } : null;
}

async function askGemini(prompt: string, maxTokens = 600, temperature?: number): Promise<{ text: string; sources: number; model?: string } | null> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) return null;
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: 0 }, ...(temperature != null ? { temperature } : {}) },
      }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!r.ok) return { text: "", sources: 0, error: `Gemini HTTP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 140)}` } as any;
  const j: any = await r.json().catch(() => null);
  const text = (j?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? "").join(" ").trim();
  recordUsage("Gemini", Number(j?.usageMetadata?.promptTokenCount || 0), Number(j?.usageMetadata?.candidatesTokenCount || 0));
  return text ? { text, sources: urlsIn(text), model: String(j?.modelVersion || "gemini-2.5-flash") } : null;
}

// OpenAI-kompatible Chat-APIs (ChatGPT / Grok / DeepSeek) — ein Helfer.
async function askOpenAICompat(
  url: string,
  key: string | undefined,
  model: string,
  prompt: string,
  maxTokens = 600,
  temperature?: number,
): Promise<{ text: string; sources: number; model?: string } | null> {
  if (!key) return null;
  // OpenAI (gpt-5.x/o-Modelle) verlangt max_completion_tokens; Grok/DeepSeek nutzen max_tokens.
  const tokenParam = url.includes("api.openai.com")
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens };
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], ...tokenParam, ...(temperature != null ? { temperature } : {}) }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) return { text: "", sources: 0, error: `HTTP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 140)}` } as any;
  const j: any = await r.json().catch(() => null);
  const text = String(j?.choices?.[0]?.message?.content ?? "").trim();
  // Label aus dem Endpoint ableiten (ein Helfer für ChatGPT/Grok/DeepSeek).
  const label = url.includes("api.openai.com") ? "ChatGPT" : url.includes("x.ai") ? "Grok" : url.includes("deepseek") ? "DeepSeek" : "OpenAICompat";
  recordUsage(label, Number(j?.usage?.prompt_tokens || 0), Number(j?.usage?.completion_tokens || 0));
  return text ? { text, sources: urlsIn(text), model: String(j?.model || model) } : null;
}

// Engines aktivieren sich automatisch, sobald der jeweilige Key in der Env liegt.
// Grok-Drosselung (2026-07-31): teuerster Provider (~44 % der LLM-Kosten 22.–31.07.)
// und zugleich der unzuverlässigste — misst nur noch WÖCHENTLICH mit. Fenster
// Mo–Mi (UTC): der Tageszyklus läuft alle 3 Tage, damit fällt je Kunde genau
// ein Lauf pro Woche ins Fenster. Abschaltbar via AIVIS_GROK_WEEKLY=0.
const GROK_WEEKLY = String(process.env.AIVIS_GROK_WEEKLY ?? "1") !== "0";
const grokDueToday = () => { const wd = new Date().getUTCDay(); return wd >= 1 && wd <= 3; };
const activePromptEngines = () => PROMPT_ENGINES.filter((e) => e.name !== "Grok" || !GROK_WEEKLY || grokDueToday());
// Antwort-Länge (04.08., User-Befund „Antwort abgeschnitten"): der Default 600
// Tokens ließ die KI mitten im Satz stoppen (~1500 Zeichen). 1500 Tokens ≈
// ~3500–4000 Zeichen = vollständige Antworten. Env-Schalter für Kostenkontrolle.
const ANSWER_MAX_TOKENS = Math.max(600, Number(process.env.AIVIS_ANSWER_TOKENS ?? 1500));

// ── DataForSEO-LLM-Fallback (06.08., Volkan) ─────────────────────────────────
// Fällt eine Direkt-Engine aus (leeres Prepaid-Konto: Anthropic meldet 400,
// OpenAI 429, Perplexity 401), antwortet DataForSEO llm_responses mit
// DEMSELBEN Modell (Parität live verifiziert 06.08.). ~4-5× teurer je Antwort
// ($0.011 vs ~$0.002 bei gpt-5.1) — deshalb NUR Fallback, nie primär; die
// Kosten laufen ins DFS-Konto (Balance-Wächter + Kosten-Digest greifen).
// Env AIVIS_DFS_FALLBACK=0 schaltet den Fallback ab.
const DFS_LLM_MAP: Record<string, { se: string; model: string }> = {
  Claude: { se: "claude", model: "claude-sonnet-5" },
  Perplexity: { se: "perplexity", model: "sonar" },
  Gemini: { se: "gemini", model: "gemini-2.5-flash" },
  ChatGPT: { se: "chat_gpt", model: "gpt-5.1" },
};
async function askViaDfs(engine: string, prompt: string): Promise<{ text: string; sources: number; model?: string } | null> {
  if (process.env.AIVIS_DFS_FALLBACK === "0") return null;
  const def = DFS_LLM_MAP[engine];
  if (!def) return null;
  // user_prompt-Limit der DFS-API: 500 Zeichen (Mess-Prompts liegen weit darunter).
  const r = await dfsAiCall(`ai_optimization/${def.se}/llm_responses/live`, { user_prompt: prompt.slice(0, 500), model_name: def.model });
  if (!r.ok) return null;
  const row = (r.result ?? [])[0];
  const text = ((row?.items ?? []) as any[])
    .filter((it) => it?.type === "message")
    .flatMap((it) => (it.sections ?? []).map((s: any) => String(s?.text ?? "")))
    .join(" ")
    .trim();
  return text ? { text, sources: urlsIn(text), model: `${String(row?.model_name || def.model)}@dataforseo` } : null;
}
// Routing-Entscheid (06.08., Volkan): DataForSEO ist PRIMÄR für die 4
// Mess-Engines — EIN Abrechnungskonto, keine rollierenden Prepaid-Ausfälle
// mehr; die Direkt-API ist nur noch Fallback. Die ~4-5× höheren Antwort-
// kosten sind bewusst in Kauf genommen (Volkan, 06.08.).
// AIVIS_LLM_PRIMARY=direct dreht auf Direkt-zuerst zurück.
const LLM_PRIMARY = (process.env.AIVIS_LLM_PRIMARY ?? "dfs").toLowerCase();
const withDfsRouting = (name: string, direct: (p: string) => Promise<any>) => async (p: string) => {
  if (LLM_PRIMARY === "dfs") {
    const f = await askViaDfs(name, p);
    if (f) return f;
    return direct(p).catch(() => null);
  }
  const r = await direct(p).catch(() => null);
  if (r && r.text) return r;
  const f = await askViaDfs(name, p);
  return f ?? r;
};

const PROMPT_ENGINES: Array<{ name: string; ask: (p: string) => Promise<{ text: string; sources: number } | null> }> = [
  { name: "Claude", ask: withDfsRouting("Claude", (p) => askClaude(p, ANSWER_MAX_TOKENS)) },
  { name: "Perplexity", ask: withDfsRouting("Perplexity", (p) => askPerplexity(p, ANSWER_MAX_TOKENS)) },
  { name: "Gemini", ask: withDfsRouting("Gemini", (p) => askGemini(p, ANSWER_MAX_TOKENS)) },
  {
    name: "ChatGPT",
    ask: withDfsRouting("ChatGPT", (p) => askOpenAICompat("https://api.openai.com/v1/chat/completions", process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL ?? "gpt-5.1", p, ANSWER_MAX_TOKENS)),
  },
  {
    name: "Grok",
    ask: (p) => askOpenAICompat("https://api.x.ai/v1/chat/completions", process.env.XAI_API_KEY || process.env.GROK_API_KEY, process.env.XAI_MODEL ?? "grok-4", p, ANSWER_MAX_TOKENS),
  },
  {
    name: "DeepSeek",
    ask: (p) => askOpenAICompat("https://api.deepseek.com/chat/completions", process.env.DEEPSEEK_API_KEY, process.env.DEEPSEEK_MODEL ?? "deepseek-chat", p, ANSWER_MAX_TOKENS),
  },
];

// Utility-LLM für interne Aufgaben (Seeding, Judge) mit Failover-Kette: bei
// leerem Guthaben/Fehler automatisch das nächste verfügbare Modell. So bricht
// v2 nicht ab, nur weil EIN Anbieter (z. B. Claude) gerade kein Guthaben hat.
async function askUtilityMeta(prompt: string, maxTokens = 2000, temperature?: number): Promise<{ text: string; model: string } | null> {
  const chain: Array<() => Promise<any>> = [
    () => askClaude(prompt, maxTokens, temperature),
    () => askOpenAICompat("https://api.deepseek.com/chat/completions", process.env.DEEPSEEK_API_KEY, process.env.DEEPSEEK_MODEL ?? "deepseek-chat", prompt, maxTokens, temperature),
    () => askOpenAICompat("https://api.x.ai/v1/chat/completions", process.env.XAI_API_KEY || process.env.GROK_API_KEY, process.env.XAI_MODEL ?? "grok-4", prompt, maxTokens, temperature),
    () => askPerplexity(prompt, maxTokens, temperature),
    () => askOpenAICompat("https://api.openai.com/v1/chat/completions", process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL ?? "gpt-5.1", prompt, maxTokens, temperature),
    () => askGemini(prompt, maxTokens, temperature),
  ];
  for (const fn of chain) {
    try {
      const r = await withDeadline(fn(), 120_000, "utility-llm");
      if (r && r.text) return { text: r.text as string, model: String(r.model || "unbekannt") };
    } catch { /* nächstes Modell */ }
  }
  return null;
}
// export (10.08.): auch die KI-Konkurrenz-Route (aivis-competitors) nutzt den
// Utility-LLM — gleiche Provider-Kette + Kosten-Logging statt Doppel-Code.
export async function askUtility(prompt: string, maxTokens = 2000): Promise<string | null> {
  const r = await askUtilityMeta(prompt, maxTokens);
  return r?.text ?? null;
}

// JSON aus LLM-Antworten robust extrahieren (Codefences etc.).
function parseJson(text: string): any {
  const m = text.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

// URLs/Domains aus Antworttext.
const urlListIn = (t: string) => (String(t).match(/https?:\/\/[^\s)\]"'>]+/g) || []).map((u) => u.replace(/[.,);]+$/, ""));
const domOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; } };

// Ziel-Anzahl aktiver Prompts je Kunde (Env-übersteuerbar, KEINE Obergrenze).
// Liegt der Bestand darunter, stockt der Prompt-Runner beim nächsten Lauf
// automatisch auf. Das ist ein MINIMUM (Untergrenze fürs Nachsäen), keine
// Anzeige-/Lauf-Grenze: gefahren und angezeigt werden immer ALLE aktiven Prompts.
// 100 je Kunde (Entscheid 2026-07-17); Läufe laufen dank Chunking in Etappen.
const PROMPT_TARGET = Math.max(1, Number(process.env.AIVIS_PROMPT_TARGET ?? 100) || 100);

// Pro LLM-Aufruf säen wir höchstens 25 Prompts (Zuverlässigkeit der JSON-
// Antwort) — höhere Ziele werden per Schleife in Etappen erreicht.
const SEED_CHUNK = 25;

// Seeding: realistische, strategisch gemischte Nutzer-Prompts je Kunde.
// Mit opts.existing wird nachgesät (Top-up) statt neu gesät — ohne Duplikate.
async function seedPromptDefs(
  c: any,
  sbAny: any,
  opts: { count?: number; existing?: string[]; angle?: string; facts?: any } = {},
): Promise<{ defs: any[]; error?: string }> {
  const count = Math.min(SEED_CHUNK, Math.max(1, opts.count ?? PROMPT_TARGET));
  const existing = (opts.existing ?? []).map((p) => String(p).trim()).filter(Boolean);
  const avoid = existing.length
    ? `\nBereits vorhandene Prompts (erzeuge KEINE Duplikate und keine nahen Umformulierungen davon, sondern NEUE Blickwinkel/Nischen):\n${existing.map((p) => `- ${p}`).join("\n")}\n`
    : "";
  const angle = opts.angle ? `\nDIESER DURCHGANG: ${opts.angle}.` : "";
  // ERDUNG auf Fakten (Prävention Fehl-Seeding, 2026-07-23): OHNE Faktenprofil
  // rät der LLM aus Name+Domain, was die Firma macht — bei nicht selbsterklärenden
  // Namen fatal (JAG AG = Prozessanlagen/Robotik wurde als Uhrenhändler geseedet,
  // 100 Uhren-Prompts). Mit angebot/kernfakten kann er das Feld nicht mehr erfinden.
  const f = opts.facts;
  const factsBlock = f && (f.angebot || (Array.isArray(f.kernfakten) && f.kernfakten.length))
    ? `\nWAS DIE FIRMA TATSÄCHLICH MACHT (verbindlich, halte dich strikt daran — erfinde KEINE fremde Branche): ${f.angebot ? "Angebot: " + f.angebot + ". " : ""}${Array.isArray(f.kernfakten) && f.kernfakten.length ? "Fakten: " + f.kernfakten.join(" | ") : ""}\nDie Prompts MÜSSEN zum oben genannten Angebot passen — Fragen aus einer fremden Branche sind falsch.\n`
    : "";
  const text = await askUtility(
    `Du bist SEO/GEO-Analyst. Erzeuge ${count} realistische Suchanfragen (Prompts), die echte potenzielle Kunden an KI-Assistenten stellen und bei denen die Firma "${c.name}" (${cleanDomain(c.domain)}, Markt ${c.country || "CH"}) idealerweise empfohlen werden sollte.${factsBlock} Decke bewusst ab: (a) generische Empfehlungsfragen ("bestes …"), (b) direkte Vergleichs-/Alternativfragen ("Alternativen zu …", "X oder Y"), (c) Long-Tail/Nischen mit spezifischen Anforderungen, (d) transaktionale und (e) lokale Fragen je Land. Mische Sprachen passend zum Markt (v. a. ${c.language || "de"}) und Länder (Schweiz/Deutschland/Österreich/Italien/International). WICHTIG: Prompts dürfen den Firmennamen NICHT enthalten (außer max. 1 Navigations-Prompt).${angle}${avoid} Antworte NUR mit JSON-Array: [{"prompt":"...","topic":"kurzes Themen-Label","intent":"Kommerziell|Informativ|Transaktional|Navigativ","country":"Schweiz|Deutschland|Österreich|Italien|International"}]`,
    4000,
  );
  if (!text) return { defs: [], error: "kein Modell verfügbar (Seeding)" };
  const arr = parseJson(text);
  if (!Array.isArray(arr) || !arr.length) return { defs: [], error: "Claude lieferte kein parsebares JSON" };
  const seen = new Set(existing.map((p) => p.toLowerCase()));
  const rows = arr.slice(0, 100).map((p: any) => ({
    client_id: c.id,
    prompt: String(p.prompt ?? "").slice(0, 500),
    topic: String(p.topic ?? "").slice(0, 120) || null,
    intent: ["Kommerziell", "Informativ", "Transaktional", "Navigativ"].includes(p.intent) ? p.intent : "Informativ",
    country: String(p.country ?? "Schweiz").slice(0, 40),
    language: c.language || "de",
  })).filter((r: any) => {
    const k = r.prompt.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k); // dedupliziert auch innerhalb der LLM-Antwort
    return true;
  });
  if (!rows.length) return { defs: [], error: "keine gültigen Prompts im JSON" };
  const { data, error } = await sbAny.from("ai_visibility_prompt_defs").insert(rows).select("*");
  if (error) return { defs: [], error: error.message };
  return { defs: data || [] };
}

// ── Brand-Prompts (Marken-Check): Reputation/Faktentreue, NICHT Sichtbarkeit ─
// Brand-Prompts fragen nach der Marke selbst — die Marke wird darin fast immer
// genannt. Sie fliessen deshalb NIEMALS in SoV/Positions-Qualität/Score ein
// (Semrush-Inflation). Merksatz: Markt-Prompts messen, OB man empfohlen wird;
// Brand-Prompts messen, WAS über einen gesagt wird.
async function seedBrandPrompts(c: any, sbAny: any): Promise<any[]> {
  const terms: string[] = Array.isArray(c.brand_terms) && c.brand_terms.length ? c.brand_terms.map(String) : [String(c.name)];
  const marke = terms[0] || String(c.name);
  // Top-Konkurrent aus den pr-Daten (SoV) für den Vergleichs-Prompt.
  const { data: topComp } = await sbAny
    .from("ai_visibility_sov").select("brand").eq("client_id", c.id).eq("is_self", false)
    .order("mentions", { ascending: false }).limit(1).maybeSingle();
  const text = await askUtility(
    `Du bist SEO/GEO-Analyst. Erzeuge 10 BRAND-Prompts für die Firma "${marke}" (${cleanDomain(c.domain)}, Markt ${c.country || "CH"}, Sprache ${c.language || "de"}) — realistische Fragen, die Nutzer KI-Assistenten ÜBER DIESE MARKE stellen. Decke diese Intents ab (je 1-2 Prompts, natürlich formuliert, Markenname enthalten): Erfahrungen/Bewertungen; empfehlenswert/seriös; was bietet die Firma an; Preise/Kosten; Öffnungszeiten/Kontakt (nur falls lokales Geschäft mit Standort); Vergleich "${marke} vs ${topComp?.brand || "der wichtigste Konkurrent"}"; wem gehört die Firma / wer steckt dahinter. Weitere Markenschreibweisen: ${terms.join(", ")}. Antworte NUR mit JSON-Array: [{"prompt":"...","topic":"Marken-Check","intent":"Navigativ","country":"${c.country === "CH" || !c.country ? "Schweiz" : "International"}"}]`,
    2500,
  );
  const arr = parseJson(text || "");
  if (!Array.isArray(arr) || !arr.length) return [];
  const rows = arr.slice(0, 12).map((p: any) => ({
    client_id: c.id,
    prompt: String(p.prompt ?? "").slice(0, 500),
    topic: "Marken-Check",
    intent: "Navigativ",
    country: String(p.country ?? "Schweiz").slice(0, 40),
    language: c.language || "de",
    prompt_type: "brand",
    needs_review: true,
  })).filter((r: any) => r.prompt.trim());
  if (!rows.length) return [];
  const { data } = await sbAny.from("ai_visibility_prompt_defs").insert(rows).select("*");
  return data || [];
}

// Fakten-Kurzprofil je Kunde (brand_facts): Abgleichsbasis für den Brand-Judge.
// Initial automatisch aus Name/Domain/Homepage generiert, needs_review=true.
async function getBrandFacts(c: any, sbAny: any): Promise<any> {
  const { data } = await sbAny.from("ai_visibility_brand_facts").select("facts").eq("client_id", c.id).maybeSingle();
  if (data?.facts) return data.facts;
  let siteText = "";
  try {
    const r = await fetch(`https://${cleanDomain(c.domain)}`, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Mozilla/5.0 (EzyHub Brand-Facts)" } });
    siteText = (await r.text()).replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 2500);
  } catch { /* Profil dann nur aus Grundwissen */ }
  const text = await askUtility(
    `Erstelle ein kompaktes, faktisches Kurzprofil der Firma "${c.name}" (${cleanDomain(c.domain)}, ${c.country || "CH"}) als Abgleichsbasis für einen Fakten-Check. Nur belegbare Kernfakten, KEINE Vermutungen — Unbekanntes weglassen.${siteText ? ` Website-Auszug: ${siteText}` : ""} Antworte NUR mit JSON: {"angebot":"was die Firma anbietet","ort":"Standort(e)","kernfakten":["3-8 kurze Fakten"]}`,
    1800,
  );
  const facts = parseJson(text || "") || { angebot: null, ort: null, kernfakten: [] };
  await sbAny.from("ai_visibility_brand_facts").upsert({ client_id: c.id, facts, needs_review: true, updated_at: new Date().toISOString() });
  diag(`prompts: brand-facts initial generiert (needsReview)`);
  return facts;
}

// ── Relevanz-Selbstcheck (Prävention Fehl-Seeding, 2026-07-23) ───────────────
// Gleicht aktive MARKT-Prompts gegen das Faktenprofil ab und deaktiviert
// thematisch fremde (active=false + needs_review=true). Fängt sowohl neue
// Halluzinationen als auch Altlasten (JAG: 100 Uhren-Prompts für einen
// Robotik-Integrator). KONSERVATIV: nur eindeutig fremde Branche wird geflaggt,
// im Zweifel bleibt der Prompt aktiv — lieber ein Fehltreffer stehen lassen als
// einen guten Prompt fälschlich abschalten.
async function auditPromptRelevance(
  c: any, sbAny: any, facts?: any,
): Promise<{ checked: number; flagged: number; skipped?: string; flaggedPrompts?: string[] }> {
  const f = facts ?? await getBrandFacts(c, sbAny).catch(() => null);
  if (!f || (!f.angebot && !(Array.isArray(f.kernfakten) && f.kernfakten.length)))
    return { checked: 0, flagged: 0, skipped: "kein Faktenprofil" };
  // Nur aktive Markt-Prompts (Brand-Prompts nennen die Marke direkt, sind per
  // Definition on-topic).
  let defs: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page } = await sbAny
      .from("ai_visibility_prompt_defs").select("id, prompt, prompt_type, active")
      .eq("client_id", c.id).eq("active", true).range(from, from + 999);
    defs.push(...(page ?? []));
    if (!page || page.length < 1000) break;
  }
  const markt = defs.filter((d: any) => (d.prompt_type || "markt") !== "brand");
  if (!markt.length) return { checked: 0, flagged: 0, skipped: "keine aktiven Markt-Prompts" };
  const factsText = `${f.angebot ? "Angebot: " + f.angebot + ". " : ""}${Array.isArray(f.kernfakten) && f.kernfakten.length ? "Fakten: " + f.kernfakten.join(" | ") : ""}`;
  const flaggedIds: string[] = [];
  // In Blöcken (Token-Budget + Robustheit); Index-basiert, nicht per UUID.
  for (let off = 0; off < markt.length; off += 60) {
    const block = markt.slice(off, off + 60);
    const listing = block.map((d: any, i: number) => `${i}: ${d.prompt}`).join("\n");
    const text = await askUtility(
      `Firma "${c.name}". WAS SIE MACHT: ${factsText}\n\nUnten nummerierte Kunden-Suchanfragen. Nenne NUR die Nummern, deren THEMA in einer klar ANDEREN Branche liegt als das Angebot der Firma (z. B. Uhren-Fragen bei einem Industrie-/Robotik-Anbieter). Allgemeine oder entfernt verwandte Fragen zählen NICHT als fremd — im Zweifel WEGLASSEN. Antworte NUR mit JSON: {"fremd":[<Nummern>]}\n\n${listing}`,
      1200,
    );
    const parsed = parseJson(text || "") || {};
    const idx: number[] = Array.isArray(parsed.fremd) ? parsed.fremd : [];
    for (const n of idx) {
      const d = block[Number(n)];
      if (d?.id) flaggedIds.push(d.id);
    }
  }
  if (flaggedIds.length) {
    // Blockweise deaktivieren + zur Prüfung markieren (nie löschen — reversibel).
    for (let i = 0; i < flaggedIds.length; i += 200) {
      await sbAny.from("ai_visibility_prompt_defs")
        .update({ active: false, needs_review: true })
        .in("id", flaggedIds.slice(i, i + 200));
    }
  }
  diag(`relevanz-audit ${c.name}: ${flaggedIds.length}/${markt.length} fremde Markt-Prompts deaktiviert`);
  const flaggedSet = new Set(flaggedIds);
  return {
    checked: markt.length, flagged: flaggedIds.length,
    flaggedPrompts: markt.filter((d: any) => flaggedSet.has(d.id)).map((d: any) => d.prompt),
  };
}

// ── Auto-Kuration der Prüf-Queue (10.08.2026) ────────────────────────────────
// Klare Fälle automatisch entscheiden, damit nur echte Zweifelsfälle auf
// menschliche Freigabe warten: (1) Brand-Prompts, die einen Markenbegriff
// enthalten, sind per Definition on-topic → sofort freigeben (kein LLM).
// (2) Rest per konservativem 3-Wege-Check gegen das Faktenprofil: "passt" →
// aktivieren, "fremd" → archivieren (reversibel, Tab Archiviert), "unklar" →
// bleibt in der Queue. Ohne Faktenprofil wird NICHTS entschieden.
async function autoCuratePrompts(
  c: any, sbAny: any, facts?: any,
): Promise<{ pending: number; approved: number; archived: number; unclear: number; skipped?: string; archivedIds?: string[] }> {
  const { data: pend } = await sbAny
    .from("ai_visibility_prompt_defs")
    .select("id, prompt, prompt_type, active")
    .eq("client_id", c.id).eq("needs_review", true).limit(1000);
  const pending: any[] = pend ?? [];
  if (!pending.length) return { pending: 0, approved: 0, archived: 0, unclear: 0 };

  const terms: string[] = (Array.isArray(c.brand_terms) && c.brand_terms.length ? c.brand_terms : [c.name])
    .map((t: any) => String(t).trim().toLowerCase()).filter(Boolean);
  const hasBrand = (p: string) => { const s = p.toLowerCase(); return terms.some((t) => s.includes(t)); };

  const approveIds: string[] = [];
  const archiveIds: string[] = [];
  // (1) Brand-Prompts mit Markenbegriff: deterministisch freigeben.
  const rest: any[] = [];
  for (const d of pending) {
    if (d.prompt_type === "brand" && hasBrand(String(d.prompt || ""))) approveIds.push(d.id);
    else rest.push(d);
  }
  // (2) LLM-Check nur für den Rest — und nur mit Faktenprofil als Erdung.
  const f = facts ?? await getBrandFacts(c, sbAny).catch(() => null);
  const hasFacts = f && (f.angebot || (Array.isArray(f.kernfakten) && f.kernfakten.length));
  if (rest.length && hasFacts) {
    const factsText = `${f.angebot ? "Angebot: " + f.angebot + ". " : ""}${Array.isArray(f.kernfakten) && f.kernfakten.length ? "Fakten: " + f.kernfakten.join(" | ") : ""}`;
    for (let off = 0; off < rest.length; off += 40) {
      const block = rest.slice(off, off + 40);
      const listing = block.map((d: any, i: number) => `${i}: ${d.prompt}`).join("\n");
      const text = await askUtility(
        `Firma "${c.name}". WAS SIE MACHT: ${factsText}\n\nUnten nummerierte Kunden-Suchanfragen, die zur Prüfung anstehen. Ordne JEDE Nummer genau einem Urteil zu:\n- "passt": Thema gehört KLAR zum Angebot der Firma\n- "fremd": Thema liegt KLAR in einer anderen Branche\n- "unklar": alles dazwischen — im geringsten Zweifel IMMER "unklar" (ein Mensch entscheidet dann)\nAntworte NUR mit JSON: {"passt":[<Nummern>],"fremd":[<Nummern>]} — nicht genannte Nummern gelten als unklar.\n\n${listing}`,
        1200,
      );
      const parsed = parseJson(text || "") || {};
      for (const n of Array.isArray(parsed.passt) ? parsed.passt : []) {
        const d = block[Number(n)]; if (d?.id) approveIds.push(d.id);
      }
      for (const n of Array.isArray(parsed.fremd) ? parsed.fremd : []) {
        const d = block[Number(n)]; if (d?.id && !approveIds.includes(d.id)) archiveIds.push(d.id);
      }
    }
  }
  for (let i = 0; i < approveIds.length; i += 200) {
    await sbAny.from("ai_visibility_prompt_defs")
      .update({ needs_review: false, active: true }).in("id", approveIds.slice(i, i + 200));
  }
  for (let i = 0; i < archiveIds.length; i += 200) {
    await sbAny.from("ai_visibility_prompt_defs")
      .update({ needs_review: false, active: false }).in("id", archiveIds.slice(i, i + 200));
  }
  const unclear = pending.length - approveIds.length - archiveIds.length;
  diag(`auto-kuration ${c.name}: ${approveIds.length} freigegeben, ${archiveIds.length} archiviert, ${unclear} bleiben zur Prüfung`);
  return {
    pending: pending.length, approved: approveIds.length, archived: archiveIds.length, unclear,
    skipped: rest.length && !hasFacts ? "kein Faktenprofil — nur Brand-Regel angewandt" : undefined,
    archivedIds: archiveIds,
  };
}

// Konkurrenten-Relevanz-Audit (04.08., Anlass: IKEA bei Studioforma): gleicht
// Fixliste + aktuelle SoV-Marken gegen das Faktenprofil ab und deaktiviert
// branchenfremde (reversibel, active=false = Ausschluss-Marker — der Prompt-
// Runner filtert deaktivierte Namen künftig aus SoV/Auto-Learning heraus).
// SoV-Zeilen der Deaktivierten werden entfernt, damit Rankings sofort sauber sind.
async function auditCompetitorRelevance(
  c: any, sbAny: any,
): Promise<{ checked: number; flagged: number; skipped?: string; flaggedNames?: string[] }> {
  const f = await getBrandFacts(c, sbAny).catch(() => null);
  if (!f || (!f.angebot && !(Array.isArray(f.kernfakten) && f.kernfakten.length)))
    return { checked: 0, flagged: 0, skipped: "kein Faktenprofil" };
  const { data: comps } = await sbAny
    .from("ai_visibility_competitors").select("id, name, active").eq("client_id", c.id);
  const byLower = new Map<string, any>((comps ?? []).map((x: any) => [String(x.name).toLowerCase(), x]));
  // Auch Marken prüfen, die nur in der aktuellen SoV stehen (Judge-Top-12 ohne Fixlisten-Eintrag).
  const { data: rep } = await sbAny
    .from("ai_visibility_reports").select("id").eq("client_id", c.id)
    .order("snapshot_date", { ascending: false }).limit(1);
  const { data: sovRows } = rep?.[0]
    ? await sbAny.from("ai_visibility_sov").select("brand, is_self").eq("report_id", rep[0].id)
    : { data: [] as any[] };
  const items: Array<{ name: string; id?: string }> = [];
  const seen = new Set<string>();
  for (const x of comps ?? []) {
    if (!x.active) continue; // bereits deaktiviert = bereits ausgeschlossen
    const k = String(x.name).toLowerCase();
    if (!seen.has(k)) { seen.add(k); items.push({ name: x.name, id: x.id }); }
  }
  for (const s of sovRows ?? []) {
    if (s.is_self) continue;
    const k = String(s.brand).toLowerCase();
    if (byLower.get(k)?.active === false) continue;
    if (!seen.has(k)) { seen.add(k); items.push({ name: String(s.brand), id: byLower.get(k)?.id }); }
  }
  if (!items.length) return { checked: 0, flagged: 0, skipped: "keine Konkurrenten" };
  const factsText = `${f.angebot ? "Angebot: " + f.angebot + ". " : ""}${Array.isArray(f.kernfakten) && f.kernfakten.length ? "Fakten: " + f.kernfakten.join(" | ") : ""}`;
  const listing = items.map((d, i) => `${i}: ${d.name}`).join("\n");
  const text = await askUtility(
    `Firma "${c.name}". WAS SIE MACHT: ${factsText}\n\nUnten nummerierte Marken, die als KONKURRENTEN dieser Firma geführt werden. Nenne NUR die Nummern, die KEINE direkten Wettbewerber sind — z. B. Marken einer klar anderen Branche, Produkt-/Möbelhersteller, Software, Buchungs-/Bewertungsportale, Medien oder generische Grosskonzerne (Beispiel: IKEA ist KEIN Konkurrent eines Architekturbüros). Echte Anbieter mit vergleichbarem Angebot im Zweifel BEHALTEN. Antworte NUR mit JSON: {"fremd":[<Nummern>]}\n\n${listing}`,
    1200,
  );
  const parsed = parseJson(text || "") || {};
  const idx: number[] = Array.isArray(parsed.fremd) ? parsed.fremd : [];
  const flagged = idx.map((n) => items[Number(n)]).filter(Boolean);
  for (const d of flagged) {
    if (d.id) {
      await sbAny.from("ai_visibility_competitors").update({ active: false }).eq("id", d.id);
    } else {
      // Ausschluss-Marker für Nur-SoV-Marken: inaktiver Fixlisten-Eintrag.
      await sbAny.from("ai_visibility_competitors")
        .upsert([{ client_id: c.id, name: d.name, active: false, source: "audit" }], { onConflict: "client_id,name" });
    }
    await sbAny.from("ai_visibility_sov").delete().eq("client_id", c.id).ilike("brand", d.name);
  }
  diag(`konkurrenten-audit ${c.name}: ${flagged.length}/${items.length} branchenfremde deaktiviert`);
  return { checked: items.length, flagged: flagged.length, flaggedNames: flagged.map((d) => d.name) };
}

// Brand-Judge (E2): bewertet WAS über die Marke gesagt wird — Faktentreue
// gegen brand_facts, Tonalität, Halluzinationen (mit Zitat), Quellen,
// Konkurrenz-Nennungen. temp 0 + Modell-Snapshot wie beim Markt-Judge.
async function judgeBrandAnswers(brand: string, facts: any, items: Array<{ i: number; platform: string; text: string }>) {
  const head = `Du prüfst KI-Antworten über die Marke "${brand}". Abgleichsbasis (Faktenprofil): ${JSON.stringify(facts).slice(0, 1200)}\nFür JEDE Antwort ein Objekt:\n{"i":<nr>,"faktentreue":"korrekt"|"teilweise"|"falsch"|"veraltet"|"unbewertbar","tonalitaet":"positiv"|"neutral"|"negativ"|"warnend","halluzination":"wörtliches Zitat der frei erfundenen Angabe"|null,"quellen":["explizit genannte Quell-URLs oder Domains, max 8"],"konkurrenz":["andere genannte Firmen/Marken OHNE die Zielmarke, max 8"]}\nSei streng: "falsch"/"veraltet" nur bei klarem Widerspruch zum Faktenprofil; Halluzination = konkrete erfundene Angabe (Adresse, Zahl, Angebot), nicht blosse Allgemeinheit. Antworte NUR mit JSON-Array.\n\n`;
  const CHUNK = 8;
  const map: Record<number, any> = {};
  const chunks: Array<typeof items> = [];
  for (let off = 0; off < items.length; off += CHUNK) chunks.push(items.slice(off, off + CHUNK));
  const results = await pMap(chunks, (ch) => {
    const list = ch.map((a) => `#${a.i} [${a.platform}] ${String(a.text).slice(0, 3000)}`).join("\n---\n");
    return askUtilityMeta(head + list, 4000, SCORE_CFG.judge.temperature).catch(() => null);
  }, 4);
  const models = new Set<string>();
  for (const r of results) {
    if (!r?.text) continue;
    models.add(r.model);
    const arr = parseJson(r.text);
    if (Array.isArray(arr)) for (const e of arr) map[Number(e.i)] = e;
  }
  return { map, models: [...models] };
}

// Judge-Kalibrierung (Score v2): 20 handgelabelte reale Antworten
// (src/lib/judge-calibration.json). Läuft automatisch, wenn der Judge mit
// einem Modell außerhalb der Baseline geantwortet hat — Übereinstimmung
// (mentioned+cited exakt) in % wird geloggt; unter der Schwelle: Warnung
// im Report statt stiller Drift.
async function runJudgeCalibration(): Promise<{ pct: number; n: number } | null> {
  const byBrand = new Map<string, Array<{ i: number; platform: string; text: string; exp: any }>>();
  (JUDGE_ANCHORS as any[]).forEach((a: any, i: number) => {
    const arr = byBrand.get(a.brand) || [];
    arr.push({ i, platform: a.platform, text: a.text, exp: a.expected });
    byBrand.set(a.brand, arr);
  });
  let ok = 0, n = 0;
  const groups = [...byBrand.entries()];
  await pMap(groups, async ([brand, items]) => {
    const res = await judgeAnswers(brand, [], items.map((x) => ({ i: x.i, platform: x.platform, text: x.text }))).catch(() => null);
    for (const x of items) {
      const j = res?.map?.[x.i];
      n += 1;
      if (j && !!j.mentioned === !!x.exp.mentioned && !!j.cited === !!x.exp.cited) ok += 1;
    }
  }, 3);
  return n ? { pct: Math.round((ok / n) * 100), n } : null;
}

// LLM-Judge (A): jede Antwort strukturiert bewerten statt Regex.
async function judgeAnswers(brand: string, comps: string[], items: Array<{ i: number; platform: string; text: string }>) {
  const hint = comps.length ? `Bekannte Konkurrenten (nutze diese Schreibweise, ergänze neue): ${comps.join(", ")}. ` : "";
  const head = `Du bewertest KI-Antworten für die Zielmarke "${brand}". ${hint}Für JEDE Antwort ein Objekt:\n{"i":<nr>,"mentioned":true|false (wird die Zielmarke genannt?),"cited":true|false (wird ihre Website/Domain als Quelle genannt/verlinkt?),"position":"top"|"list"|"passing"|"none" (top=klare Top-Empfehlung, list=eine von mehreren gleichrangig, passing=nur Randnotiz, none=nicht genannt),"sentiment":"pos"|"neu"|"neg"|null (Tonalität ggü. der Zielmarke),"competitors":["NUR direkte Wettbewerber der Zielmarke (vergleichbares Angebot/gleiche Branche), max 8 — KEINE Produkt-/Möbelmarken, Software, Portale, Medien oder Grosskonzerne anderer Branchen"],"comp_positions":[{"n":"<Konkurrent aus competitors>","p":"top"|"list"|"passing","s":"pos"|"neu"|"neg","d":"offizielle Website-Domain des Konkurrenten, nur falls sicher bekannt (z.B. helvetas.org) — sonst weglassen"}] (Position + Tonalität JEDES genannten Konkurrenten, gleiche Skalen),"sources":["explizit genannte Quell-URLs, max 8"]}\nSei streng: Substring-Zufallstreffer sind KEINE Erwähnung. Antworte NUR mit JSON-Array.\n\n`;
  // Judge in Blöcken -> skaliert auf beliebig viele Prompts (ohne Token-Limit zu sprengen).
  // Blöcke PARALLEL (2026-07-16): sequenziell traf jeder Block die volle
  // Failover-Kette (bis 120s je Provider) — 15 Blöcke x haengender Erst-
  // Provider = ~30 Min > Hosting-Kap (~10 Min), der Lauf starb vor dem
  // Report-Write. Parallel = Wall-Clock einer einzigen Ketten-Traversierung.
  const CHUNK = 12;
  const map: Record<number, any> = {};
  const chunks: Array<typeof items> = [];
  for (let off = 0; off < items.length; off += CHUNK) chunks.push(items.slice(off, off + CHUNK));
  // Judge-Härtung (Score v2): temperature 0 (deterministisch) + aufgelöste
  // Modell-Snapshot-Namen je Bewertungs-Block festhalten (nie nur Alias).
  const results = await pMap(chunks, (ch) => {
    const list = ch.map((a) => `#${a.i} [${a.platform}] ${String(a.text).slice(0, 3000)}`).join("\n---\n");
    return askUtilityMeta(head + list, 4000, SCORE_CFG.judge.temperature).catch(() => null); // Failover-Kette: Claude -> DeepSeek -> ...
  }, 5); // max 5 Judge-Bloecke gleichzeitig — Kompromiss: volle Salve gab 529,
  // aber Laeufe muessen unter das ~300s-Gateway-Kap (2 Kunden rissen es bei 3)
  const models = new Set<string>();
  for (const r of results) {
    if (!r?.text) continue;
    models.add(r.model);
    const arr = parseJson(r.text);
    if (Array.isArray(arr)) for (const e of arr) map[Number(e.i)] = e;
  }
  return Object.keys(map).length ? { map, models: [...models] } : null;
}

async function jobPromptRunner(
  c: any,
  sbAny: any,
  fixedComps: string[] = [],
  opts: { offset?: number; target?: number; snapshot?: string; engines?: string[] } = {},
) {
  // ALLE aktiven Prompts blockweise laden — kein Limit (PostgREST kappt
  // einzelne Queries bei 1000 Zeilen, deshalb range-Schleife).
  let defs: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page } = await sbAny
      .from("ai_visibility_prompt_defs")
      .select("*")
      .eq("client_id", c.id)
      .eq("active", true)
      // Markt VOR Brand ('markt' > 'brand' absteigend): Sichtbarkeits-Messung
      // hat bei Teilläufen Priorität, Brand-Prompts laufen in den letzten Etappen.
      .order("prompt_type", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + 999);
    defs.push(...(page ?? []));
    if (!page || page.length < 1000) break;
  }
  // Nachsäen bis zum Ziel — NUR bei explizitem promptTarget (Seed-Vorlauf)
  // oder leerem Bestand (neuer Kunde). Etappen-Requests säen NICHT mit, sonst
  // wachsen die Defs mitten in der Pagination und die Etappe reisst das Kap.
  // Hartnäckig: wechselnde Blickwinkel je Durchgang, weil der LLM sonst nur
  // Dubletten liefert und der Ausbau bei ~50 % hängen bleibt.
  const target = Math.max(1, opts.target ?? PROMPT_TARGET);
  let seeded = 0;
  let seedError: string | undefined;
  // Ziel/Seeding zählt NUR Markt-Prompts; Brand-Prompts sind eine eigene,
  // kleine Kategorie (8-12) mit eigenem Seeder.
  let marktDefs = defs.filter((d: any) => (d.prompt_type || "markt") !== "brand");
  let brandDefs = defs.filter((d: any) => d.prompt_type === "brand");
  const seedingAllowed = opts.target != null || !defs.length;
  if (seedingAllowed) {
    // Faktenprofil VOR dem Markt-Seeding sicherstellen und dem Seeder mitgeben —
    // erdet die Generierung, damit keine fremde Branche erfunden wird.
    const seedFacts = await getBrandFacts(c, sbAny).catch(() => null);
    const ANGLES = [
      "Fokus: saisonale und anlassbezogene Fragen (Feiertage, Events, Jahreszeiten, Geschenke)",
      "Fokus: Preis-, Budget- und Vergleichsfragen (günstig vs. Premium, Preis-Leistung)",
      "Fokus: sehr spezifische Long-Tail-Nischen und Sonderwünsche",
      "Fokus: verschiedene Zielgruppen (Familien, Paare, Business, Senioren, Touristen, Einsteiger)",
      "Fokus: situationsgetriebene Fragen (kurzfristig, mit Haustier, Gruppen, barrierefrei, Wetter)",
      "Fokus: Umgebungs-, Anreise- und Kombinationsfragen je Land/Region",
    ];
    let attempt = 0, zero = 0;
    while (marktDefs.length < target && attempt < 6 && zero < 3) {
      const s = await seedPromptDefs(c, sbAny, {
        count: target - marktDefs.length,
        existing: [...marktDefs, ...brandDefs].map((d: any) => d.prompt),
        angle: ANGLES[attempt % ANGLES.length],
        facts: seedFacts,
      });
      attempt += 1;
      if (!s.defs.length) { zero += 1; seedError = s.error; continue; }
      zero = 0;
      marktDefs = [...marktDefs, ...s.defs];
      seeded += s.defs.length;
    }
    // Brand-Set (E1): einmalig 8-12 generieren, needsReview=true — Kuratur
    // bleibt menschlich, der Lauf startet trotzdem (Aktivierungs-Absicht).
    if (!brandDefs.length) {
      const bs = await seedBrandPrompts(c, sbAny).catch(() => []);
      if (bs.length) { brandDefs = bs; diag(`prompts: Brand-Set generiert (${bs.length}, needsReview)`); }
    }
    // Relevanz-Selbstcheck direkt nach dem Seeding: fremd-thematische Markt-
    // Prompts sofort deaktivieren, damit sie gar nicht erst gemessen/angezeigt
    // werden. Die geflaggten fliegen auch aus diesem Lauf raus.
    if (seedFacts) {
      const audit = await auditPromptRelevance(c, sbAny, seedFacts).catch(() => null);
      if (audit?.flagged) {
        const { data: stillActive } = await sbAny
          .from("ai_visibility_prompt_defs").select("id").eq("client_id", c.id).eq("active", true);
        const okIds = new Set((stillActive ?? []).map((r: any) => r.id));
        marktDefs = marktDefs.filter((d: any) => okIds.has(d.id));
        diag(`prompts: Relevanz-Audit entfernte ${audit.flagged} fremde Prompts aus dem Lauf`);
      }
    }
  }
  // Auto-Kuration der Prüf-Queue (10.08.): klare Fälle selbst entscheiden,
  // nur Unklares bleibt für Menschen. Nur in Etappe 0, damit Teilläufe die
  // Def-Liste nicht mitten in der Pagination verändern.
  if (!opts.offset) {
    const cur = await autoCuratePrompts(c, sbAny).catch(() => null);
    if (cur?.archivedIds?.length) {
      const gone = new Set(cur.archivedIds);
      marktDefs = marktDefs.filter((d: any) => !gone.has(d.id));
      brandDefs = brandDefs.filter((d: any) => !gone.has(d.id));
    }
  }
  defs = [...marktDefs, ...brandDefs];
  if (!defs.length) return { skipped: `Seeding fehlgeschlagen: ${seedError || "unbekannt"}` };

  // Chunking (2026-07-17): mehr als ~30 Prompts reissen das ~300s-Gateway-Kap.
  // Mit promptOffset fragt dieser Request nur defs[offset, offset+CHUNK); der
  // Aufrufer loopt bis `next` null ist. Aggregation erst im letzten Häppchen.
  // 20 je Etappe = 2 Wellen à max 90s (conc 10) + Judge — passt unter das Kap.
  // 30 riss es bei websearch-lastigen Prompts (B5: Engines allein 4:21).
  const CHUNK = Math.max(5, Number(process.env.AIVIS_PROMPT_CHUNK ?? 20) || 20);
  const allDefs = defs;
  const chunked = opts.offset != null;
  const offset = chunked ? Math.min(opts.offset as number, allDefs.length) : 0;
  const slice = chunked ? allDefs.slice(offset, offset + CHUNK) : allDefs;
  if (!slice.length) return { skipped: `promptOffset ${offset} >= ${allDefs.length} Defs` };
  const next = chunked && offset + slice.length < allDefs.length ? offset + slice.length : null;
  defs = slice;
  diag(`prompts: ${allDefs.length} defs geladen (seeded ${seeded}${chunked ? `, Häppchen ${offset}–${offset + slice.length}` : ""})`);

  const nameRe = new RegExp(String(c.name || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const domain = cleanDomain(c.domain);

  // Alle Engines × Prompts.
  const rows: any[] = [];
  const engineErrors: Record<string, string> = {};
  // Engines PARALLEL (2026-07-16): sequenziell summierten sich langsame
  // Provider auf >10 Min und das Hosting kappte den Request vor der 20-Min-
  // Job-Deadline (Run-Zeile blieb "running"). Parallel erhoeht die Last pro
  // Provider nicht — jede Engine stellt weiterhin nur ihre eigenen Prompts.
  // Engine-Nachzieh-Modus: explizite Liste übersteuert den Grok-Wochentagsfilter.
  const engineList = opts.engines?.length
    ? PROMPT_ENGINES.filter((e) => opts.engines!.includes(e.name))
    : activePromptEngines();
  const engineAnswers = await Promise.all(engineList.map(async (eng) => {
    // Harte Deadline je Call: AbortSignal wird von der Runtime ignoriert
    // (2026-07-14 verifiziert) — ohne Promise.race haengt EIN toter Provider-
    // Call den gesamten Lauf endlos. Max 10 gleichzeitig je Provider, 90s je
    // Ask: der GESAMTE Lauf muss unter das ~300s-Gateway-Kap; websearch-lastige
    // Prompts (B5) brauchten bei conc 6/120s allein 4+ Min fuer die Engines.
    const ask = (d: any) => withDeadline(eng.ask(d.prompt), 90_000, `ask:${eng.name}`).catch(() => null);
    const answers = await pMap(defs, ask, 10);
    // Ein Retry-Durchgang fuer leere Antworten (Rate-Limit-Erholung), gedrosselt.
    const misses = answers.map((a: any, i: number) => (!a || !a.text ? i : -1)).filter((i) => i >= 0);
    if (misses.length && misses.length < defs.length) {
      await new Promise((r) => setTimeout(r, 2000));
      const retries = await pMap(misses, (i: number) => ask(defs[i]), 5);
      retries.forEach((a: any, k: number) => { if (a && a.text) answers[misses[k]] = a; });
    }
    return { eng, answers };
  }));
  // Brand-Antworten SEPARAT halten (Marken-Check): sie fliessen NIE in die
  // Sichtbarkeits-Aggregate (SoV/PosQ/Mentions) — `rows` = NUR Markt-Zeilen.
  const bRows: any[] = [];
  for (const { eng, answers } of engineAnswers) {
    answers.forEach((a: any, i) => {
      if (!a || !a.text) {
        if (a?.error && !engineErrors[eng.name]) engineErrors[eng.name] = a.error;
        return;
      }
      if ((defs[i]?.prompt_type || "markt") === "brand") bRows.push({ i: bRows.length, def: defs[i], platform: eng.name, text: a.text });
      else rows.push({ i: rows.length, def: defs[i], platform: eng.name, text: a.text });
    });
  }
  diag(`prompts: Engines fertig (${rows.length} Markt- + ${bRows.length} Brand-Antworten)`);
  if (!rows.length && !bRows.length) return { skipped: "keine Engine-Antworten", seeded };

  // A) LLM-Judge über alle Antworten; Fallback = Regex, falls Judge ausfällt.
  // Harte Gesamt-Deadline (2026-07-16): der Judge darf den Lauf nie ueber das
  // Hosting-Kap (~10 Min) schieben — lieber Regex-Fallback als toter Lauf.
  const judgeRes = await withDeadline(
    judgeAnswers(c.name, fixedComps, rows.map((r) => ({ i: r.i, platform: r.platform, text: r.text }))),
    5 * 60_000,
    "judge",
  ).catch(() => null);
  const judged = judgeRes?.map ?? null;
  const judgeModels: string[] = judgeRes?.models ?? [];
  diag(`prompts: Judge fertig (${judged ? Object.keys(judged).length : "Fallback Regex"}${judgeModels.length ? ", " + judgeModels.join("+") : ""})`);
  const evals = rows.map((r) => {
    const j = judged?.[r.i];
    if (j) {
      return {
        mentioned: !!j.mentioned || !!j.cited,
        cited: !!j.cited,
        position: ["top", "list", "passing", "none"].includes(j.position) ? j.position : (j.mentioned ? "list" : "none"),
        sentiment: ["pos", "neu", "neg"].includes(j.sentiment) ? j.sentiment : null,
        competitors: Array.isArray(j.competitors) ? j.competitors.map((x: any) => String(x).trim()).filter(Boolean).slice(0, 8) : [],
        // Rival-Positionen (H, 03.08.): {n: Name, p: top|list|passing} je Konkurrent.
        compPositions: Array.isArray(j.comp_positions)
          ? j.comp_positions
              .map((x: any) => {
                // Rival-Domain (04.08., für echte Marken-Logos statt Rate-Kette).
                const dom = String(x?.d || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim();
                return {
                  n: String(x?.n || "").trim(),
                  p: ["top", "list", "passing"].includes(x?.p) ? x.p : "list",
                  // Rival-Sentiment (04.08.): Tonalität je Konkurrent, gleiche Skala wie eigene Marke.
                  ...(["pos", "neu", "neg"].includes(x?.s) ? { s: x.s } : {}),
                  ...(dom.includes(".") && dom.length <= 80 ? { d: dom } : {}),
                };
              })
              .filter((x: any) => x.n)
              .slice(0, 8)
          : [],
        sources: Array.isArray(j.sources) ? j.sources.map(String) : urlListIn(r.text),
      };
    }
    const cited = domain ? r.text.toLowerCase().includes(domain.toLowerCase()) : false;
    const mentioned = nameRe.test(r.text) || cited;
    return { mentioned, cited, position: mentioned ? "list" : "none", sentiment: null as string | null, competitors: [] as string[], compPositions: [] as any[], sources: urlListIn(r.text) };
  });

  // Prompt-Ergebnisse für die DB (mit Sentiment/Position).
  const marktPromptRows = rows.map((r, k) => {
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
      // 6000 statt 1500 Zeichen (04.08.): der Judge bewertet den VOLLEN Text —
      // bei 1500 lag die Markennennung oft im nicht gespeicherten Teil (User-Befund).
      response: r.text.slice(0, 6000),
      competitors: e.competitors,
      prompt_type: "markt",
      // Phase-2-Ausbau (03.08.): Thema/URLs/Zeitstempel/Rival-Positionen je Antwort.
      topic: r.def.topic || null,
      source_urls: e.sources.slice(0, 20),
      checked_at: new Date().toISOString(),
      comp_positions: e.compPositions?.length ? e.compPositions : null,
    };
  });

  // Brand-Judge über die Brand-Antworten dieser Etappe (E2).
  let bEvals: any[] = [];
  let brandJudgeModels: string[] = [];
  let brandFacts: any = null;
  if (bRows.length) {
    brandFacts = await getBrandFacts(c, sbAny).catch(() => null);
    const bj = await withDeadline(
      judgeBrandAnswers(c.name, brandFacts || {}, bRows.map((r) => ({ i: r.i, platform: r.platform, text: r.text }))),
      4 * 60_000,
      "brand-judge",
    ).catch(() => ({ map: {} as Record<number, any>, models: [] as string[] }));
    brandJudgeModels = bj.models;
    bEvals = bRows.map((r) => {
      const j = bj.map[r.i] || {};
      return {
        faktentreue: ["korrekt", "teilweise", "falsch", "veraltet", "unbewertbar"].includes(j.faktentreue) ? j.faktentreue : "unbewertbar",
        tonalitaet: ["positiv", "neutral", "negativ", "warnend"].includes(j.tonalitaet) ? j.tonalitaet : "neutral",
        halluzination: j.halluzination ? String(j.halluzination).slice(0, 300) : null,
        quellen: Array.isArray(j.quellen) ? j.quellen.map(String).slice(0, 8) : urlListIn(r.text).slice(0, 8),
        konkurrenz: Array.isArray(j.konkurrenz) ? j.konkurrenz.map((x: any) => String(x).trim()).filter(Boolean).slice(0, 8) : [],
      };
    });
    diag(`prompts: Brand-Judge fertig (${bRows.length}${brandJudgeModels.length ? ", " + brandJudgeModels.join("+") : ""})`);
  }
  const brandPromptRows = bRows.map((r, k) => {
    const e = bEvals[k] || {};
    return {
      prompt: r.def.prompt,
      platform: r.platform,
      country: r.def.country || "Schweiz",
      // Erwähnt-Status seit 10.08. auch bei Brand-Zeilen (Branded-&-Unbranded-
      // Sicht im Dashboard braucht ihn; vorher bewusst NULL). Simple Text-
      // Erkennung genügt — bei Marken-Fragen ist die Nennung trivial.
      status: domain && r.text.toLowerCase().includes(domain.toLowerCase())
        ? "Referenziert" : nameRe.test(r.text) ? "Erwähnt" : "Nicht erwähnt",
      is_opportunity: false,
      intent: r.def.intent || "Navigativ",
      sentiment: null,
      position: null,
      brands_count: (e.konkurrenz || []).length,
      sources_count: (e.quellen || []).length,
      // 6000 statt 1500 Zeichen (04.08.): der Judge bewertet den VOLLEN Text —
      // bei 1500 lag die Markennennung oft im nicht gespeicherten Teil (User-Befund).
      response: r.text.slice(0, 6000),
      competitors: e.konkurrenz || [],
      prompt_type: "brand",
      brand_eval: { ...e, judge: { models: brandJudgeModels, temperature: SCORE_CFG.judge.temperature } },
      topic: r.def.topic || null,
      source_urls: (e.quellen || []).slice(0, 20),
      checked_at: new Date().toISOString(),
    };
  });
  const promptRows = [...marktPromptRows, ...brandPromptRows];

  // Nicht-letztes Häppchen: nur Zeilen liefern, KEINE Aggregation — die
  // rechnet erst das letzte Häppchen über alle Antworten des Tages.
  if (next != null) {
    const byEnginePart: Record<string, number> = {};
    for (const r of [...rows, ...bRows]) byEnginePart[r.platform] = (byEnginePart[r.platform] || 0) + 1;
    return {
      promptRows, seeded, answered: rows.length + bRows.length, byEngine: byEnginePart, engineErrors,
      partial: true, chunk: { offset, next, total: allDefs.length }, engineFilter: opts.engines ?? null,
    };
  }

  // Letztes Häppchen (offset > 0): frühere Häppchen aus der DB dazuladen,
  // damit SoV/Themen/Modelle/Quellen über ALLE Antworten des Tages rechnen.
  if (chunked && offset > 0 && opts.snapshot) {
    const { data: repRow } = await sbAny
      .from("ai_visibility_reports").select("id")
      .eq("client_id", c.id).eq("snapshot_date", opts.snapshot).maybeSingle();
    if (repRow) {
      const prior: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data: page } = await sbAny
          .from("ai_visibility_prompts").select("*")
          .eq("report_id", repRow.id).order("id", { ascending: true }).range(from, from + 999);
        prior.push(...(page ?? []));
        if (!page || page.length < 1000) break;
      }
      const defMeta = new Map(allDefs.map((d: any) => [d.prompt, d]));
      const currentKeys = new Set([...rows, ...bRows].map((r) => `${r.def.prompt}·${r.platform}`));
      let merged = 0;
      for (const p of prior) {
        if (currentKeys.has(`${p.prompt}·${p.platform}`)) continue;
        const d = defMeta.get(p.prompt) || { prompt: p.prompt, country: p.country, intent: p.intent };
        // Brand-Zeilen früherer Etappen -> in den Marken-Check, NIE in die
        // Sichtbarkeits-Aggregate.
        if ((p.prompt_type || "markt") === "brand") {
          bRows.push({ i: -1, def: d, platform: p.platform, text: String(p.response || "") });
          const be = p.brand_eval || {};
          bEvals.push({
            faktentreue: be.faktentreue || "unbewertbar",
            tonalitaet: be.tonalitaet || "neutral",
            halluzination: be.halluzination ?? null,
            quellen: Array.isArray(be.quellen) ? be.quellen : [],
            konkurrenz: Array.isArray(be.konkurrenz) ? be.konkurrenz : [],
          });
          merged += 1;
          continue;
        }
        rows.push({ i: -1, def: d, platform: p.platform, text: String(p.response || "") });
        evals.push({
          mentioned: p.status != null,
          cited: p.status === "Referenziert",
          position: p.position || (p.status != null ? "list" : "none"),
          sentiment: p.sentiment ?? null,
          competitors: Array.isArray(p.competitors) ? p.competitors.map(String) : [],
          compPositions: Array.isArray(p.comp_positions) ? p.comp_positions : [],
          sources: Array.isArray(p.source_urls) && p.source_urls.length ? p.source_urls.map(String) : urlListIn(String(p.response || "")),
        });
        merged += 1;
      }
      diag(`prompts: letzte Etappe — ${merged} frühere Antworten für Aggregation dazugeladen`);
    }
  }

  // Judge-Kalibrierung: nur im letzten Häppchen und nur bei Modell-Wechsel
  // (Judge antwortete mit einem Modell außerhalb der Baseline).
  let judgeCalibration: { pct: number; n: number } | null = null;
  const baseline: string[] = SCORE_CFG.judge.baselineModels || [];
  if (judgeModels.length && judgeModels.some((m) => !baseline.some((b) => m.startsWith(b)))) {
    judgeCalibration = await withDeadline(runJudgeCalibration(), 90_000, "judge-calibration").catch(() => null);
    if (judgeCalibration) {
      const warn = judgeCalibration.pct < SCORE_CFG.judge.calibrationThresholdPct;
      diag(`prompts: Judge-Kalibrierung ${judgeCalibration.pct}% (${judgeCalibration.n} Anker)${warn ? ` ⚠️ unter ${SCORE_CFG.judge.calibrationThresholdPct}%` : ""}`);
    }
  }

  // C) Share-of-Voice: eigene Marke vs. Konkurrenten über alle Antworten.
  // Ausschluss-Marker (04.08.): als branchenfremd deaktivierte Namen (Audit
  // oder manuell) fliessen NIE in SoV/Auto-Learning — Anlass IKEA bei Studioforma.
  const { data: inactiveComps } = await sbAny
    .from("ai_visibility_competitors").select("name").eq("client_id", c.id).eq("active", false);
  const excludedComps = new Set((inactiveComps ?? []).map((r: any) => String(r.name).toLowerCase()));
  const compTally: Record<string, { name: string; n: number }> = {};
  const selfMentions = evals.filter((e) => e.mentioned).length;
  for (const e of evals) {
    for (const name of e.competitors) {
      const kk = name.toLowerCase();
      if (excludedComps.has(kk)) continue;
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
  // Wrapper-Audit (Score v2): Gemini-Grounding- (vertexaisearch) und Bing-
  // Klick-URLs werden aufgelöst — der Wrapper-Host zählt NIE als Quelle.
  const srcTally: Record<string, number> = {};
  const wrapCache = new Map<string, string | null>();
  let wrapBudget = 40; // Auflösungs-Deckel je Lauf (10s-Fetches, 300s-Kap schützen)
  for (const e of evals) for (const u of e.sources) {
    let uu = u;
    if (isWrapperUrl(u)) {
      if (!wrapCache.has(u) && wrapBudget-- <= 0) continue; // resolved:false — verwerfen
      const res = await resolveWrapper(u, wrapCache);
      if (!res) continue;
      uu = res;
    }
    const dd = domOf(uu);
    if (dd) srcTally[dd] = (srcTally[dd] || 0) + 1;
  }
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

  // ── Marken-Check (E3): eigenes Aggregat, fliesst NICHT in den Score ────────
  let brandCheck: any = null;
  if (bRows.length) {
    const rated = bEvals.filter((e) => e.faktentreue !== "unbewertbar");
    const fktn: Record<string, number> = {};
    for (const e of rated) fktn[e.faktentreue] = (fktn[e.faktentreue] || 0) + 1;
    const ton: Record<string, number> = {};
    for (const e of bEvals) ton[e.tonalitaet] = (ton[e.tonalitaet] || 0) + 1;
    const halluzinationen = bRows
      .map((r, k) => ({ engine: r.platform, prompt: r.def.prompt, zitat: bEvals[k]?.halluzination }))
      .filter((h) => h.zitat).slice(0, 10);
    // Quellen (nach Wrapper-Auflösung, S5-Mechanik) je Domain.
    const qTally: Record<string, number> = {};
    const bWrapCache = new Map<string, string | null>();
    let bWrapBudget = 20;
    for (const e of bEvals) for (const q of e.quellen || []) {
      let u = String(q);
      if (/^https?:\/\//.test(u) && isWrapperUrl(u)) {
        if (!bWrapCache.has(u) && bWrapBudget-- <= 0) continue;
        const res = await resolveWrapper(u, bWrapCache);
        if (!res) continue;
        u = res;
      }
      const dd = /^https?:\/\//.test(u) ? domOf(u) : String(u).replace(/^www\./, "").toLowerCase() || null;
      if (dd && !WRAPPER_HOSTS.some((w) => dd === w || dd.endsWith("." + w))) qTally[dd] = (qTally[dd] || 0) + 1;
    }
    const topQuellen = Object.entries(qTally).map(([domain, n]) => ({ domain, n })).sort((a, b) => b.n - a.n).slice(0, 10);
    // Konkurrenz-Nennungen in Brand-Antworten (Semrush-Effekt/Brand-Kaperung).
    const kTally: Record<string, { name: string; n: number }> = {};
    for (const e of bEvals) for (const k of e.konkurrenz || []) {
      const kk = k.toLowerCase();
      (kTally[kk] ??= { name: k, n: 0 }).n += 1;
    }
    const konkurrenzNennungen = Object.values(kTally).sort((a, b) => b.n - a.n).slice(0, 10);
    const selfNennungen = bRows.filter((r) => nameRe.test(r.text)).length;
    brandCheck = {
      answered: bRows.length,
      faktentreueQuote: rated.length ? Math.round(((fktn["korrekt"] || 0) / rated.length) * 100) : null,
      faktentreueVerteilung: fktn,
      tonalitaetsVerteilung: ton,
      halluzinationen,
      topQuellen,
      konkurrenzNennungen,
      selfNennungen,
      judge: { models: brandJudgeModels, temperature: SCORE_CFG.judge.temperature },
      ...(brandFacts ? {} : { hinweis: "brand-facts fehlten — Faktentreue eingeschränkt" }),
    };

    // Brand Perception (I, 03.08., Searchable-Parität): je Engine Stärken/Schwächen
    // aus den echten Antworten verdichten — EIN Judge-Call, kein Zusatz je Prompt.
    try {
      const perEngine = new Map<string, string[]>();
      for (const r of bRows) {
        const arr = perEngine.get(r.platform) || [];
        if (arr.length < 3) { arr.push(String(r.text).slice(0, 500)); perEngine.set(r.platform, arr); }
      }
      rows.forEach((r, k) => {
        if (!evals[k]?.mentioned) return;
        const arr = perEngine.get(r.platform) || [];
        if (arr.length < 3) { arr.push(String(r.text).slice(0, 500)); perEngine.set(r.platform, arr); }
      });
      if (perEngine.size) {
        const blocks = [...perEngine.entries()].map(([eng, texts]) => `### ${eng}\n${texts.join("\n--\n")}`).join("\n\n");
        const pRes = await withDeadline(askUtilityMeta(
          `Wie nimmt jedes KI-System die Marke "${c.name}" wahr? Analysiere NUR die folgenden echten Antworten je System. Für JEDES System ein Objekt:\n{"engine":"<Name>","staerken":["max 4 kurze Stärken-Phrasen (wörtlich belegbar)"],"schwaechen":["max 4 kurze Schwächen/Einschränkungen"],"zusammenfassung":"1 Satz, deutsch"}\nNichts erfinden — nur was in den Antworten steht. Antworte NUR mit JSON-Array.\n\n${blocks}`,
          2500, SCORE_CFG.judge.temperature,
        ), 90_000, "perception-judge").catch(() => null);
        const pArr = pRes?.text ? parseJson(pRes.text) : null;
        if (Array.isArray(pArr) && pArr.length) {
          brandCheck.perception = pArr
            .map((p: any) => ({
              engine: String(p?.engine || "").slice(0, 40),
              staerken: Array.isArray(p?.staerken) ? p.staerken.map(String).slice(0, 4) : [],
              schwaechen: Array.isArray(p?.schwaechen) ? p.schwaechen.map(String).slice(0, 4) : [],
              zusammenfassung: String(p?.zusammenfassung || "").slice(0, 300),
            }))
            .filter((p: any) => p.engine)
            .slice(0, 10);
          diag(`prompts: Perception-Judge fertig (${brandCheck.perception.length} Engines)`);
        }
      }
    } catch { /* Perception ist Zusatz — nie den Lauf gefährden */ }

    // E4: advisory-Signal für die Wunsch-Queue — max EIN Eintrag je Lauf.
    let advisory: string | null = null;
    const bad = bRows.map((r, k) => ({ r, e: bEvals[k] }))
      .find((x) => ["falsch", "veraltet"].includes(x.e?.faktentreue) || x.e?.halluzination);
    if (bad) {
      const grund = bad.e.halluzination
        ? `Halluzination: "${String(bad.e.halluzination).slice(0, 160)}"`
        : `Faktentreue "${bad.e.faktentreue}" bei "${String(bad.r.def.prompt).slice(0, 80)}"`;
      const quelle = (bad.e.quellen || [])[0];
      advisory = `Marken-Check: KI-Antwort über ${c.name} auf ${bad.r.platform} — ${grund}${quelle ? ` — Quelle: ${String(quelle).slice(0, 80)}` : ""}. Empfehlung: Fakten auf Website/Profilen aktualisieren bzw. richtigstellen.`;
    } else {
      // Tonalität mehrheitlich negativ/warnend je Engine?
      const perEngine: Record<string, { neg: number; total: number }> = {};
      bRows.forEach((r, k) => {
        const pe = (perEngine[r.platform] ??= { neg: 0, total: 0 });
        pe.total += 1;
        if (["negativ", "warnend"].includes(bEvals[k]?.tonalitaet)) pe.neg += 1;
      });
      const negEng = Object.entries(perEngine).find(([, v]) => v.total >= 3 && v.neg / v.total > 0.5);
      if (negEng) {
        advisory = `Marken-Check: Tonalität über ${c.name} auf ${negEng[0]} mehrheitlich negativ/warnend (${negEng[1].neg} von ${negEng[1].total} Antworten). Empfehlung: Ursache prüfen (Bewertungen/Presse) und gegensteuern.`;
      } else {
        const top = konkurrenzNennungen[0];
        if (top && top.n > selfNennungen) {
          advisory = `Marken-Check: Brand-Kaperung bei ${c.name} — "${top.name}" wird in Antworten auf Marken-Fragen häufiger genannt (${top.n}×) als die Marke selbst (${selfNennungen}×).`;
        }
      }
    }
    if (advisory) brandCheck.advisory = { text: advisory, date: opts.snapshot || null };
    diag(`prompts: Marken-Check aggregiert (${bRows.length} Antworten${advisory ? ", 1 advisory" : ""})`);
  }

  return {
    promptRows, customModels, topics, sov, customSources, learnedComps, brandCheck,
    chunk: chunked ? { offset, next: null as number | null, total: allDefs.length } : null,
    engineFilter: opts.engines ?? null,
    seeded, answered: rows.length, byEngine, engineErrors,
    mentions: customModels.reduce((a, m) => a + m.mentions, 0),
    selfShare: sov[0]?.share ?? 0,
    positionQuality: Math.round(positionQuality * 100),
    judged: !!judged,
    judgeModels,
    judgeCalibration,
  };
}

// ── H2: Marken-Check-Korpus-Backfill (Ahrefs Brand Radar, retro) ─────────────
// Eigene Prompt-Läufe sind nicht rückwirkend erzeugbar — der Korpus liefert
// die Vergangenheit: archivierte echte KI-Antworten mit Datum, darüber läuft
// der Brand-Judge retroaktiv (promptType "brand-korpus"). Feldverifikation
// 2026-07-18 (Changelog): ai-responses liefert date/data_source/response
// (response = 10 Units je Zeile!), Tiefe ~12 Monate, Filter nur phrase_match.
// Quelle strikt getrennt: source "korpus-backfill", provider "ahrefs-br" —
// NIE mit der eigenen Linie gemischt, KEIN Einfluss auf Score/SoV/Version.
async function jobBrandBackfill(c: any, sbAny: any, months: number, provider: string = "dataforseo") {
  // Provider "dataforseo" (Standard seit 2026-07-19, Ahrefs-Ablösung) oder
  // "ahrefs-br" (Referenz/Alt — 12 Monate Tiefe, kostet Units).
  if (provider === "ahrefs-br" && !process.env.AHREFS_API_KEY) return { skipped: "AHREFS_API_KEY fehlt" };
  if (provider === "dataforseo" && !dfsAuth()) return { skipped: "DATAFORSEO-Creds fehlen" };
  const key = process.env.AHREFS_API_KEY || "";
  const cfg: any = (SCORE_CFG as any).brandBackfill || { maxAnswersPerMonth: 30, monthsPerRequest: 2 };
  const brand = brandName(c);
  const facts = await getBrandFacts(c, sbAny).catch(() => null);
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const monthsList: Array<{ key: string; from: string; to: string; y: number; m: number }> = [];
  for (let k = 1; k <= months; k++) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - k + 1, 0);
    monthsList.push({ key: iso(d).slice(0, 7), from: iso(d), to: iso(end), y: d.getFullYear(), m: d.getMonth() });
  }
  // Idempotent/wiederaufnehmbar: vorhandene Monats-Punkte überspringen.
  const { data: existing } = await sbAny
    .from("ai_visibility_brand_history").select("point_date")
    .eq("client_id", c.id).eq("source", "korpus-backfill").eq("provider", provider);
  const have = new Set((existing || []).map((x: any) => String(x.point_date).slice(0, 7)));
  const todo = monthsList.filter((m) => !have.has(m.key));
  let processed = 0, rowsTotal = 0;
  const doneMonths: string[] = [];
  const errors: string[] = [];
  for (const m of todo) {
    if (processed >= cfg.monthsPerRequest) break; // Etappe voll — Aufrufer loopt
    processed += 1;
    let raw: any[] = [];
    if (provider === "dataforseo") {
      // DFS-Korpus (Standard seit 2026-07-19): Antworten mit first_response_at
      // im Monatsfenster (CH-Heimmarkt; Tiefe ~7 Monate, ältere Monate leer).
      const nextM = new Date(m.y, m.m + 1, 1).toISOString().slice(0, 10);
      const r = await dfsAiCall("ai_optimization/llm_mentions/search/live", {
        target: [{ keyword: brand, match_type: "word_match", search_scope: ["answer"] }],
        location_name: "Switzerland", language_code: (c.language || "de").slice(0, 2),
        limit: Math.max(1, cfg.maxAnswersPerMonth),
        filters: [["first_response_at", ">=", `${m.from} 00:00:00 +00:00`], "and", ["first_response_at", "<", `${nextM} 00:00:00 +00:00`]],
      });
      if (!r.ok) { errors.push(`${m.key}: ${r.error}`); continue; } // Monat bleibt offen -> Retry möglich
      raw = ((r.result?.[0]?.items ?? []) as any[]).map((x: any) => ({
        last_updated: String(x.first_response_at || m.to).slice(0, 10),
        data_source: x.model_name || x.platform,
        response: x.answer,
      }));
    } else {
      // Ahrefs-Referenzpfad (Feld-Lektionen 2026-07-18, doc-verifiziert):
      // nur date-Stichtag (kein from/to), Zeilen tragen last_updated,
      // response = 10 Units je Zeile, order_by nur relevance|volume.
      const r = await brandRadar("ai-responses", {
        select: "last_updated,data_source,response",
        brand,
        data_source: SOURCES.map((s) => s.ds).join(","),
        date: m.to,
        limit: Math.max(1, cfg.maxAnswersPerMonth), // Kosten-/Mengendeckel (10 Units/Zeile)
        search_volume_type: "ask_volume",
      }, key);
      if (!r.ok) { errors.push(`${m.key}: ${r.error}`); continue; } // Monat bleibt offen -> Retry möglich
      raw = (r.data?.ai_responses ?? r.data?.responses ?? r.data?.items ?? []) as any[];
    }
    const answers = raw
      .map((x: any) => ({
        date: String(x.last_updated || m.to),
        engine: provider === "dataforseo"
          ? dfsLlmLabel(String(x.data_source || ""))
          : (SOURCES.find((s) => s.ds === x.data_source)?.name || String(x.data_source || "KI")),
        text: String(x.response || ""),
      }))
      .filter((a) => a.text.length > 40)
      .slice(0, cfg.maxAnswersPerMonth);
    if (raw.length >= cfg.maxAnswersPerMonth) diag(`brand-backfill ${m.key}: Deckel greift (${cfg.maxAnswersPerMonth} Antworten)`);
    rowsTotal += answers.length;
    let data: any = {
      monat: m.key, answered: answers.length, faktentreueQuote: null,
      tonalitaetsVerteilung: {}, halluzinationen: [], konkurrenzNennungen: [], topQuellen: [], judge: null,
    };
    if (answers.length) {
      const bj = await withDeadline(
        judgeBrandAnswers(c.name, facts || {}, answers.map((a, i) => ({ i, platform: a.engine, text: a.text }))),
        4 * 60_000, "brand-korpus-judge",
      ).catch(() => ({ map: {} as Record<number, any>, models: [] as string[] }));
      const evals = answers.map((a, i) => {
        const j = (bj.map as any)[i] || {};
        return {
          faktentreue: ["korrekt", "teilweise", "falsch", "veraltet", "unbewertbar"].includes(j.faktentreue) ? j.faktentreue : "unbewertbar",
          tonalitaet: ["positiv", "neutral", "negativ", "warnend"].includes(j.tonalitaet) ? j.tonalitaet : "neutral",
          halluzination: j.halluzination ? String(j.halluzination).slice(0, 300) : null,
          quellen: Array.isArray(j.quellen) ? j.quellen.map(String).slice(0, 8) : [],
          konkurrenz: Array.isArray(j.konkurrenz) ? j.konkurrenz.map((x: any) => String(x).trim()).filter(Boolean).slice(0, 8) : [],
        };
      });
      const rated = evals.filter((e) => e.faktentreue !== "unbewertbar");
      const fktn: Record<string, number> = {};
      for (const e of rated) fktn[e.faktentreue] = (fktn[e.faktentreue] || 0) + 1;
      const ton: Record<string, number> = {};
      for (const e of evals) ton[e.tonalitaet] = (ton[e.tonalitaet] || 0) + 1;
      const kT: Record<string, { name: string; n: number }> = {};
      for (const e of evals) for (const k2 of e.konkurrenz) { const kk = k2.toLowerCase(); (kT[kk] ??= { name: k2, n: 0 }).n += 1; }
      const qT: Record<string, number> = {};
      for (const e of evals) for (const q of e.quellen) {
        const dd = /^https?:\/\//.test(q) ? domOf(q) : String(q).replace(/^www\./, "").toLowerCase() || null;
        if (dd && !WRAPPER_HOSTS.some((w) => dd === w || dd.endsWith("." + w))) qT[dd] = (qT[dd] || 0) + 1;
      }
      data = {
        monat: m.key, answered: answers.length,
        // faktentreue NUR wo der Text genug hergibt — sonst null, nicht raten.
        faktentreueQuote: rated.length >= 3 ? Math.round(((fktn["korrekt"] || 0) / rated.length) * 100) : null,
        faktentreueVerteilung: fktn,
        tonalitaetsVerteilung: ton,
        halluzinationen: answers.map((a, i2) => ({ engine: a.engine, datum: a.date, zitat: evals[i2].halluzination })).filter((h) => h.zitat).slice(0, 10),
        konkurrenzNennungen: Object.values(kT).sort((a, b) => b.n - a.n).slice(0, 10),
        topQuellen: Object.entries(qT).map(([domain, n]) => ({ domain, n })).sort((a, b) => b.n - a.n).slice(0, 10),
        judge: { models: bj.models, temperature: SCORE_CFG.judge.temperature, promptType: "brand-korpus" },
      };
    }
    await sbAny.from("ai_visibility_brand_history").upsert({
      client_id: c.id, point_date: m.from, source: "korpus-backfill", provider,
      data, updated_at: new Date().toISOString(),
    }, { onConflict: "client_id,point_date,source,provider" });
    doneMonths.push(m.key);
    diag(`brand-backfill ${m.key}: ${answers.length} Antworten bewertet`);
  }

  // H3-Ausnahme: eine HEUTE aktive Halluzination, die im Korpus früher datiert,
  // ergänzt das bestehende Advisory um "seit mindestens <monat>" (kein neuer Eintrag).
  let since: string | null = null;
  try {
    const heute = new Date().toISOString().slice(0, 10);
    const { data: todayRep } = await sbAny
      .from("ai_visibility_reports").select("id, parts")
      .eq("client_id", c.id).eq("snapshot_date", heute).maybeSingle();
    const adv = (todayRep?.parts as any)?.bc?.advisory;
    if (adv?.text && /Halluzination/i.test(adv.text)) {
      const tokens = (String(adv.text).match(/[A-Za-zÄÖÜäöüß]{5,}/g) || []).map((t: string) => t.toLowerCase());
      const { data: pts } = await sbAny
        .from("ai_visibility_brand_history").select("point_date, data")
        .eq("client_id", c.id).eq("source", "korpus-backfill").order("point_date", { ascending: true });
      for (const p of pts || []) {
        const hit = ((p.data as any)?.halluzinationen || []).some((h: any) =>
          h.zitat && tokens.some((t: string) => String(h.zitat).toLowerCase().includes(t) && !["marken", "check", "antwort", "quelle", "empfehlung", "fakten", "website", "profilen", "aktualisieren", "richtigstellen", "halluzination"].includes(t)));
        if (hit) { since = String(p.point_date).slice(0, 7); break; }
      }
      if (since && adv.since !== since) {
        await sbAny.from("ai_visibility_reports").update({
          parts: { ...(todayRep.parts as any), bc: { ...(todayRep.parts as any).bc, advisory: { ...adv, since } } },
        }).eq("id", todayRep.id);
        diag(`brand-backfill: Advisory ergänzt — seit mindestens ${since}`);
      }
    }
  } catch { /* Ergänzung ist best effort */ }

  return {
    processed: doneMonths, remainingMonths: todo.length - processed, rows: rowsTotal,
    unitsEst: rowsTotal * 10 + processed * 2, errors: errors.length ? errors : undefined,
    since: since || undefined,
  };
}

// Korpus-Breite (Option B, 2026-07-20): explizit BEIDE Plattformen des
// LLM-Mentions-Korpus (chat_gpt + google) über die drei DACH-Märkte —
// vorher wurde nur CH ohne Plattform-Angabe abgefragt (dünne Treffer).
// ChatGPT-Korpus ist GLOBAL: location_name/language_code sind dort Invalid
// Field (40501, live verifiziert 2026-07-20) — deshalb EIN globaler Slice.
const DFS_CORPUS_SLICES: Array<{ platform: string; location_name?: string; language_code?: string; land: string }> = [
  { platform: "google", location_name: "Switzerland", language_code: "de", land: "Schweiz" },
  { platform: "google", location_name: "Germany", language_code: "de", land: "Deutschland" },
  { platform: "google", location_name: "Austria", language_code: "de", land: "Österreich" },
  { platform: "chat_gpt", land: "Global" },
];
// Slice-Parameter für search/live — chat_gpt darf keine Location/Sprache tragen.
const dfsSliceParams = (s: { platform: string; location_name?: string; language_code?: string }) =>
  ({ platform: s.platform, ...(s.location_name ? { location_name: s.location_name, language_code: s.language_code } : {}) });

// Korpus-Citations eines Monats: Antworten im first_response_at-Fenster, die
// die Kunden-Domain als Quelle führen -> citations (Quellen-Nennungen) +
// distinct referenzierte eigene URLs. Gemeinsamer Helfer für den Retro-
// Backfill (citations-backfill) und die Monats-Historie neuer Kunden.
async function dfsMonthCitations(domain: string, lang: string, from: string, nextStart: string): Promise<{ ok: boolean; citations: number; pages: number; error?: string }> {
  let citations = 0;
  const urls = new Set<string>();
  const errors: string[] = [];
  for (const slice of DFS_CORPUS_SLICES) {
    const r = await dfsAiCall("ai_optimization/llm_mentions/search/live", {
      target: [{ domain }],
      ...dfsSliceParams(slice), limit: 100,
      filters: [["first_response_at", ">=", `${from} 00:00:00 +00:00`], "and", ["first_response_at", "<", `${nextStart} 00:00:00 +00:00`]],
    });
    if (!r.ok) { errors.push(`${slice.platform}/${slice.land}: ${r.error}`); continue; }
    const items: any[] = (r.result?.[0]?.items ?? []) as any[];
    for (const it of items) {
      for (const s of it.sources || []) {
        const d = String(s.domain || "").replace(/^www\./, "").toLowerCase();
        if (d === domain || d.endsWith("." + domain)) {
          citations += 1;
          const u = normUrl(String(s.url || ""));
          if (u) urls.add(u);
        }
      }
    }
  }
  // Nur als Fehler werten, wenn ALLE Slices scheitern (Teilausfälle zählen weiter).
  if (errors.length >= DFS_CORPUS_SLICES.length) return { ok: false, citations: 0, pages: 0, error: errors[0] };
  return { ok: true, citations, pages: urls.size };
}

// ── citations-backfill (2026-07-19): Citations + referenzierte Seiten retro ──
// Die Monats-Historie vor dem Go-Live hatte beide Felder bewusst auf 0 (keine
// Quelle damals). Der DFS-Korpus gibt sie ~7 Monate rückwirkend her — dieser
// Job füllt NUR citations/cited_pages in BESTEHENDE Monats-Reports; Erwähnungen
// und alles andere bleiben unangetastet. Idempotent (rechnet je Lauf neu).
async function jobCitationsBackfill(c: any, sbAny: any, months: number) {
  if (!dfsAuth()) return { skipped: "DATAFORSEO-Creds fehlen" };
  const domain = cleanDomain(c.domain);
  if (!domain) return { skipped: "keine Domain" };
  const lang = (c.language || "de").slice(0, 2);
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  let updated = 0, skippedMonths = 0;
  const errors: string[] = [];
  const filled: Record<string, { citations: number; pages: number }> = {};
  for (let k = 1; k <= months; k++) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    const snapshot = iso(d);
    const nextStart = iso(new Date(now.getFullYear(), now.getMonth() - k + 1, 1));
    const { data: rep } = await sbAny
      .from("ai_visibility_reports").select("id")
      .eq("client_id", c.id).eq("snapshot_date", snapshot).maybeSingle();
    if (!rep) { skippedMonths += 1; continue; } // nur bestehende Monatspunkte füllen
    const m = await dfsMonthCitations(domain, lang, snapshot, nextStart);
    if (!m.ok) { errors.push(`${snapshot.slice(0, 7)}: ${m.error}`); continue; }
    await sbAny.from("ai_visibility_reports").update({ citations: m.citations, cited_pages: m.pages }).eq("id", rep.id);
    filled[snapshot.slice(0, 7)] = { citations: m.citations, pages: m.pages };
    updated += 1;
  }
  return { updated, skippedMonths, filled, errors: errors.length ? errors : undefined, quelle: "dataforseo-korpus (~7 Monate Tiefe)" };
}

// ── Canonry: Live-Sweeps (per-Provider cited counts) in die eine Ansicht falten ─
const CANONRY_LABEL: Record<string, string> = {
  openai: "ChatGPT", chatgpt: "ChatGPT", perplexity: "Perplexity", gemini: "Gemini",
  google: "Gemini", claude: "Claude", anthropic: "Claude", copilot: "Copilot", grok: "Grok",
};
const canonryLabel = (p: string) => CANONRY_LABEL[String(p).toLowerCase()] || (p ? p.charAt(0).toUpperCase() + p.slice(1) : "Canonry");

async function jobCanonry(c: any) {
  const baseUrl = process.env.CANONRY_BASE_URL;
  const key = process.env.CANONRY_API_KEY;
  if (!baseUrl || !key) return { skipped: "Canonry not configured" };
  if (!c.canonry_project) return { skipped: "kein canonry_project" };
  const root = normalizeCanonryBase(baseUrl);
  const p = encodeURIComponent(c.canonry_project);
  const get = async (path: string) => {
    try {
      const r = await fetch(`${root}/projects/${p}${path}`, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      });
      return r.ok ? await r.json().catch(() => null) : null;
    } catch { return null; }
  };
  const [health, sources, competitors] = await Promise.all([
    get("/health/latest"),
    get("/analytics/sources?window=all&limit=50"),
    get("/competitors"),
  ]);
  // providerBreakdown = { provider: { cited, total, citedRate } } -> Modelle (layer canonry).
  const pb = (health as any)?.providerBreakdown || {};
  const models = Object.entries(pb).map(([prov, e]: any) => ({
    name: canonryLabel(prov), mentions: Number(e?.cited ?? 0), byCountry: {} as Record<string, number>,
  })).filter((m) => m.mentions > 0);
  // Quellen (best-effort — Canonry-Shape defensiv).
  const srcArr: any[] = Array.isArray(sources) ? sources : ((sources as any)?.sources || (sources as any)?.data || []);
  const srcRows = (Array.isArray(srcArr) ? srcArr : []).map((s: any) => ({
    domain: String(s?.domain || s?.host || domOf(s?.url || "") || "").replace(/^www\./, ""),
    mentions: Number(s?.cited ?? s?.count ?? s?.citations ?? s?.mentions ?? 0),
  }))
    // Wrapper-Audit (Score v2): Canonry liefert nur Domains (keine URL zum
    // Aufloesen) — Wrapper-Hosts werden verworfen statt als Quelle gezaehlt.
    .filter((s: any) => s.domain && !WRAPPER_HOSTS.some((w) => s.domain === w || s.domain.endsWith("." + w)))
    .slice(0, 15);
  // Konkurrenten (best-effort).
  const compArr: any[] = Array.isArray(competitors) ? competitors : ((competitors as any)?.competitors || (competitors as any)?.data || []);
  const comps = (Array.isArray(compArr) ? compArr : [])
    .map((x: any) => String(x?.name || x?.brand || x?.domain || x || "").replace(/^www\./, "").replace(/\.[a-z.]+$/i, ""))
    .filter(Boolean).map((s: string) => s.charAt(0).toUpperCase() + s.slice(1)).slice(0, 12);
  return { models, sources: srcRows, competitors: comps, mentions: models.reduce((a, m) => a + m.mentions, 0) };
}

// ── Backfill: rückwirkende Makro-Historie (Ahrefs) + GA4-Attribution ─────────
// Erzeugt je Monat einen rückdatierten Report, damit Trend-Kurve + Deltas sofort
// gefüllt sind. NICHT backfillbar: Custom-Layer (Prompts/SoV/Sentiment) — die
// wachsen ab jetzt vorwärts.
async function jobBackfill(c: any, sb: any, months: number) {
  if (!dfsAuth() && !c.ga4_property) return { skipped: "weder DataForSEO-Creds noch GA4" };
  const brand = brandName(c);
  const now = new Date();
  const mk = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  // Die letzten `months` ABGESCHLOSSENEN Monate (ohne den aktuellen).
  const monthsList: Array<{ y: number; m: number; key: string }> = [];
  for (let k = months; k >= 1; k--) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    monthsList.push({ y: d.getFullYear(), m: d.getMonth(), key: mk(d) });
  }
  const dateFrom = `${monthsList[0].key}-01`;
  const dateTo = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10); // letzter Tag Vormonat

  // Erwähnungs-Historie je Monat — seit 2026-07-19 aus dem DataForSEO-LLM-
  // Mentions-Korpus (Ahrefs raus aus der KI-Sichtbarkeit, Entscheid im Chat).
  // Tiefe des CH-Korpus: ~7 Monate (aeltere Monate bleiben 0); ein search-Call
  // je Monat, gezaehlt wird ueber first_response_at-Fenster.
  const byMonth: Record<string, number> = {};
  {
    const excludes = mentionExcludes(brand);
    const targets = mentionTargets(brand).map((k) => ({ keyword: k, match_type: "word_match", search_scope: ["answer"] }));
    for (const mo of monthsList) {
      const from = `${mo.key}-01 00:00:00 +00:00`;
      const nextM = new Date(mo.y, mo.m + 1, 1).toISOString().slice(0, 10);
      let n = 0;
      // Option B (2026-07-20): DACH-Märkte statt nur CH — aber NUR google:
      // der globale ChatGPT-Korpus trifft bei Wortmarken die Phrase
      // (Generika-Falle "faith in humanity"/"Benedict") und würde die
      // Erwähnungs-Historie verfälschen.
      for (const slice of DFS_CORPUS_SLICES.filter((s) => s.platform === "google")) {
        const monthFilters = [["first_response_at", ">=", from], "and", ["first_response_at", "<", `${nextM} 00:00:00 +00:00`]];
        const r = await dfsAiCall("ai_optimization/llm_mentions/search/live", {
          target: targets,
          ...dfsSliceParams(slice), limit: 100,
          filters: monthFilters,
        });
        if (!r.ok) continue; // Slice fällt aus — Rest zählt weiter
        let sliceN = ((r.result?.[0]?.items ?? []) as any[]).length;
        // Generika-Abzug analog br-Schicht (z.B. "Eggs Benedict").
        for (const phrase of excludes) {
          const ex = await dfsAiCall("ai_optimization/llm_mentions/search/live", {
            target: [{ keyword: phrase, match_type: "word_match", search_scope: ["answer"] }],
            ...dfsSliceParams(slice), limit: 100,
            filters: monthFilters,
          });
          if (ex.ok) sliceN = Math.max(0, sliceN - ((ex.result?.[0]?.items ?? []) as any[]).length);
        }
        n += sliceN;
      }
      byMonth[mo.key] = n; // Korpus-Tiefe ~7 Monate — ältere Monate bleiben 0
    }
  }

  let ga4Token: string | null = null;
  if (c.ga4_property) { try { ga4Token = (await getGoogleAccessToken(c.id)).accessToken; } catch { /* ohne Attribution */ } }

  let written = 0, prevMentions = 0, prevScore = 0;
  for (const mo of monthsList) {
    const mentions = byMonth[mo.key] ?? 0;
    const snapshot = `${mo.key}-01`;
    // Citations + referenzierte Seiten desselben Monats aus dem Korpus
    // (2026-07-19: vorher hart 0 — Lücke, die im Trend als Null-Linie stand).
    const nextStart = new Date(mo.y, mo.m + 1, 1).toISOString().slice(0, 10);
    const cit = await dfsMonthCitations(cleanDomain(c.domain), (c.language || "de").slice(0, 2), snapshot, nextStart).catch(() => ({ ok: false, citations: 0, pages: 0 }));
    // Score (nur historisch verfügbare Terme: Mentions + Korpus-Citations/Seiten).
    const score = Math.min(100, Math.round(scoreV2Terms(sat, mentions, cit.citations, cit.pages, 0, 0)));
    const scoreRaw = Math.round(scoreV2Terms(satRaw, mentions, cit.citations, cit.pages, 0, 0) * 10) / 10;
    const { data: rep, error } = await sb
      .from("ai_visibility_reports")
      .upsert({
        client_id: c.id, market: c.country || null, snapshot_date: snapshot,
        score, score_delta: score - prevScore, score_raw: scoreRaw, measurement_version: MEASUREMENT_VERSION,
        mentions, mentions_delta: mentions - prevMentions,
        citations: cit.citations, citations_delta: 0, cited_pages: cit.pages, cited_pages_delta: 0,
      }, { onConflict: "client_id,snapshot_date" })
      .select("id").single();
    if (error || !rep) continue;
    prevMentions = mentions; prevScore = score; written++;

    // GA4-Attribution für diesen Monat.
    if (ga4Token) {
      const propertyId = String(c.ga4_property).replace(/^properties\//, "");
      const end = new Date(mo.y, mo.m + 1, 0).toISOString().slice(0, 10);
      try {
        const resp = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`, {
          method: "POST",
          headers: { Authorization: `Bearer ${ga4Token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ dateRanges: [{ startDate: `${mo.key}-01`, endDate: end }], dimensions: [{ name: "sessionSource" }], metrics: [{ name: "sessions" }, { name: "keyEvents" }], limit: 250 }),
          signal: AbortSignal.timeout(30_000),
        });
        if (resp.ok) {
          const jr: any = await resp.json().catch(() => ({}));
          const agg: Record<string, { sessions: number; conversions: number }> = {};
          for (const row of jr.rows ?? []) {
            const src = String(row.dimensionValues?.[0]?.value ?? "");
            const eng = ENGINES.find((e) => e.re.test(src));
            if (!eng) continue;
            agg[eng.name] ??= { sessions: 0, conversions: 0 };
            agg[eng.name].sessions += Number(row.metricValues?.[0]?.value ?? 0);
            agg[eng.name].conversions += Number(row.metricValues?.[1]?.value ?? 0);
          }
          await sb.from("ai_visibility_attribution").delete().eq("report_id", rep.id);
          const ins = Object.entries(agg).map(([engine, v]) => ({ report_id: rep.id, client_id: c.id, engine, sessions: v.sessions, conversions: v.conversions }));
          if (ins.length) await sb.from("ai_visibility_attribution").insert(ins);
        }
      } catch { /* Attribution optional */ }
    }
  }
  return { months: written, ahrefs: Object.keys(byMonth).length, ga4: !!ga4Token };
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
        const { client: sel, all, jobs, minIntervalDays, force, mode, months, serpKeywords, async: runAsync, promptOffset, promptTarget, backfillProvider, engines: engineFilter } = parsed.data;
        const wanted = jobs && jobs.length ? jobs : (["brand_radar", "attribution", "prompts", "canonry", "serp_ai"] as const);

        const query = supabaseAdmin
          .from("clients")
          .select("id, name, domain, organization_id, ga4_property, gsc_property, country, canonry_project, brand_terms, language");
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

        // async:true -> Run-Zeile anlegen und IM SELBEN Request weiterarbeiten.
        // Der Aufrufer trennt nach wenigen Sekunden (Server arbeitet nachweislich
        // weiter, 2026-07-13 verifiziert) und pollt GET ?run=<id>. Die runId kann
        // der Aufrufer via Header x-sync-run mitgeben (damit er sie VOR der
        // Trennung kennt); ohne Header wird eine erzeugt (nur für geduldige
        // Aufrufer sinnvoll, die die Antwort abwarten).
        // Hintergrund: Sowohl fire-and-forget als auch Selbst-Aufruf werden vom
        // Hosting nach der Response eingefroren (beide 2026-07-14 verifiziert
        // fehlgeschlagen) — nur die Ein-Request-Variante ist zuverlässig.
        const headerRunId = (request.headers.get("x-sync-run") || "").trim();
        if (headerRunId && !isUuid(headerRunId))
          return Response.json({ ok: false, error: "x-sync-run muss eine UUID sein" }, { status: 400 });
        const syncRunId = headerRunId || (runAsync ? crypto.randomUUID() : "");
        if (syncRunId) {
          await sb.from("ai_visibility_sync_runs").upsert({
            id: syncRunId, status: "running",
            clients: clients.map((x) => String(x.name)),
            params: { client: sel ?? null, all: !!all, jobs: jobs ?? null, mode, months, force: !!force, minIntervalDays, serpKeywords: serpKeywords ?? null },
          });
        }
        diagLog = [];
        // .then() erzwingt die Ausfuehrung: Supabase-Builder sind lazy und
        // laufen NUR bei await/.then — ein blosses void feuert nie.
        diagWrite = syncRunId
          ? (log) => { sb.from("ai_visibility_sync_runs").update({ result: { phases: log } }).eq("id", syncRunId).then(() => {}, () => {}); }
          : null;

        // Kernverarbeitung — synchron aufgerufen ODER als Hintergrund-Lauf (async:true).
        const runAll = async () => {
        for (const c of clients) {
          const jr: Record<string, unknown> = {};
          try {
            // Gate: nur Kunden, bei denen KI-Sichtbarkeit aktiv ist (aivis-Tab =
            // canonry ODER perplexity in client_integrations = "in den Einstellungen").
            const allowed = await aivisAllowed(sb, c.id);
            if (!allowed.ok) {
              results.push({ client: c.name, skipped: allowed.grund });
              continue;
            }
            // Backfill-Modus: rückwirkende Monats-Reports (Ahrefs/GA4), dann fertig.
            if (mode === "backfill") {
              jr.backfill = await jobBackfill(c, sb, months);
              await flushCost(sb);
              results.push({ client: c.name, domain: c.domain, jobs: jr });
              continue;
            }
            // Citations/Seiten-Retro (nur bestehende Monats-Reports), dann fertig.
            if (mode === "citations-backfill") {
              jr.citationsBackfill = await withDeadline(jobCitationsBackfill(c, sb, months), 8 * 60_000, "citations-backfill")
                .catch((e) => ({ skipped: String((e as any)?.message || e).slice(0, 160) }));
              await flushCost(sb);
              results.push({ client: c.name, domain: c.domain, jobs: jr });
              continue;
            }
            // Marken-Check-Korpus-Backfill (H2): on-demand, etappenweise, dann fertig.
            if (mode === "brand-backfill") {
              jr.brandBackfill = await withDeadline(jobBrandBackfill(c, sb, months, backfillProvider), 12 * 60_000, "brand-backfill")
                .catch((e) => ({ skipped: String((e as any)?.message || e).slice(0, 160) }));
              await flushCost(sb);
              results.push({ client: c.name, domain: c.domain, jobs: jr });
              continue;
            }
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

            // Konkurrentenliste (Fixliste, editierbar) + Semrush-Organik -> beide Layer.
            diag(`${c.name}: Gate ok, lade Konkurrenten`);
            const db = semrushDb(c.country);
            const { data: compRows } = await sb
              .from("ai_visibility_competitors").select("name").eq("client_id", c.id).eq("active", true);
            const semrushComps = await semrushCompetitors(cleanDomain(c.domain), db);
            diag(`${c.name}: semrush ok (${semrushComps.length})`);
            const ca: any = wanted.includes("canonry") ? await jobCanonry(c) : null;
            const hasCa = ca && !ca.skipped;
            const canonryComps: string[] = hasCa ? ca.competitors : [];
            const newComps = [
              ...semrushComps.map((n) => ({ client_id: c.id, name: n, source: "semrush", active: true })),
              ...canonryComps.map((n) => ({ client_id: c.id, name: n, source: "canonry", active: true })),
            ];
            if (newComps.length)
              await sb.from("ai_visibility_competitors").upsert(newComps, { onConflict: "client_id,name", ignoreDuplicates: true });
            const fixedComps: string[] = [...new Set([...(compRows || []).map((r: any) => String(r.name)), ...semrushComps, ...canonryComps])].filter(Boolean);

            // Job-Level-Deadlines (wie serp_ai): kein Job darf den Lauf endlos halten.
            const br: any = wanted.includes("brand_radar")
              ? await withDeadline(jobBrandRadarDfs(c, fixedComps), 6 * 60_000, "brand_radar").catch((e) => ({ skipped: String((e as any)?.message || e).slice(0, 160) }))
              : null;
            const at: any = wanted.includes("attribution")
              ? await withDeadline(jobAttribution(c), 5 * 60_000, "attribution").catch((e) => ({ skipped: String((e as any)?.message || e).slice(0, 160) }))
              : null;
            diag(`${c.name}: starte prompts-Job`);
            const pr: any = wanted.includes("prompts")
              ? await withDeadline(jobPromptRunner(c, sb, fixedComps, { offset: promptOffset, target: promptTarget, snapshot, engines: engineFilter }), 20 * 60_000, "prompts").catch((e) => ({ skipped: String((e as any)?.message || e).slice(0, 160) }))
              : null;
            diag(`${c.name}: prompts-Job fertig (${pr?.skipped ? "skipped: " + pr.skipped : "answered " + pr?.answered})`);
            await flushCost(sb); // LLM-Token-Kosten dieses Laufs persistieren
            const sa: any = wanted.includes("serp_ai")
              ? await withDeadline(jobSerpAi(c, serpKeywords), 25 * 60_000, "serp_ai").catch((e) => ({ skipped: String((e as any)?.message || e).slice(0, 160) }))
              : null;
            jr.serp_ai = sa
              ? (sa.skipped
                  ? { skipped: sa.skipped }
                  : { keywords: sa.keywords, aiOverview: sa.aio, aiMode: sa.aim, citations: sa.citations || 0, citedPages: sa.citedPages?.length || 0, errors: sa.errors?.length || 0 })
              : "skipped";
            jr.brand_radar = br ? (br.skipped ? { skipped: br.skipped } : { mentions: br.mentions, citations: br.citations, pages: br.citedPagesCount, errors: br.errors?.length || 0 }) : "skipped";
            jr.attribution = at ? (at.skipped || at.error ? at : { engines: at.engines.length }) : "skipped";
            jr.prompts = pr ? (pr.skipped ? { skipped: pr.skipped, seeded: pr.seeded } : { answered: pr.answered, byEngine: pr.byEngine, engineErrors: pr.engineErrors, mentions: pr.mentions, seeded: pr.seeded, topics: pr.topics?.length, selfShare: pr.selfShare, sov: pr.sov?.length, judged: pr.judged, learned: pr.learnedComps?.length, next: pr.chunk?.next ?? null, total: pr.chunk?.total ?? null, partial: !!pr.partial, brand: pr.brandCheck ? { answered: pr.brandCheck.answered, faktentreueQuote: pr.brandCheck.faktentreueQuote, advisory: !!pr.brandCheck.advisory } : null }) : "skipped";
            jr.canonry = ca ? (ca.skipped ? { skipped: ca.skipped } : { models: ca.models.length, mentions: ca.mentions, sources: ca.sources.length }) : "skipped";
            jr.semrush = { keyPresent: !!process.env.SEMRUSH_API_KEY, competitors: semrushComps.length, volumesFilled: 0 };

            const hasBr = br && !br.skipped;
            const hasPr = pr && !pr.skipped && pr.promptRows?.length;
            // Teil-Häppchen (Chunking): Zeilen anhängen, aber Aggregate
            // (Themen/SoV/Quellen/parts.pr) erst im letzten Häppchen schreiben.
            const prPartial = !!(hasPr && pr.partial);
            const hasSa = sa && !sa.skipped;
            if (hasBr || hasPr || hasCa || hasSa) {
              // MERGE-MODELL (2026-07-14): Jeder Lauf legt seinen Beitrag in
              // reports.parts (jsonb) ab; Totale + Modell-Zeilen werden aus den
              // GEMERGTEN Parts neu aufgebaut. Teil-Laeufe ergaenzen sich damit,
              // statt sich gegenseitig zu ueberschreiben (ersetzt den frueheren
              // Teil-Lauf-Guard vollstaendig).
              const { data: existingRep } = await sb
                .from("ai_visibility_reports")
                .select("id, parts")
                .eq("client_id", c.id)
                .eq("snapshot_date", snapshot)
                .maybeSingle();
              const newParts: any = {};
              // S3: normalisierte URL-Listen je Schicht mitschreiben (Dedupe-Basis).
              if (hasBr) newParts.br = {
                mentions: br.mentions, citations: br.citations, pages: br.citedPagesCount, models: br.models,
                urls: [...new Set((br.citedPages || []).map((p: any) => normUrl(p.url)).filter(Boolean))].slice(0, 300),
              };
              if (hasCa) newParts.ca = { mentions: ca.mentions, models: ca.models };
              if (hasSa) newParts.sa = {
                mentions: sa.mentions, citations: Number(sa.citations || 0), pages: sa.citedPages?.length || 0, models: sa.models,
                // Query-Fanout light (03.08.): Google-Folgefragen je Keyword (PAA/related).
                ...(Array.isArray(sa.fanout) && sa.fanout.length ? { fanout: sa.fanout.slice(0, 200) } : {}),
                urls: [...new Set((sa.citedPages || []).map((u: any) => normUrl(u)).filter(Boolean))].slice(0, 300),
                // AIO/AI-Mode-Detail (06.08., für die Erwähnungen-Karte): WELCHE
                // Suchanfragen zitieren den Kunden — bisher nur im Lauf-Response.
                ...(sa.aio ? { aio: { checked: sa.aio.checked, present: sa.aio.present, cited: sa.aio.cited, citations: sa.aio.citations, keywords: (sa.aio.keywords || []).slice(0, 150) } } : {}),
                ...(sa.aim ? { aim: { checked: sa.aim.checked, present: sa.aim.present, cited: sa.aim.cited, citations: sa.aim.citations, keywords: (sa.aim.keywords || []).slice(0, 150) } } : {}),
                gemessenAm: snapshot, // echtes Messdatum (SERP-Drosselung)
              };
              if (hasPr && !prPartial) newParts.pr = {
                mentions: pr.mentions, selfShare: pr.selfShare ?? 0, posQ: pr.positionQuality ?? 0, models: pr.customModels,
                judge: {
                  models: pr.judgeModels || [], temperature: SCORE_CFG.judge.temperature,
                  ...(pr.judgeCalibration ? { calibration: pr.judgeCalibration } : {}),
                },
              };
              // Marken-Check (E3): eigenes parts-Objekt, fliesst NICHT in den
              // Score. advisory: Tages-Duplikatschutz — der erste Befund des
              // Tages bleibt stehen, spätere Läufe überschreiben ihn nicht.
              if (hasPr && !prPartial && pr.brandCheck) {
                const prevAdvisory = (existingRep?.parts as any)?.bc?.advisory;
                newParts.bc = {
                  ...pr.brandCheck,
                  ...(prevAdvisory && prevAdvisory.date === snapshot ? { advisory: prevAdvisory } : {}),
                };
              }
              const parts: any = { ...((existingRep?.parts as any) || {}), ...newParts };
              if (Object.keys(parts).length > Object.keys(newParts).length)
                jr.note = `Merge: bestehende Anteile bewahrt (${Object.keys(parts).filter((k) => !newParts[k]).join(",")})`;
              // SERP-Drosselung (2026-07-21): läuft an diesem Tag kein SERP-
              // Check, übernimmt der Tagesreport den letzten sa-Stand
              // (Score-Kontinuität); gemessenAm bleibt das echte Messdatum.
              if (!parts.sa) {
                const { data: prevSaRep } = await sb
                  .from("ai_visibility_reports").select("snapshot_date, parts")
                  .eq("client_id", c.id).lt("snapshot_date", snapshot)
                  .not("parts->sa", "is", null)
                  .order("snapshot_date", { ascending: false }).limit(1).maybeSingle();
                const ps = (prevSaRep?.parts as any)?.sa;
                if (ps) parts.sa = { ...ps, gemessenAm: ps.gemessenAm || String(prevSaRep.snapshot_date), uebernommen: true };
              }

              const mentions = ["br", "ca", "sa", "pr"].reduce((a, k) => a + Number(parts[k]?.mentions || 0), 0);
              // S3-Dedupe: Ahrefs enthält AI Overviews, der eigene sa-Check misst
              // AI Overviews — dieselbe (normalisierte) URL wird für die SCORE-
              // Summe nur 1x gezählt. Rohwerte je Schicht bleiben in parts erhalten.
              const brUrls: string[] | null = Array.isArray(parts.br?.urls) ? parts.br.urls : null;
              const saUrls: string[] | null = Array.isArray(parts.sa?.urls) ? parts.sa.urls : null;
              let citations = Number(parts.br?.citations || 0) + Number(parts.sa?.citations || 0);
              let citedPagesCount = Number(parts.br?.pages || 0) + Number(parts.sa?.pages || 0);
              if (brUrls && saUrls) {
                const brSet = new Set(brUrls);
                const saUnique = saUrls.filter((u) => !brSet.has(u));
                citedPagesCount = new Set([...brUrls, ...saUrls]).size;
                // sa-Zitierungen liegen nicht je URL vor -> anteilig über den
                // Anteil der sa-URLs, die nicht schon im br-Korpus stehen.
                const saShare = saUrls.length ? saUnique.length / saUrls.length : 1;
                citations = Number(parts.br?.citations || 0) + Math.round(Number(parts.sa?.citations || 0) * saShare);
              }
              const selfShare = Number(parts.pr?.selfShare || 0); // 0..100
              const posQ = Number(parts.pr?.posQ || 0); // 0..100

              // S4-Glättung: rollierender Durchschnitt über die letzten
              // smoothing.windowRuns pr-Läufe DERSELBEN Mess-Version.
              let sovSmooth = selfShare, posQSmooth = posQ;
              if (parts.pr) {
                const { data: prevPr } = await sb
                  .from("ai_visibility_reports")
                  .select("parts")
                  .eq("client_id", c.id)
                  .eq("measurement_version", MEASUREMENT_VERSION)
                  .lt("snapshot_date", snapshot)
                  .not("parts->pr", "is", null)
                  .order("snapshot_date", { ascending: false })
                  .limit(Math.max(0, SCORE_CFG.smoothing.windowRuns - 1));
                const sovVals = [selfShare, ...(prevPr || []).map((x: any) => Number(x.parts?.pr?.selfShare || 0))];
                const posVals = [posQ, ...(prevPr || []).map((x: any) => Number(x.parts?.pr?.posQ || 0))];
                sovSmooth = sovVals.reduce((a, b) => a + b, 0) / sovVals.length;
                posQSmooth = posVals.reduce((a, b) => a + b, 0) / posVals.length;
                parts.pr.sovSmooth = Math.round(sovSmooth * 10) / 10;
                parts.pr.posQSmooth = Math.round(posQSmooth * 10) / 10;
              }

              // S2: Deltas NUR gegen den letzten Snapshot DERSELBEN Mess-Version.
              const { data: prev } = await sb
                .from("ai_visibility_reports")
                .select("mentions, citations, cited_pages, score, measurement_version")
                .eq("client_id", c.id)
                .eq("measurement_version", MEASUREMENT_VERSION)
                .lt("snapshot_date", snapshot)
                .order("snapshot_date", { ascending: false })
                .limit(1)
                .maybeSingle();
              let versionSwitch = false;
              if (!prev) {
                const { data: anyPrev } = await sb
                  .from("ai_visibility_reports").select("id")
                  .eq("client_id", c.id).lt("snapshot_date", snapshot).limit(1).maybeSingle();
                versionSwitch = !!anyPrev; // Historie da, aber andere Version -> Delta-Sperre + UI-Marker
              }
              if (versionSwitch) parts.meta = { ...(parts.meta || {}), versionSwitch: snapshot };

              // S1: Score v2 — Sättigung statt harter Deckel; scoreRaw ungedeckelt.
              const scoreV2 = scoreV2Terms(sat, mentions, citations, citedPagesCount, sovSmooth, posQSmooth);
              const scoreRaw = scoreV2Terms(satRaw, mentions, citations, citedPagesCount, sovSmooth, posQSmooth);
              const score = Math.min(100, Math.round(scoreV2));
              const { data: rep, error: repErr } = await sb
                .from("ai_visibility_reports")
                .upsert(
                  {
                    client_id: c.id,
                    market: c.country || null,
                    snapshot_date: snapshot,
                    score,
                    score_raw: Math.round(scoreRaw * 10) / 10,
                    measurement_version: MEASUREMENT_VERSION,
                    score_delta: versionSwitch ? null : score - Number(prev?.score ?? 0),
                    mentions,
                    mentions_delta: versionSwitch ? null : mentions - Number(prev?.mentions ?? 0),
                    citations,
                    citations_delta: versionSwitch ? null : citations - Number(prev?.citations ?? 0),
                    cited_pages: citedPagesCount,
                    cited_pages_delta: versionSwitch ? null : citedPagesCount - Number(prev?.cited_pages ?? 0),
                    parts,
                  },
                  { onConflict: "client_id,snapshot_date" },
                )
                .select("id")
                .single();
              if (repErr) throw new Error(repErr.message);
              const reportId: string = rep.id;

              // H1: Marken-Check-Historie — jeder Lauf ein Zeitreihen-Punkt.
              // Merge-Modell: Teilläufe desselben Tages upserten denselben
              // Tagespunkt (Aggregat läuft ohnehin über alle Tageszeilen).
              // Quelle "eigene-prompts" — NIE mit Korpus-Backfill mischen (H3).
              if (hasPr && !prPartial && pr.brandCheck) {
                await sb.from("ai_visibility_brand_history").upsert({
                  client_id: c.id,
                  point_date: snapshot,
                  source: "eigene-prompts",
                  provider: "",
                  data: {
                    faktentreueQuote: pr.brandCheck.faktentreueQuote,
                    faktentreueVerteilung: pr.brandCheck.faktentreueVerteilung,
                    tonalitaetsVerteilung: pr.brandCheck.tonalitaetsVerteilung,
                    halluzinationen: pr.brandCheck.halluzinationen,
                    konkurrenzNennungen: pr.brandCheck.konkurrenzNennungen,
                    topQuellen: pr.brandCheck.topQuellen,
                    answered: pr.brandCheck.answered,
                    judge: pr.brandCheck.judge,
                  },
                  updated_at: new Date().toISOString(),
                }, { onConflict: "client_id,point_date,source,provider" });
              }

              // Modelle: IMMER aus den gemergten Parts neu aufbauen, per Modell-
              // NAME zusammengeführt (Summe der Mentions) -> keine Doppel-Zeilen.
              // Custom-Modelle (06.08. Bugfix Studioforma): aus der Prompt-Tabelle
              // aggregieren statt aus parts.pr.models — letzteres enthält nur die
              // im aktuellen Lauf geprüften Engines und überschreibt die anderen.
              const { data: dbCustom } = await sb
                .from("ai_visibility_prompts")
                .select("platform, status")
                .eq("report_id", reportId)
                .eq("is_opportunity", false)
                .neq("prompt_type", "brand");
              const dbCustomAgg: Record<string, number> = {};
              for (const p of dbCustom || []) {
                if (p.status && p.status !== "Nicht erwähnt") dbCustomAgg[p.platform] = (dbCustomAgg[p.platform] || 0) + 1;
              }
              const dbCustomModels = Object.entries(dbCustomAgg).map(([name, mentions]) => ({ name, mentions, byCountry: {} }));
              await sb.from("ai_visibility_models").delete().eq("report_id", reportId);
              const rawModels = [
                ...((parts.br?.models || []).map((m: any) => ({ ...m, layer: "macro" }))),
                ...((parts.ca?.models || []).map((m: any) => ({ ...m, layer: "macro" }))), // Canonry = Makro-Quelle
                ...((parts.sa?.models || []).map((m: any) => ({ ...m, layer: "macro" }))), // eigener AI-Overview/AI-Mode-Check
                ...(dbCustomModels.map((m: any) => ({ ...m, layer: "custom" }))), // aus DB statt parts.pr
              ];
              const modelAgg: Record<string, { mentions: number; byCountry: Record<string, number>; layers: Set<string> }> = {};
              for (const m of rawModels) {
                const a = (modelAgg[m.name] ??= { mentions: 0, byCountry: {}, layers: new Set<string>() });
                a.mentions += Number(m.mentions || 0);
                a.layers.add(m.layer);
                for (const [ct, v] of Object.entries(m.byCountry || {})) a.byCountry[ct] = (a.byCountry[ct] || 0) + Number(v);
              }
              const allModels = Object.entries(modelAgg).map(([name, a]) => ({
                name,
                layer: a.layers.has("custom") ? "custom" : "macro",
                mentions: a.mentions,
                byCountry: a.byCountry,
              }));
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

              // Kind-Tabellen JOB-SCOPED ersetzen: jeder Job raeumt nur seine
              // eigenen Zeilen ab — fremde Anteile bleiben stehen (Merge).
              if (hasCa) {
                await sb.from("ai_visibility_sources").delete().eq("report_id", reportId).eq("layer", "canonry");
                if (ca.sources?.length)
                  await sb.from("ai_visibility_sources").insert(
                    ca.sources.map((s: any) => ({ report_id: reportId, client_id: c.id, domain: s.domain, mentions: s.mentions, share: 0, urls: 0, traffic: 0, layer: "canonry" })),
                  );
              }

              // Prompts + Themen + SoV + Quellen + Auto-Learning (Custom-Layer).
              if (hasPr) {
                // Chunking: nur das ERSTE Häppchen (offset 0 bzw. ungechunkt)
                // räumt die alten Zeilen ab; Folge-Häppchen hängen an. Vor dem
                // Anhängen die eigene Slice löschen (Wiederholungs-Idempotenz).
                const isFirstChunk = !pr.chunk || pr.chunk.offset === 0;
                if (Array.isArray(pr.engineFilter) && pr.engineFilter.length) {
                  // Engine-Nachzieh-Modus: NUR die Zeilen der gefilterten Engines
                  // ersetzen — Antworten der übrigen Engines bleiben stehen.
                  const slicePrompts = [...new Set(pr.promptRows.map((p: any) => String(p.prompt)))];
                  await sb.from("ai_visibility_prompts").delete().eq("report_id", reportId).in("platform", pr.engineFilter).in("prompt", slicePrompts);
                } else if (isFirstChunk) {
                  await sb.from("ai_visibility_prompts").delete().eq("report_id", reportId);
                } else {
                  const slicePrompts = [...new Set(pr.promptRows.map((p: any) => String(p.prompt)))];
                  await sb.from("ai_visibility_prompts").delete().eq("report_id", reportId).in("prompt", slicePrompts);
                }
                if (!prPartial) {
                  await sb.from("ai_visibility_topics").delete().eq("report_id", reportId);
                  await sb.from("ai_visibility_sov").delete().eq("report_id", reportId);
                  await sb.from("ai_visibility_sources").delete().eq("report_id", reportId).eq("layer", "custom");
                }
                // Blockweise einfügen — bei vielen Prompts × Engines bleibt
                // der einzelne Request sonst zu groß.
                const promptInserts = pr.promptRows.map((p: any) => ({ ...p, report_id: reportId, client_id: c.id }));
                for (let off = 0; off < promptInserts.length; off += 500)
                  await sb.from("ai_visibility_prompts").insert(promptInserts.slice(off, off + 500));
                diag(`${c.name}: prompt-Zeilen geschrieben (${promptInserts.length}${pr.chunk ? `, Häppchen ab ${pr.chunk.offset}` : ""})`);
                // AI-Suchvolumen in die Themen (seit 2026-07-19 DataForSEO
                // AI Keyword Data statt Semrush): misst, wie oft solche Fragen
                // tatsächlich an KI-Tools gehen — EIN Call für alle Themen.
                // AI-Suchvolumen (2026-07-21 überarbeitet): Themen-Labels sind
                // LLM-Kurzbezeichnungen ("Agriturismo vs Landhotel") — dafür
                // kennt DataForSEO praktisch nie ein Volumen (live belegt).
                // Deshalb: ECHTE Kunden-Keywords (GSC) abfragen und einem Thema
                // per Wort-Überlappung zuordnen; ohne Datenlage bleibt volume
                // NULL ("–" im UI) statt 0 ("keine Nachfrage").
                if (!prPartial && pr.topics?.length) {
                  const gscPairs = await gscTopQueryCountryPairs(c, 200).catch(() => []);
                  const gscKws = [...new Set(gscPairs.map((p: any) => String(p.kw).toLowerCase().trim()))].slice(0, 150);
                  const kandidaten = [...new Set([
                    ...pr.topics.map((t: any) => String(t.topic).slice(0, 80).toLowerCase().trim()),
                    ...gscKws,
                  ])].filter(Boolean).slice(0, 400);
                  const vr = await withDeadline(
                    dfsAiCall("ai_optimization/ai_keyword_data/keywords_search_volume/live", {
                      keywords: kandidaten,
                      language_code: (c.language || "de").slice(0, 2),
                      location_name: "Switzerland",
                    }),
                    60_000,
                    "ai-volumes",
                  ).catch(() => null);
                  const items: any[] = (vr && (vr as any).ok ? ((vr as any).result?.[0]?.items ?? []) : []) as any[];
                  // Nur Keywords MIT Datenlage; alles andere bleibt unbekannt.
                  const treffer = items
                    .filter((i: any) => Number(i.ai_search_volume || 0) > 0)
                    .map((i: any) => ({ kw: String(i.keyword || "").toLowerCase(), vol: Number(i.ai_search_volume) }));
                  const volByKw = new Map(treffer.map((t) => [t.kw, t.vol]));
                  const wortSet = (s: string) => new Set(String(s).toLowerCase().match(/[\p{L}\d]{3,}/gu) || []);
                  let vf = 0;
                  pr.topics.forEach((t: any) => {
                    const label = String(t.topic).slice(0, 80).toLowerCase();
                    let vol = volByKw.get(label) ?? null;
                    if (vol == null) {
                      // Bestes passendes Kunden-Keyword: alle Keyword-Wörter
                      // müssen im Thema vorkommen; bei mehreren gewinnt das
                      // spezifischste (meiste Wörter), dann das grösste Volumen.
                      const tw = wortSet(label);
                      let best: { n: number; vol: number } | null = null;
                      for (const cand of treffer) {
                        const cw = [...wortSet(cand.kw)];
                        if (!cw.length || !cw.every((w) => tw.has(w))) continue;
                        if (!best || cw.length > best.n || (cw.length === best.n && cand.vol > best.vol)) best = { n: cw.length, vol: cand.vol };
                      }
                      vol = best ? best.vol : null;
                    }
                    t.volume = vol; // null = keine Daten (UI zeigt "–")
                    if (vol != null) vf++;
                  });
                  (jr.semrush as any).volumesFilled = vf;
                  (jr.semrush as any).quelle = "dataforseo-ai (Themen + GSC-Keywords)";
                  diag(`${c.name}: AI-Volumina ${vf}/${pr.topics.length} Themen (aus ${treffer.length} Keywords mit Daten)`);
                }
                if (pr.topics?.length && !prPartial)
                  await sb.from("ai_visibility_topics").insert(
                    pr.topics.map((t: any) => ({ ...t, report_id: reportId, client_id: c.id })),
                  );
                // C) Share-of-Voice
                if (pr.sov?.length && !prPartial)
                  await sb.from("ai_visibility_sov").insert(
                    pr.sov.map((s: any) => ({ report_id: reportId, client_id: c.id, brand: s.brand, is_self: s.is_self, mentions: s.mentions, share: s.share })),
                  );
                // E) Quellen aus den Antworten (Custom-Layer)
                if (pr.customSources?.length && !prPartial)
                  await sb.from("ai_visibility_sources").insert(
                    pr.customSources.map((s: any) => ({ report_id: reportId, client_id: c.id, domain: s.domain, mentions: s.mentions, share: 0, urls: 0, traffic: 0, layer: "custom" })),
                  );
                // Auto-Learning: neue Konkurrenten in die Fixliste (source='auto').
                if (pr.learnedComps?.length && !prPartial)
                  await sb.from("ai_visibility_competitors").upsert(
                    pr.learnedComps.map((n: string) => ({ client_id: c.id, name: n, source: "auto", active: true })),
                    { onConflict: "client_id,name", ignoreDuplicates: true },
                  );
              }

              if (hasBr) {
                await sb.from("ai_visibility_sources").delete().eq("report_id", reportId).is("layer", null);
                if (br.citedPages?.length) {
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
              }
              jr.report = { id: reportId, score, snapshot };
            }
            // Attribution UNABHÄNGIG vom Report-Block schreiben: hängt am
            // neuesten Report des Kunden. So aktualisiert auch ein reiner
            // attribution-Lauf die Conversion-Details (inkl. events-Aufschlüsselung).
            if (at?.engines?.length) {
              const { data: lastRep } = await sb
                .from("ai_visibility_reports")
                .select("id")
                .eq("client_id", c.id)
                .order("snapshot_date", { ascending: false })
                .limit(1)
                .maybeSingle();
              if (lastRep?.id) {
                await sb.from("ai_visibility_attribution").delete().eq("report_id", lastRep.id);
                await sb.from("ai_visibility_attribution").insert(
                  at.engines.map((e: any) => ({
                    report_id: lastRep.id,
                    client_id: c.id,
                    engine: e.engine,
                    sessions: e.sessions,
                    conversions: e.conversions,
                    events: Array.isArray(e.events) ? e.events : [],
                    visitors: Array.isArray(e.visitors) ? e.visitors : [],
                  })),
                );
              }
            }
          } catch (e) {
            jr.error = redactSecrets(e);
          }
          results.push({ client: c.name, domain: c.domain, jobs: jr });
        }
        return { ok: true, count: clients.length, snapshot, results };
        }; // Ende runAll

        try {
          const payload = await runAll();
          if (syncRunId)
            await sb.from("ai_visibility_sync_runs").update({ status: "done", finished_at: new Date().toISOString(), result: { ...payload, phases: diagLog } }).eq("id", syncRunId);
          return Response.json(payload);
        } catch (err) {
          if (syncRunId)
            await sb.from("ai_visibility_sync_runs").update({ status: "error", finished_at: new Date().toISOString(), error: String((err as any)?.message || err).slice(0, 300) }).eq("id", syncRunId);
          throw err;
        }
      },
      // Status eines async-Laufs: GET ?run=<runId>; ohne Param: letzte 20 Läufe.
      GET: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret)
          return Response.json({ ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" }, { status: 503 });
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        const sb = supabaseAdmin as any;
        // ?costReport=YYYY-MM-DD (oder 1 = heute): LLM-Token-Kosten des Tages
        // aus api_cost_daily — der agent-service holt das für die Abend-Mail.
        const costParam = new URL(request.url).searchParams.get("costReport");
        if (costParam) {
          const tag = /^\d{4}-\d{2}-\d{2}$/.test(costParam) ? costParam : today();
          const { data: rows } = await sb
            .from("api_cost_daily").select("provider, calls, tokens_in, tokens_out, cost_usd")
            .eq("day", tag).order("cost_usd", { ascending: false });
          const providers = (rows || []).map((r: any) => ({
            provider: r.provider, calls: Number(r.calls || 0),
            tokensIn: Number(r.tokens_in || 0), tokensOut: Number(r.tokens_out || 0),
            costUsd: Math.round(Number(r.cost_usd || 0) * 100) / 100,
          }));
          const total = Math.round(providers.reduce((a: number, p: any) => a + p.costUsd, 0) * 100) / 100;
          return Response.json({ ok: true, day: tag, providers, totalUsd: total });
        }

        // ?engineHealth=1: welche der Mess-Engines haben HEUTE keine einzige
        // Antwort geliefert? (Guthaben/Quota fallen sonst still aus — Claude
        // 19.07. via HTTP 400 "credit balance", Perplexity via 401 quota.)
        if (new URL(request.url).searchParams.get("engineHealth")) {
          const heute = today();
          const { data: reps } = await sb
            .from("ai_visibility_reports").select("id").eq("snapshot_date", heute);
          const ids = (reps || []).map((r: any) => r.id);
          const gesehen = new Set<string>();
          if (ids.length) {
            for (let off = 0; off < ids.length; off += 50) {
              const { data: rows } = await sb
                .from("ai_visibility_prompts").select("platform").in("report_id", ids.slice(off, off + 50));
              for (const r of rows || []) gesehen.add(String(r.platform));
            }
          }
          // Grok nur an seinen Mess-Tagen als "fehlend" werten (sonst täglicher Fehlalarm).
          const missing = activePromptEngines().map((e) => e.name).filter((n) => !gesehen.has(n));
          return Response.json({ ok: true, build: BUILD_TAG, date: heute, present: [...gesehen], missing, reports: ids.length });
        }

        // ?engineProbe=1: jede Engine einmal minimal anpingen und den ECHTEN
        // HTTP-Status zurückgeben. engineHealth zeigt nur, DASS eine Engine
        // schweigt — nie WARUM, weil die ask*-Helfer den Fehlertext bloss
        // zurückgeben und der Runner ihn verwirft. Ohne diese Probe endet jede
        // Ausfall-Diagnose beim Raten (Guthaben? Key? Quota? Modellname?).
        if (new URL(request.url).searchParams.get("engineProbe")) {
          const probes = await Promise.all(
            PROMPT_ENGINES.map(async (e) => {
              const t0 = Date.now();
              try {
                const r: any = await e.ask("ping");
                const ms = Date.now() - t0;
                if (r === null) return { engine: e.name, ok: false, ms, grund: "kein Key gesetzt ODER leere Antwort" };
                if (r.error) return { engine: e.name, ok: false, ms, grund: String(r.error) };
                return { engine: e.name, ok: true, ms, model: r.model ?? null };
              } catch (err) {
                return { engine: e.name, ok: false, ms: Date.now() - t0, grund: redactSecrets(err) };
              }
            }),
          );
          await flushCost(sb);
          return Response.json({ ok: true, build: BUILD_TAG, probes });
        }

        // ?promptAutoCurate=<name|id|all>: Prüf-Queue automatisch kuratieren —
        // klare Fälle freigeben/archivieren, nur Unklares bleibt zur manuellen
        // Prüfung. Läuft auch in jedem Prompt-Lauf (Etappe 0); dieser Trigger
        // ist für den sofortigen Bestands-Abbau. GET, damit einfach triggerbar.
        {
          const acParam = new URL(request.url).searchParams.get("promptAutoCurate");
          if (acParam) {
            const { data: cls } = await sb.from("clients").select("id, name, domain, brand_terms");
            let targets = cls || [];
            if (acParam !== "all") {
              const q = acParam.toLowerCase();
              targets = targets.filter((c: any) => String(c.id) === acParam || String(c.name || "").toLowerCase().includes(q));
            } else {
              const active: any[] = [];
              for (const c of targets) {
                if ((await aivisAllowed(sb, c.id)).ok) active.push(c);
              }
              targets = active;
            }
            const results: any[] = [];
            for (const c of targets) {
              const cur = await autoCuratePrompts(c, sb).catch((e) => ({ pending: -1, approved: 0, archived: 0, unclear: 0, skipped: redactSecrets(e) }));
              results.push({ client: c.name, ...cur, archivedIds: undefined });
            }
            await flushCost(sb);
            return Response.json({ ok: true, build: BUILD_TAG, results });
          }
        }

        // ?relevanceAudit=<name|id|all>: Markt-Prompts gegen das Faktenprofil
        // prüfen und thematisch fremde deaktivieren (Prävention/Reparatur Fehl-
        // Seeding). Räumt auch die heutigen Report-Zeilen der geflaggten Prompts
        // ab, damit das Dashboard sofort sauber ist. GET, damit einfach triggerbar.
        {
          const raParam = new URL(request.url).searchParams.get("relevanceAudit");
          if (raParam) {
            const { data: cls } = await sb.from("clients").select("id, name, domain");
            let targets = cls || [];
            if (raParam !== "all") {
              const q = raParam.toLowerCase();
              targets = targets.filter((c: any) => String(c.id) === raParam || String(c.name || "").toLowerCase().includes(q));
            } else {
              // "all" = nur Kunden mit aktivem Service + EzyAI-App-Zugriff.
              const active: any[] = [];
              for (const c of targets) {
                if ((await aivisAllowed(sb, c.id)).ok) active.push(c);
              }
              targets = active;
            }
            const results: any[] = [];
            for (const c of targets) {
              const audit = await auditPromptRelevance(c, sb).catch((e) => ({ checked: 0, flagged: 0, skipped: redactSecrets(e) }));
              let purged = 0;
              const flagged = (audit as any).flaggedPrompts as string[] | undefined;
              if (flagged && flagged.length) {
                // Heutige Report-Zeilen der geflaggten Prompts entfernen.
                const { data: reps } = await sb
                  .from("ai_visibility_reports").select("id").eq("client_id", c.id).eq("snapshot_date", today());
                const repIds = (reps || []).map((r: any) => r.id);
                if (repIds.length) {
                  for (let i = 0; i < flagged.length; i += 100) {
                    const { count } = await sb.from("ai_visibility_prompts")
                      .delete({ count: "exact" })
                      .in("report_id", repIds).in("prompt", flagged.slice(i, i + 100));
                    purged += Number(count || 0);
                  }
                }
              }
              results.push({ client: c.name, checked: (audit as any).checked, flagged: (audit as any).flagged, purgedRows: purged, skipped: (audit as any).skipped, examples: (flagged || []).slice(0, 8) });
            }
            await flushCost(sb);
            return Response.json({ ok: true, build: BUILD_TAG, results });
          }
        }

        // ?competitorAudit=<name|id|all>: Konkurrenten-Liste + SoV-Marken gegen
        // das Faktenprofil prüfen, branchenfremde deaktivieren (Ausschluss-Marker)
        // und deren SoV-Zeilen entfernen — Rankings sofort sauber (Anlass: IKEA).
        {
          const caParam = new URL(request.url).searchParams.get("competitorAudit");
          if (caParam) {
            const { data: cls } = await sb.from("clients").select("id, name, domain");
            let targets = cls || [];
            if (caParam !== "all") {
              const q = caParam.toLowerCase();
              targets = targets.filter((c: any) => String(c.id) === caParam || String(c.name || "").toLowerCase().includes(q));
            } else {
              const active: any[] = [];
              for (const c of targets) {
                if ((await aivisAllowed(sb, c.id)).ok) active.push(c);
              }
              targets = active;
            }
            const results: any[] = [];
            for (const c of targets) {
              const audit = await auditCompetitorRelevance(c, sb).catch((e) => ({ checked: 0, flagged: 0, skipped: redactSecrets(e) }));
              results.push({ client: c.name, ...audit });
            }
            await flushCost(sb);
            return Response.json({ ok: true, build: BUILD_TAG, results });
          }
        }

        // ?brandAdvisory=1: heutige Marken-Check-Befunde (E4) — der
        // agent-service-Tick holt sie ab und hängt sie an die Wunsch-Queue
        // (Vault ist vom Server aus nicht erreichbar; Hash-Dedupe macht der Tick).
        if (new URL(request.url).searchParams.get("brandAdvisory")) {
          const heute = today();
          const { data: reps } = await sb
            .from("ai_visibility_reports")
            .select("client_id, parts, clients!inner(name)")
            .eq("snapshot_date", heute)
            .not("parts->bc->advisory", "is", null);
          const advisories = (reps || []).map((r: any) => ({
            client: r.clients?.name || null,
            text: r.parts?.bc?.advisory?.text || null,
            date: r.parts?.bc?.advisory?.date || heute,
            since: r.parts?.bc?.advisory?.since || null, // Korpus-Datierung (H3)
          })).filter((a: any) => a.client && a.text);
          return Response.json({ ok: true, build: BUILD_TAG, advisories });
        }

        // ?pending=1: Kunden mit aktivem KI-Sichtbarkeits-Tab, die Daten
        // brauchen — ohne jeglichen Report (missing:["all"]) ODER deren
        // NEUESTER Report unvollstaendig ist (pr/sa-Part fehlt, z. B. weil
        // eine Stage am ~300s-Gateway-Kap starb; Fall Embassy 2026-07-17).
        // Der agent-service-Tick faehrt dann gezielt nur die fehlenden Stages.
        if (new URL(request.url).searchParams.get("pending")) {
          const { data: cls } = await sb.from("clients").select("id, name, domain");
          const pending: any[] = [];
          for (const c of cls || []) {
            if (!(await aivisAllowed(sb, c.id)).ok) continue;
            const { data: rep } = await sb
              .from("ai_visibility_reports").select("id, parts, snapshot_date")
              .eq("client_id", c.id)
              .order("snapshot_date", { ascending: false })
              .limit(1).maybeSingle();
            if (!rep) { pending.push({ id: c.id, name: c.name, domain: c.domain, missing: ["all"] }); continue; }
            const parts: any = rep.parts || {};
            const missing: string[] = [];
            // SERP-Drosselung (2026-07-21): sa ist nur FÄLLIG, wenn die letzte
            // ECHTE Messung (gemessenAm; übernommene Stände zählen nicht)
            // älter als serp.intervalDays ist — grösster DFS-Dauerposten.
            const saMeasured = parts.sa?.uebernommen ? String(parts.sa?.gemessenAm || "") : (parts.sa ? String(parts.sa.gemessenAm || rep.snapshot_date) : "");
            const saAgeDays = saMeasured ? Math.floor((Date.parse(today()) - Date.parse(saMeasured)) / 86400_000) : 999;
            const saDue = saAgeDays >= Math.max(1, Number((SCORE_CFG as any).serp?.intervalDays ?? 2));
            if (!parts.pr) missing.push("pr");
            if (!parts.sa && saDue) missing.push("sa");
            // Tages-Frische (2026-07-19) -> Kosten-Drosselung (2026-07-31):
            // voller Lauf nicht mehr täglich, sondern erst wenn der neueste
            // Report AIVIS_FRESHNESS_DAYS alt ist (default 3 ≈ 2–3 Läufe/Woche).
            // Größter LLM-Dauerposten: alle aktiven Prompts × 6 Engines je Lauf.
            const freshDays = Math.max(1, Number(process.env.AIVIS_FRESHNESS_DAYS ?? 3) || 3);
            const repAgeDays = Math.floor((Date.parse(today()) - Date.parse(String(rep.snapshot_date))) / 86400_000);
            if (!missing.length && repAgeDays >= freshDays) {
              missing.push("daily");
              if (saDue) missing.push("sa"); // SERP nur im fälligen Rhythmus mitfahren
            }
            if (missing.length) pending.push({ id: c.id, name: c.name, domain: c.domain, missing });
          }
          return Response.json({ ok: true, build: BUILD_TAG, pending });
        }

        // ?rankClients=1: Kunden mit freigeschaltetem SEO-Dashboard + GSC-Seed-
        // Queries — der agent-service-Tick (rank-init) legt daraus automatisch
        // Rank-Tracking-Sets an (User-Vorgabe 2026-07-19, Anlass B5: Rankings
        // fehlten allen Kunden, die nie auf Keyword.com waren).
        if (new URL(request.url).searchParams.get("rankClients")) {
          const { data: cls } = await sb.from("clients").select("id, name, domain, gsc_property, brand_terms, metadata");
          const out: any[] = [];
          for (const c of cls || []) {
            const tabs = c.metadata?.defaults?.visibleTabs;
            // null/legacy = Org-Default (enthaelt seo); sonst muss "seo" drin sein.
            const seoEnabled = !Array.isArray(tabs) || tabs.includes("seo");
            if (!seoEnabled || !c.domain) continue;
            // Seed-Quelle seit 2026-07-19 (Top-250-Ausbau): GSC LIVE (28 Tage,
            // Top 250 nach Klicks) — die gespeicherten Listen (top 20/25) sind
            // nur noch Fallback, wenn GSC nicht verbunden ist oder fehlschlaegt.
            let rows: any[] = [];
            if (c.gsc_property) {
              try {
                const { accessToken } = await getGoogleAccessToken(c.id);
                const end = new Date(Date.now() - 3 * 864e5); // GSC-Puffer heute-3
                const start = new Date(end.getTime() - 28 * 864e5);
                const fmt = (d: Date) => d.toISOString().slice(0, 10);
                const gr = await fetch(
                  `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(c.gsc_property)}/searchAnalytics/query`,
                  {
                    method: "POST",
                    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                      startDate: fmt(start), endDate: fmt(end),
                      dimensions: ["query"], rowLimit: 250,
                      orderBy: [{ field: "clicks", descending: true }],
                    }),
                    signal: AbortSignal.timeout(30_000),
                  },
                );
                if (gr.ok) {
                  const gj: any = await gr.json().catch(() => ({}));
                  rows = (gj.rows || []).map((r: any) => ({
                    query: r.keys?.[0], clicks: r.clicks, impressions: r.impressions,
                  }));
                }
              } catch { /* Fallback unten */ }
            }
            if (!rows.length) {
              const { data: gq } = await sb
                .from("audit_runs").select("result")
                .eq("client_id", c.id).eq("audit_type", "gsc_queries").eq("status", "succeeded")
                .order("created_at", { ascending: false }).limit(1).maybeSingle();
              const { data: gs } = gq?.result
                ? { data: null }
                : await sb
                    .from("audit_runs").select("result")
                    .eq("client_id", c.id).eq("audit_type", "gsc_summary").eq("status", "succeeded")
                    .order("created_at", { ascending: false }).limit(1).maybeSingle();
              rows = gq?.result?.topNonbrandQueries || gs?.result?.topQueries || [];
            }
            const queries = rows
              .map((q: any) => ({
                query: String(q.query || "").trim(),
                clicks: Number(q.clicks || 0),
                impressions: Number(q.impressions || 0),
              }))
              .filter((q: any) => q.query.length > 2);
            out.push({
              id: c.id,
              name: c.name,
              domain: c.domain,
              brandTerms: Array.isArray(c.brand_terms) ? c.brand_terms : [],
              queries,
            });
          }
          return Response.json({ ok: true, build: BUILD_TAG, clients: out });
        }
        const runId = new URL(request.url).searchParams.get("run") || "";
        if (!runId) {
          const { data } = await sb
            .from("ai_visibility_sync_runs")
            .select("id, status, started_at, finished_at, clients")
            .order("started_at", { ascending: false })
            .limit(20);
          // build: Deploy-Verifikation (welcher Stand serviert wird).
          return Response.json({ ok: true, build: BUILD_TAG, runs: data || [] });
        }
        const { data } = await sb.from("ai_visibility_sync_runs").select("*").eq("id", runId).maybeSingle();
        if (!data) return Response.json({ ok: false, error: "runId unbekannt" }, { status: 404 });
        return Response.json({ ok: true, build: BUILD_TAG, run: data });
      },
    },
  },
});
