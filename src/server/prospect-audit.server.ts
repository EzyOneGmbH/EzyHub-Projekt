// EzyAI – Analyse (14.08.2026): Pre-Onboarding-Schnellaudit fuer Leads.
// Domain-basiert (KEIN clients-Eintrag noetig), Ergebnisse in prospect_audits.
//
// Ablauf: startAudit legt die Zeile an + generiert das Prompt-Set; danach
// treibt das Frontend den Lauf mit tickAudit-Aufrufen Etappe fuer Etappe
// voran (Gateway kappt ~300 s pro Request — deshalb Etappen statt einem
// grossen Lauf, gleiches Muster wie aivis-Etappen/populate).
//
// Etappen: technik (SiteHealth deep + Tech-Detect/Anbindung) -> seo (Labs-
// Sichtbarkeit + Backlinks + LLM-Mentions-Makro) -> volumen (AI-Suchvolumen
// je Prompt) -> ai1/ai2/ai3 (Prompt-Runner: 4 Engines via DataForSEO) ->
// entitaet (Wikidata + Brand-SERP) -> benchmark (Wettbewerber Quick-Score)
// -> score (Dimensionen + Top-5-Massnahmen, LLM Subscription-first).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { generateViaSubscription } from "./claude-generate.server";
import {
  runSiteHealthForDomain, fetchText, botBlocked, CRITICAL_BOTS,
} from "@/routes/api/admin.site-health";

// ── Basis-Helfer ─────────────────────────────────────────────────────────────
export function normDomain(input: string): string {
  return String(input || "").trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].split("?")[0];
}
const nameTokens = (name: string) =>
  String(name || "").toLowerCase().replace(/\b(ag|gmbh|sa|sarl|s\.a\.|kg|co|inc|ltd)\b\.?/g, "")
    .split(/[^a-z0-9äöüéèà]+/).filter((t) => t.length >= 3);

function dfsAuth(): string | null {
  const login = process.env.DATAFORSEO_LOGIN, pass = process.env.DATAFORSEO_PASSWORD;
  if (!login || !pass) return null;
  return "Basic " + Buffer.from(`${login}:${pass}`).toString("base64");
}

// DataForSEO-Live-Call mit Kosten (Shapes wie aivis-sync/agent-service).
async function dfs(path: string, task: any, timeoutMs = 90_000): Promise<{ ok: boolean; result?: any; cost: number; error?: string }> {
  const auth = dfsAuth();
  if (!auth) return { ok: false, cost: 0, error: "DATAFORSEO_LOGIN/PASSWORD fehlt" };
  try {
    const r = await fetch(`https://api.dataforseo.com/v3/${path}`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify([task]),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j: any = await r.json().catch(() => null);
    const t = j?.tasks?.[0];
    if (!r.ok || !t) return { ok: false, cost: 0, error: `HTTP ${r.status}` };
    if (Number(t.status_code) >= 40000)
      return { ok: false, cost: Number(j?.cost) || 0, error: `${t.status_code}: ${String(t.status_message || "").slice(0, 140)}` };
    return { ok: true, result: t.result, cost: Number(j?.cost) || 0 };
  } catch (e) {
    return { ok: false, cost: 0, error: String((e as any)?.message || e).slice(0, 140) };
  }
}

async function pMap<T, R>(items: T[], fn: (t: T, i: number) => Promise<R>, conc: number): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

function parseJson(text: string): any {
  const m = String(text || "").match(/\[[\s\S]*\]|\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

// LLMs verpacken Arrays gern in ein Objekt ({"massnahmen":[...]}) — dann die
// erste Array-Property nehmen, sonst faellt der Aufrufer faelschlich in den
// deterministischen Fallback (beobachtet 14.08. beim Massnahmen-Call).
function asArray(j: any): any[] | null {
  if (Array.isArray(j)) return j;
  if (j && typeof j === "object") {
    for (const v of Object.values(j)) if (Array.isArray(v)) return v;
  }
  return null;
}

// LLM-Utility Subscription-first (agent-service /generate); null = Fallback.
async function llmJson(label: string, prompt: string, maxTokens = 1500): Promise<any | null> {
  const r = await generateViaSubscription({
    prompt, label: `EzyAI-Analyse: ${label}`,
    system: "Du bist ein Schweizer GEO/SEO-Analyst. Antworte AUSSCHLIESSLICH mit gueltigem JSON, ohne Erklaertext, ohne Codefences. Schweizer Schreibweise (ss statt Eszett).",
    timeoutMs: 140_000,
  });
  return r?.text ? parseJson(r.text) : null;
}

// ── Engine-Set (wie aivis: DataForSEO-Scraper als EIN Abrechnungskonto) ─────
const ENGINES: Array<{ name: string; se: string; model: string }> = [
  { name: "ChatGPT", se: "chat_gpt", model: "gpt-5.1" },
  { name: "Perplexity", se: "perplexity", model: "sonar" },
  { name: "Gemini", se: "gemini", model: "gemini-2.5-flash" },
  { name: "Claude", se: "claude", model: "claude-sonnet-5" },
];

async function askEngine(se: string, model: string, prompt: string) {
  const r = await dfs(`ai_optimization/${se}/llm_responses/live`, { user_prompt: prompt.slice(0, 500), model_name: model }, 120_000);
  if (!r.ok) return { ok: false as const, cost: r.cost, error: r.error };
  const row = (r.result ?? [])[0];
  const text = ((row?.items ?? []) as any[])
    .filter((it) => it?.type === "message")
    .flatMap((it) => (it.sections ?? []).map((s: any) => String(s?.text ?? "")))
    .join(" ").trim();
  return { ok: true as const, cost: r.cost, text, model: String(row?.model_name || model) };
}

const urlDomainsIn = (t: string): string[] => {
  const out = new Set<string>();
  for (const u of String(t).match(/https?:\/\/[^\s)\]"'>]+/g) || []) {
    try { out.add(new URL(u.replace(/[.,);]+$/, "")).hostname.replace(/^www\./, "").toLowerCase()); } catch { /* kaputt */ }
  }
  return [...out];
};

function mentionsBrand(text: string, domain: string, firmenname: string): boolean {
  const t = text.toLowerCase();
  const base = domain.split(".")[0];
  if (base.length >= 4 && t.includes(base)) return true;
  if (t.includes(domain)) return true;
  const toks = nameTokens(firmenname);
  if (!toks.length) return false;
  // Alle Namens-Tokens muessen vorkommen (z. B. "faith" + "humanity").
  return toks.every((tok) => t.includes(tok));
}

// Portale/Verzeichnisse, die als "Wettbewerber" keinen Sinn ergeben.
const PORTAL_RE = /wikipedia|google|facebook|instagram|linkedin|youtube|comparis|moneyland|local\.ch|search\.ch|gelbeseiten|trustpilot|tripadvisor|booking\.com|hotels\.com|expedia|trivago|airbnb|jobs\.ch|ricardo|galaxus|digitec|20min|blick\.ch|nzz\.ch|srf\.ch|watson\.ch|houzy|renovero|gryps|amazon\./i;

// ── Wettbewerber-Vorschlag (Wizard-Schritt 2, "mit AI ermitteln") ───────────
// Zwei Quellen: (1) Labs-SERP-Ueberschneidung, sofern die Domain organische
// Daten hat; (2) reiner AI-Vorschlag aus Branche+Ort — wichtig, weil Leads
// oft (noch) keinen Labs-Fussabdruck haben (Test 14.08.: kleine CH-Domains
// liefern 0 Items, hotel-ava.ch 692).
export async function suggestCompetitors(input: { domain: string; firmenname: string; branche?: string; ort?: string }) {
  const domain = normDomain(input.domain);
  let cost = 0;
  const r = await dfs("dataforseo_labs/google/competitors_domain/live", {
    target: domain, location_code: 2756, language_code: "de", limit: 15, ignore_synonyms: true,
  });
  cost += r.cost;
  const cands = ((r.ok && r.result?.[0]?.items) || [])
    .map((it: any) => ({
      domain: String(it.domain || "").replace(/^www\./, ""),
      gemeinsameKeywords: it.competitor_metrics?.organic?.count ?? it.metrics?.organic?.count ?? 0,
      etv: Math.round(it.competitor_metrics?.organic?.etv ?? 0),
    }))
    .filter((c: any) => c.domain && c.domain !== domain && !PORTAL_RE.test(c.domain))
    .slice(0, 12);

  if (cands.length) {
    // LLM kuratiert: echte, vergleichbare Firmen — Portale/Grosskonzerne raus.
    const curated = asArray(await llmJson("Wettbewerber kuratieren", [
      `Firma: ${input.firmenname} (${domain}), Branche: ${input.branche || "unbekannt"}, Ort/Markt: ${input.ort || "Schweiz"}.`,
      `Kandidaten (organische SERP-Ueberschneidung): ${JSON.stringify(cands)}`,
      `Waehle die bis zu 4 am besten vergleichbaren ECHTEN Wettbewerber (gleiche Leistung, aehnliche Groesse/Region; keine Verzeichnisse, Medien oder Konzerne).`,
      `JSON: [{"domain":"...","grund":"max 10 Woerter","empfohlen":true|false}] — genau die Kandidaten-Domains verwenden.`,
    ].join("\n"), 800));
    const list = Array.isArray(curated) && curated.length
      ? curated
          .filter((c: any) => c?.domain && cands.some((k: any) => k.domain === normDomain(c.domain)))
          .slice(0, 4)
          .map((c: any) => ({ domain: normDomain(c.domain), grund: String(c.grund || "").slice(0, 90), empfohlen: c.empfohlen !== false }))
      : cands.slice(0, 4).map((c: any, i: number) => ({
          domain: c.domain, grund: `${c.gemeinsameKeywords} gemeinsame Keywords in Google`, empfohlen: i < 3,
        }));
    if (list.length) return { ok: true, kandidaten: list, quelle: "serp", cost };
  }

  // Fallback ohne SERP-Daten: AI schlaegt aus Branchen-/Ortskenntnis vor.
  const ai = await llmJson("Wettbewerber vorschlagen", [
    `Firma: ${input.firmenname} (${domain}), Branche: ${input.branche || "unbekannt"}, Ort/Markt: ${input.ort || "Schweiz"}.`,
    `Die Domain hat noch keinen messbaren organischen Fussabdruck. Nenne bis zu 4 reale Schweizer Wettbewerber (echte Firmen mit Website, gleiche Leistung, aehnliche Region). NUR Firmen, bei denen du dir der Domain sicher bist — lieber weniger als geraten.`,
    `JSON: [{"domain":"firma.ch","grund":"max 10 Woerter","empfohlen":true}]`,
  ].join("\n"), 700);
  const list = (asArray(ai) || [])
    .map((c: any) => ({ domain: normDomain(String(c?.domain || "")), grund: String(c?.grund || "AI-Vorschlag").slice(0, 90), empfohlen: c?.empfohlen !== false }))
    .filter((c: any) => c.domain.includes(".") && c.domain !== domain && !PORTAL_RE.test(c.domain))
    .slice(0, 4);
  return { ok: true, kandidaten: list, quelle: "ai", cost };
}

// ── Prompt-Set (15 Stueck, 3–8 Woerter, ohne Satzzeichen → AI-Volumen-tauglich) ──
// Volkan 14.08.: hoechstens 1–3 Brand-Prompts — der Rest sind neutrale
// Alternativen-/Anbieter-Suchen, denn genau dort entscheidet sich, wen die
// Engines OHNE Markenbekanntheit empfehlen.
const PROMPT_TARGET_N = 15;
const MAX_BRAND_PROMPTS = 3;

function fallbackPrompts(firmenname: string, branche: string, ort: string): string[] {
  const b = (branche || "dienstleister").toLowerCase().split("/")[0].trim();
  const o = (ort || "schweiz").toLowerCase().split(",")[0].trim();
  return [
    `beste ${b} ${o}`, `${b} ${o} empfehlung`, `${b} ${o} vergleich`, `${b} kosten schweiz`,
    `guter ${b} in der naehe`, `${b} ${o} erfahrungen`, `${b} anbieter schweiz`, `${b} ${o} bewertung`,
    `${b} auswaehlen tipps`, `${b} schweiz seriös`, `top ${b} ${o}`, `${b} preise uebersicht`,
    `${b} anbieter unterschiede`, `wie finde ich den richtigen ${b}`, `${firmenname.toLowerCase()} erfahrungen`,
  ].map((s) => s.replace(/\s+/g, " ").trim()).slice(0, PROMPT_TARGET_N);
}

async function buildPrompts(input: { firmenname: string; branche?: string; ort?: string; domain: string }): Promise<string[]> {
  const j = await llmJson("Prompt-Set", [
    `Firma: ${input.firmenname} (${input.domain}), Branche: ${input.branche || "unbekannt"}, Ort/Markt: ${input.ort || "Schweiz"}.`,
    `Erzeuge ${PROMPT_TARGET_N} realistische Suchanfragen, die potenzielle Kunden einer KI (ChatGPT, Gemini, Perplexity) oder Google stellen wuerden, um einen solchen Anbieter zu finden oder zu vergleichen. Deutsch (Schweiz).`,
    `Regeln: je 3–8 Woerter, Kleinschreibung, KEINE Satzzeichen/Fragezeichen. WICHTIG: hoechstens 2 Prompts duerfen "${input.firmenname}" enthalten (Brand-Check) — alle anderen sind NEUTRALE Suchen ohne Firmennamen (Anbieter-Suche, Vergleich, Alternativen, Kosten, Ort, Problem/Beratung).`,
    `JSON: ["prompt1", ...] (genau ${PROMPT_TARGET_N} Strings)`,
  ].join("\n"), 900);
  const list = (asArray(j) || []).map((p: any) => String(p || "").toLowerCase().replace(/[?!.,:;"“”]/g, "").replace(/\s+/g, " ").trim()).filter((p: string) => p && p.split(" ").length <= 10);
  // Brand-Kappung hart durchsetzen: max. MAX_BRAND_PROMPTS mit Namens-/Domain-Bezug.
  const toks = nameTokens(input.firmenname);
  const base = normDomain(input.domain).split(".")[0];
  const isBrand = (p: string) => (base.length >= 4 && p.includes(base)) || (toks.length > 0 && toks.every((t) => p.includes(t)));
  const uniq: string[] = [];
  let brand = 0;
  for (const p of new Set(list)) {
    if (isBrand(p)) { if (brand >= MAX_BRAND_PROMPTS) continue; brand++; }
    uniq.push(p);
    if (uniq.length >= PROMPT_TARGET_N) break;
  }
  // Zu wenig? Mit neutralen Fallback-Prompts auffuellen (ohne Duplikate).
  if (uniq.length < PROMPT_TARGET_N) {
    for (const p of fallbackPrompts(input.firmenname, input.branche || "", input.ort || "")) {
      if (uniq.length >= PROMPT_TARGET_N) break;
      if (uniq.includes(p)) continue;
      if (isBrand(p) && brand >= MAX_BRAND_PROMPTS) continue;
      if (isBrand(p)) brand++;
      uniq.push(p);
    }
  }
  return uniq.slice(0, PROMPT_TARGET_N);
}

// ── Anbindungs-Check: HTML der Startseite ist PRIMAER, DFS nur Ergaenzung ───
// Befund ezyone.ch (Volkan 17.08.): der DFS-Technologie-Index kennt kleine/
// junge Domains nicht (leere Antwort) — GTM/GA4 standen aber klar im Quelltext.
// Live-HTML luegt nicht; nur was weder dort noch bei DFS auftaucht, gilt als
// "nicht erkannt". Ads via GTM-Container ist aus HTML prinzipiell unsichtbar
// -> eigener Hinweis statt hartem "fehlt".
function deriveAnbindung(techs: Array<{ group: string; category: string; name: string }>, html: string) {
  const names = techs.map((t) => t.name.toLowerCase());
  const has = (re: RegExp) => names.some((n) => re.test(n));
  const H = String(html || "");
  const Hl = H.toLowerCase();

  const gtmId = H.match(/GTM-[A-Z0-9]{4,10}/)?.[0] || null;
  const gaId = H.match(/G-[A-Z0-9]{6,14}(?=["'&/\\])/)?.[0] || null;
  const awId = H.match(/AW-\d{8,11}/)?.[0] || null;
  const gtm = !!gtmId || Hl.includes("googletagmanager.com/gtm.js") || has(/tag manager/);
  const ga4 = !!gaId || Hl.includes("googletagmanager.com/gtag/js") || has(/google analytics/);

  const generator = H.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i)?.[1] || null;
  const wordpress = Hl.includes("wp-content") || Hl.includes("wp-includes") || has(/wordpress/);
  const cms = generator
    || (wordpress ? "WordPress" : null)
    || (Hl.includes("cdn.shopify") ? "Shopify" : null)
    || (Hl.includes("typo3") ? "TYPO3" : null)
    || (Hl.includes("wix.com") ? "Wix" : null)
    || (Hl.includes("webflow") ? "Webflow" : null)
    || techs.find((t) => /cms|ecommerce/i.test(t.category) || /wordpress|typo3|joomla|drupal|webflow|wix|squarespace|shopify|jimdo|magento|contao/i.test(t.name))?.name
    || null;
  const builder = (Hl.includes("elementor") ? "Elementor" : null)
    || techs.find((t) => /elementor|divi|wpbakery|beaver|oxygen/i.test(t.name))?.name || null;

  const CONSENT = ["Cookiebot", "Usercentrics", "Borlabs", "Complianz", "OneTrust", "CookieYes", "iubenda"];
  const consent = CONSENT.find((c) => Hl.includes(c.toLowerCase()) || (c === "Complianz" && Hl.includes("cmplz")))
    || techs.find((t) => /cookiebot|usercentrics|onetrust|borlabs|complianz|cookieyes|iubenda/i.test(t.name))?.name || null;

  const adsTag = !!awId || /googleads\.g\.doubleclick|google_conversion/i.test(H) || has(/google ads|adwords|floodlight/);
  return {
    cms, builder,
    wordpress, elementor: builder === "Elementor" || has(/elementor/),
    ga4, gaId, gtm, gtmId, consent,
    adsTag, adsId: awId,
    // Ads laeuft oft NUR im GTM-Container — aus HTML nicht nachweisbar.
    adsViaGtmMoeglich: !adsTag && gtm,
    techCount: techs.length,
  };
}

// ── Zeilen-Helfer ───────────────────────────────────────────────────────────
const SB = supabaseAdmin as any;
async function loadRow(id: string) {
  const { data } = await SB.from("prospect_audits").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}
async function saveRow(id: string, patch: any) {
  patch.updated_at = new Date().toISOString();
  const { data, error } = await SB.from("prospect_audits").update(patch).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}
const addCost = (data: any, c: number) => { data.kostenUsd = Math.round(((Number(data.kostenUsd) || 0) + c) * 10000) / 10000; };

// ── Start: Zeile anlegen + Prompt-Set generieren ────────────────────────────
export async function startAudit(opts: {
  organizationId: string; userId: string | null;
  domain: string; firmenname: string; branche?: string; ort?: string;
  wettbewerber: string[];
}) {
  const domain = normDomain(opts.domain);
  if (!domain || !domain.includes(".")) throw new Error("Gueltige Domain erforderlich");
  const wettbewerber = [...new Set(opts.wettbewerber.map(normDomain).filter((d) => d && d !== domain))].slice(0, 3);
  const prompts = await buildPrompts({ firmenname: opts.firmenname, branche: opts.branche, ort: opts.ort, domain });
  const { data, error } = await SB.from("prospect_audits").insert({
    organization_id: opts.organizationId, created_by: opts.userId,
    domain, firmenname: opts.firmenname.trim(), branche: (opts.branche || "").trim(), ort: (opts.ort || "").trim(),
    wettbewerber, status: "laufend", stage: "technik", progress: 5,
    data: { prompts: prompts.map((q) => ({ q })), kostenUsd: 0 },
  }).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

// ── Tick: EINE Etappe ausfuehren ────────────────────────────────────────────
export async function tickAudit(id: string) {
  const row = await loadRow(id);
  if (!row) throw new Error("Analyse nicht gefunden");
  if (row.status !== "laufend") return row;
  const data = row.data || {};
  const domain: string = row.domain;
  try {
    switch (row.stage) {
      case "technik": {
        const sh = await runSiteHealthForDomain(domain, "deep");
        data.technik = { scores: sh.scores, issues: sh.issues, pages: sh.pages, blockedBots: sh.blockedBots,
          robotsOk: sh.robotsOk, botDetails: sh.botDetails };
        const td = await dfs("domain_analytics/technologies/domain_technologies/live", { target: domain });
        addCost(data, td.cost);
        const item = td.ok ? (td.result?.[0]?.items?.[0] || td.result?.[0] || {}) : {};
        const flat: Array<{ group: string; category: string; name: string }> = [];
        for (const [group, cats] of Object.entries(item.technologies || {})) {
          if (!cats || typeof cats !== "object") continue;
          for (const [category, names] of Object.entries(cats as any)) {
            for (const name of (Array.isArray(names) ? names : [])) flat.push({ group, category, name: String(name) });
          }
        }
        data.anbindung = deriveAnbindung(flat, sh.homeHtml || "");
        return await saveRow(id, { data, stage: "seo", progress: 25 });
      }
      case "seo": {
        const [ov, bl, am] = await Promise.all([
          dfs("dataforseo_labs/google/domain_rank_overview/live", { target: domain, location_code: 2756, language_code: "de" }),
          dfs("backlinks/summary/live", { target: domain, include_subdomains: true }),
          dfs("ai_optimization/llm_mentions/aggregated_metrics/live", { target: [{ domain }], location_name: "Switzerland", language_code: "de" }),
        ]);
        addCost(data, ov.cost + bl.cost + am.cost);
        const org = ov.ok ? (ov.result?.[0]?.items?.[0]?.metrics?.organic || {}) : {};
        const b = bl.ok ? (bl.result?.[0] || {}) : {};
        const total = am.ok ? (am.result?.[0]?.total || {}) : {};
        const byPlatform: Record<string, number> = {};
        for (const p of (total.platform || [])) byPlatform[String(p.key)] = Number(p.mentions) || 0;
        data.seo = {
          keywords: org.count ?? 0, etv: Math.round(org.etv ?? 0),
          pos1: org.pos_1 ?? 0, pos2_3: org.pos_2_3 ?? 0, pos4_10: org.pos_4_10 ?? 0,
          backlinks: b.backlinks ?? 0, refDomains: b.referring_main_domains ?? b.referring_domains ?? 0,
          spamScore: b.target_spam_score ?? null,
        };
        data.mentionsMakro = {
          total: Object.values(byPlatform).reduce((a, x) => a + x, 0),
          byPlatform,
          citedSources: (total.sources_domain || [])
            .map((s: any) => ({ domain: String(s.key || "").replace(/^www\./, ""), mentions: s.mentions ?? 0 }))
            .filter((s: any) => s.domain).slice(0, 15),
        };
        return await saveRow(id, { data, stage: "volumen", progress: 35 });
      }
      case "volumen": {
        const kws = (data.prompts || []).map((p: any) => p.q);
        const r = await dfs("ai_optimization/ai_keyword_data/keywords_search_volume/live", {
          keywords: kws, language_code: "de", location_name: "Switzerland",
        });
        addCost(data, r.cost);
        const map = new Map<string, number>();
        for (const it of (r.ok ? r.result?.[0]?.items || [] : [])) {
          if (it?.keyword) map.set(String(it.keyword).toLowerCase(), Number(it.ai_search_volume) || 0);
        }
        for (const p of data.prompts || []) p.vol = map.get(String(p.q).toLowerCase()) ?? null;
        return await saveRow(id, { data, stage: "ai1", progress: 45 });
      }
      case "ai1": case "ai2": case "ai3": {
        const part = Number(row.stage.slice(2)); // 1..3
        const prompts = (data.prompts || []) as Array<{ q: string; vol: number | null; engines?: any }>;
        // 15 Prompts in 3 Etappen à 5 (je Etappe 5 × 4 Engines = 20 Live-Calls).
        const slice = prompts.map((p, i) => ({ p, i })).filter(({ i }) => Math.floor(i / 5) === part - 1);
        const jobs = slice.flatMap(({ p, i }) => ENGINES.map((e) => ({ p, i, e })));
        await pMap(jobs, async ({ p, e }) => {
          const r = await askEngine(e.se, e.model, p.q);
          addCost(data, r.cost);
          p.engines = p.engines || {};
          if (!r.ok || !("text" in r) || !r.text) { p.engines[e.name] = { ok: false }; return null; }
          const cited = urlDomainsIn(r.text);
          p.engines[e.name] = {
            ok: true, mention: mentionsBrand(r.text, domain, row.firmenname) || cited.some((d) => d.includes(domain)),
            cited: cited.filter((d) => !d.includes("google.")).slice(0, 6),
            snippet: r.text.slice(0, 500), model: r.model,
          };
          return null;
        }, 4);
        const next = part < 3 ? `ai${part + 1}` : "entitaet";
        return await saveRow(id, { data, stage: next, progress: 45 + part * 12 });
      }
      case "entitaet": {
        // Wikidata: gibt es die Marke als eindeutige Entitaet?
        let wikidata: any = { found: false, matches: 0 };
        try {
          const wdSearch = async (lang: string) => {
            const w = await fetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(row.firmenname)}&language=${lang}&uselang=${lang}&format=json&limit=5&origin=*`, { signal: AbortSignal.timeout(15_000) });
            const j: any = await w.json();
            return Array.isArray(j?.search) ? j.search : [];
          };
          // Viele CH-Items haben nur ein en-Label — bei 0 de-Treffern en nachfassen.
          let hits = await wdSearch("de");
          if (!hits.length) hits = await wdSearch("en");
          const exact = hits.find((h: any) => String(h.label || "").toLowerCase() === row.firmenname.toLowerCase());
          wikidata = { found: !!exact, matches: hits.length, id: exact?.id || hits[0]?.id || null, beschreibung: (exact || hits[0])?.description || null };
        } catch { /* Wikidata offline -> unbewertet */ }
        // Brand-SERP: rankt die eigene Domain auf den eigenen Namen #1?
        const serp = await dfs("serp/google/organic/live/advanced", {
          keyword: row.firmenname, location_code: 2756, language_code: "de", depth: 10,
        });
        addCost(data, serp.cost);
        let brandPos: number | null = null; const fremde: string[] = [];
        for (const it of (serp.ok ? serp.result?.[0]?.items || [] : [])) {
          if (it?.type !== "organic") continue;
          const d = String(it.domain || "").replace(/^www\./, "");
          if (d.includes(domain) || domain.includes(d)) { if (brandPos === null) brandPos = it.rank_group ?? it.rank_absolute ?? null; }
          else if (fremde.length < 5) fremde.push(d);
        }
        const orgSchemaOk = !(data.technik?.issues || []).some((i: any) => i.id === "orgschema");
        data.entitaet = { wikidata, brandPos, fremdeDomains: fremde, orgSchema: orgSchemaOk };
        return await saveRow(id, { data, stage: "benchmark", progress: 88 });
      }
      case "benchmark": {
        const quickScore = async (d: string) => {
          const [ov, robots] = await Promise.all([
            dfs("dataforseo_labs/google/domain_rank_overview/live", { target: d, location_code: 2756, language_code: "de" }),
            fetchText(`https://${d}/robots.txt`, 10_000),
          ]);
          addCost(data, ov.cost);
          const org = ov.ok ? (ov.result?.[0]?.items?.[0]?.metrics?.organic || {}) : {};
          const blocked = robots.ok ? [...CRITICAL_BOTS].some((b) => botBlocked(robots.text, b)) : false;
          // Erwaehnungen dieser Domain in den bereits eingesammelten Engine-Antworten.
          let mentions = 0;
          for (const p of data.prompts || []) for (const e of Object.values(p.engines || {}) as any[]) {
            if (e?.cited?.some((c: string) => c.includes(d))) mentions++;
          }
          const score = Math.min(100, Math.round(
            Math.min(35, (Number(org.count) || 0) / 25) + Math.min(20, (Number(org.etv) || 0) / 150) +
            (blocked ? 0 : 20) + Math.min(25, mentions * 6)));
          return { domain: d, score, keywords: org.count ?? 0, etv: Math.round(org.etv ?? 0), aiBotsBlockiert: blocked, mentions };
        };
        const own = await quickScore(domain);
        const comps = await pMap((row.wettbewerber || []) as string[], quickScore, 2);
        data.benchmark = { eigen: own, wettbewerber: comps };
        return await saveRow(id, { data, stage: "score", progress: 94 });
      }
      case "score": {
        const prompts = (data.prompts || []) as any[];
        const engOf = (p: any) => Object.values(p.engines || {}) as any[];
        const answered = prompts.filter((p) => engOf(p).some((e) => e?.ok));
        const mentioned = prompts.filter((p) => engOf(p).some((e) => e?.mention));
        const mentionRate = answered.length ? mentioned.length / answered.length : 0;
        const missedVol = prompts.filter((p) => !engOf(p).some((e) => e?.mention))
          .reduce((a, p) => a + (Number(p.vol) || 0), 0);
        const makro = Number(data.mentionsMakro?.total) || 0;
        const ai = Math.round(100 * (0.75 * mentionRate + 0.25 * Math.min(1, makro / 20)));
        const technik = Number(data.technik?.scores?.overall) || 0;
        const ent = data.entitaet || {};
        const entitaet = Math.min(100, (ent.wikidata?.found ? 40 : ent.wikidata?.matches ? 10 : 0) +
          (ent.orgSchema ? 30 : 0) + (ent.brandPos === 1 ? 30 : ent.brandPos ? 15 : 0));
        const s = data.seo || {};
        const seo = Math.min(100, Math.round(Math.min(40, (Number(s.keywords) || 0) / 25) +
          Math.min(30, (Number(s.etv) || 0) / 100) + Math.min(30, (Number(s.refDomains) || 0) / 15)));
        const score = Math.round(0.4 * ai + 0.25 * technik + 0.2 * entitaet + 0.15 * seo);
        data.missedVol = missedVol;
        data.mentionStats = { prompts: prompts.length, mitNennung: mentioned.length, rate: Math.round(mentionRate * 100) };

        // Top-5-Massnahmen: LLM Subscription-first, deterministischer Fallback.
        const findings = {
          score, dims: { ai, technik, entitaet, seo },
          blockierteBots: data.technik?.blockedBots || [], topIssues: (data.technik?.issues || []).slice(0, 6).map((i: any) => `${i.label}: ${i.detail}`),
          wikidata: ent.wikidata, brandPos: ent.brandPos, missedVol,
          promptsOhneNennung: prompts.filter((p) => !engOf(p).some((e) => e?.mention)).map((p) => p.q).slice(0, 8),
          zitierteQuellen: (data.mentionsMakro?.citedSources || []).slice(0, 8),
        };
        const m = await llmJson("Top-5-Massnahmen", [
          `Firma: ${row.firmenname} (${domain}). Befunde des AI-Sichtbarkeits-Audits:`, JSON.stringify(findings),
          `Leite die 5 wirksamsten Massnahmen ab (Wirkung/Aufwand-priorisiert, konkret, deutsch/Schweiz).`,
          `JSON: [{"titel":"...","detail":"1 Satz Begruendung mit Zahl/Befund","prio":"hoch"|"mittel"|"leicht"}]`,
        ].join("\n"), 1200);
        const mArr = asArray(m);
        const massnahmen = (mArr && mArr.length ? mArr : [
          ...(findings.blockierteBots.length ? [{ titel: "robots.txt: AI-Crawler freigeben", detail: `Blockiert: ${findings.blockierteBots.join(", ")} — Inhalte sind fuer AI-Engines unsichtbar.`, prio: "hoch" }] : []),
          ...(!ent.wikidata?.found ? [{ titel: "Wikidata-Item + Organization-Schema mit sameAs anlegen", detail: "Die Marke ist fuer AI-Engines keine eindeutige Entitaet.", prio: "hoch" }] : []),
          ...(missedVol > 0 ? [{ titel: "Zitierfaehige Inhalte zu den Top-Volumen-Prompts erstellen", detail: `~${missedVol} AI-Anfragen/Monat ohne Markennennung.`, prio: "mittel" }] : []),
          { titel: "Eintraege in zitierten Quellen pruefen", detail: `Meistzitiert: ${(findings.zitierteQuellen[0] as any)?.domain || "Verzeichnisse"}.`, prio: "mittel" },
          { titel: `SiteHealth verbessern (aktuell ${technik})`, detail: (findings.topIssues[0] as string) || "Offene technische Punkte beheben.", prio: "leicht" },
        ]).slice(0, 5).map((x: any) => ({ titel: String(x.titel || "").slice(0, 120), detail: String(x.detail || "").slice(0, 220), prio: ["hoch", "mittel", "leicht"].includes(x.prio) ? x.prio : "mittel" }));
        data.massnahmen = massnahmen;
        return await saveRow(id, { data, dims: { ai, technik, entitaet, seo }, score, status: "fertig", stage: "fertig", progress: 100 });
      }
      default:
        return await saveRow(id, { status: "fertig", progress: 100 });
    }
  } catch (e) {
    // Etappe notieren, aber nicht endgueltig scheitern lassen — naechster Tick versucht erneut;
    // nach 3 Fehlversuchen derselben Etappe wird der Lauf als Fehler beendet.
    const fails = (Number(data.stageFails?.[row.stage]) || 0) + 1;
    data.stageFails = { ...(data.stageFails || {}), [row.stage]: fails };
    const msg = String((e as any)?.message || e).slice(0, 300);
    if (fails >= 3) return await saveRow(id, { data, status: "fehler", error: `${row.stage}: ${msg}` });
    return await saveRow(id, { data, error: `${row.stage} (Versuch ${fails}): ${msg}` });
  }
}
