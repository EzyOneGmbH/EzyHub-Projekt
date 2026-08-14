import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Die generierten Database-Types kennen die ai_visibility_*-Tabellen erst nach
// Anwendung der Migration + Type-Regeneration (Lovable). Bis dahin untypisierter
// Zugriff; der Rückgabetyp AIVisibilityData bleibt die verbindliche Schnittstelle.
const sb = supabase as any;

// AI-Visibility-Loader (Spec §6/§7): liest die ai_visibility_*-Tabellen
// client-seitig (RLS: can_access_client) und liefert EXAKT das
// AIVisibilityData-Objekt, das AIVisibilityDashboard als { data } erwartet.

export type Kpi = { value: number; delta: number; prev: number };
// Google-KI-Antwort zu EINER Suchanfrage (13.08.): Text + zitierte Quellen.
export type SerpAnswer = { kw: string; land: string; text: string; refs: { d: string; u: string; t: string }[] };

export type AIPrompt = {
  prompt: string;
  platform: string;
  country: string;
  status?: string;
  sentiment?: string; // 'pos' | 'neu' | 'neg'
  position?: string;  // 'top' | 'list' | 'passing' | 'none'
  intent?: string;    // Informativ | Kommerziell | Transaktional | Navigativ (+ Alt-engl.)
  brands: number;
  sources: number;
  response: string;
  comps: string[];
  // Phase-2-Felder (03.08.) — erst ab dem nächsten Messlauf befüllt:
  topic?: string;                              // Themen-Label der Prompt-Def
  sourceUrls?: string[];                       // zitierte Quell-URLs
  checkedAt?: string;                          // Messzeitpunkt der Antwort
  compPositions?: { n: string; p: string; s?: string; d?: string }[]; // Rival-Position/-Sentiment/-Domain (Judge H)
};

export type AIVisibilityData = {
  clientId: string; // für Drilldown-Nachladen (Prompt-Historie via RLS)
  client: string;
  domain?: string; // für Eigene-Website-Erkennung in der Quellen-Typologie
  market: string;
  date: string;
  score: number;
  scoreDelta: number;
  scoreRaw?: number;                   // ungedeckelter v2-Wert (Trend/Diagnose)
  measurementVersion?: string;         // Mess-Version (Score v2)
  versionSwitch?: string | null;       // Datum der Messumstellung -> Delta-Sperre + UI-Marker
  brHomeSplit?: { home: number; intl: number } | null; // Ahrefs-Erwähnungen Heimmarkt CH vs. International
  // Marken-Check (Brand-Prompts): misst WAS KI-Systeme über die Marke sagen —
  // fliesst nicht in den Score ein.
  brandCheck?: {
    answered: number;
    faktentreueQuote: number | null;
    faktentreueVerteilung: Record<string, number>;
    tonalitaetsVerteilung: Record<string, number>;
    halluzinationen: { engine: string; prompt: string; zitat: string }[];
    topQuellen: { domain: string; n: number }[];
    konkurrenzNennungen: { name: string; n: number }[];
    selfNennungen: number;
    advisory?: { text: string; date: string | null };
  } | null;
  brandPrompts?: AIPrompt[];
  // Zeitreihe des Marken-Checks — ZWEI strikt getrennte Quellen:
  // "eigene-prompts" (ab Erstlauf) und "korpus-backfill" (retro, Ahrefs-Archiv).
  brandHistory?: {
    date: string;
    source: "eigene-prompts" | "korpus-backfill" | string;
    provider: string;
    faktentreueQuote: number | null;
    tonalitaet: Record<string, number>;
    answered: number;
  }[];
  kpis: { mentions: Kpi; citations: Kpi; citedPages: Kpi };
  trend: { m: string; mentions: number; citations: number; pages: number; score?: number | null }[];
  // Tages-Verlauf (04.08., Searchable-Parität): letzte 14 Mess-Snapshots einzeln
  // (3-Tage-Kadenz => ~6 Wochen Fenster), für die Tage/Monate-Umschaltung im Hero.
  dailyTrend?: { d: string; iso?: string; score: number | null; mentions: number }[];
  // Massnahmen-Marker (13.08.): agent_runs mit Deploys — für Wirkungsnachweis
  // im Score-Trend ("hier wurde etwas geändert").
  deployMarkers?: { iso: string; label: string }[];
  // Sentiment-Score 0-100 (pos=100/neu=50/neg=0 über Judge-bewertete Antworten).
  sentiment?: { score: number | null; pos: number; neu: number; neg: number; trend: { d: string; score: number }[] };
  models: {
    name: string;
    layer: "macro" | "custom";
    mentions: number;
    sov: number;
    byCountry: Record<string, number>;
  }[];
  topics: { topic: string; vis: number; mentions: number; vol: number | null; intent: string }[];
  promptsNeedsReview?: number;
  prompts: AIPrompt[];
  promptOpps: AIPrompt[];
  sources: { domain: string; mentions: number; share: number; urls: number; traffic: number }[];
  // Domain-Zitier-Trend (03.08., Searchable "Top Domains"): je Monat der neueste
  // Report, dessen Quellen-Zeilen — Top-Domains als Mehrlinien-Serie.
  sourceTrend?: { months: string[]; series: { domain: string; values: number[] }[] };
  // Query-Fanout light (03.08.): Google-Folgefragen (PAA) + verwandte Suchen je
  // GSC-Keyword aus dem serp_ai-Lauf — bewusst KEINE KI-internen Sub-Queries.
  fanout?: { kw: string; country: string; questions: string[]; related: string[] }[];
  // Echte KI-Suche (13.08., llm_scraper Consumer-Oberfläche ChatGPT/Gemini):
  // Antworttext + zitierte Quellen + genannte Marken + Folgefragen.
  // Altdaten (bis 12.08.) hatten nur chatgptFanout → wird eingemischt.
  aiSearch?: {
    kw: string; engine: string; branded?: boolean; text: string;
    sources: { d: string; u: string; t: string }[];
    brands: string[]; queries: string[];
  }[];
  // AIO/AI-Mode-Detail (06.08.): welche Google-Suchanfragen den Kunden zitieren
  // (SERP-Messung, keine Prompt-Antworten) — für die Erwähnungen-Karte.
  // answers (13.08.): echter Antworttext + Quellen je zitierter Suchanfrage.
  serpAi?: {
    aio?: { checked: number; present: number; cited: number; citations: number; keywords: string[]; answers: SerpAnswer[] };
    aim?: { checked: number; present: number; cited: number; citations: number; keywords: string[]; answers: SerpAnswer[] };
    gemessenAm?: string;
    uebernommen?: boolean;
  };
  attribution: {
    engine: string;
    sessions: number;
    conv: number;
    // txn = Buchungs-/Transaktions-ID (macht die Conversion zur Einzelzeile),
    // currency = dl_currency des Buchungs-Setups; beide optional.
    events: { name: string; count: number; value: number; country: string; device: string; date: string; txn?: string; currency?: string }[];
    // Besucher-Herkunft (05.08.): GA4-Sessions je Land (englische GA4-Namen)
    visitors: { country: string; sessions: number }[];
  }[];
  countries: { name: string; value: number }[];
  promptIntent: { name: string; value: number }[];
  sov: { brand: string; isSelf: boolean; mentions: number; share: number }[];
};

const deCH = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("de-CH", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
const monShort = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("de-CH", { month: "short" }).replace(".", "");
const kpi = (value: number, delta: number): Kpi => ({
  value,
  delta,
  prev: value - delta, // prev wird nicht separat geführt (Spec §7.3)
});

function mapPrompt(r: any, opportunity: boolean): AIPrompt {
  const p: AIPrompt = {
    prompt: String(r.prompt ?? ""),
    platform: String(r.platform ?? ""),
    country: String(r.country ?? ""),
    brands: Number(r.brands_count ?? 0),
    sources: Number(r.sources_count ?? 0),
    response: String(r.response ?? ""),
    comps: Array.isArray(r.competitors) ? r.competitors.map(String) : [],
  };
  if (!opportunity && r.status) p.status = String(r.status); // bei Chancen weglassen
  if (r.sentiment) p.sentiment = String(r.sentiment);
  if (r.position) p.position = String(r.position);
  if (r.intent) p.intent = String(r.intent); // Funnel-Ansicht (Searchable-Nachbau 08/2026)
  if (r.topic) p.topic = String(r.topic);
  if (Array.isArray(r.source_urls) && r.source_urls.length) p.sourceUrls = r.source_urls.map(String);
  if (r.checked_at) p.checkedAt = String(r.checked_at);
  if (Array.isArray(r.comp_positions) && r.comp_positions.length) {
    p.compPositions = r.comp_positions
      .map((x: any) => ({ n: String(x?.n || ""), p: String(x?.p || "list"), ...(x?.s ? { s: String(x.s) } : {}), ...(x?.d ? { d: String(x.d) } : {}) }))
      .filter((x: any) => x.n);
  }
  return p;
}

// Supabase/PostgREST liefert pro Query max. 1000 Zeilen. Bei vielen Prompts ×
// Engines reicht das nicht — deshalb blockweise laden, bis alles da ist.
async function fetchAllPromptRows(reportId: string): Promise<any[]> {
  const CHUNK = 1000;
  const out: any[] = [];
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await sb
      .from("ai_visibility_prompts")
      .select("*")
      .eq("report_id", reportId)
      .order("id", { ascending: true }) // stabile Reihenfolge für lückenlose Blöcke
      .range(from, from + CHUNK - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < CHUNK) return out;
  }
}

// Sitzungs-Cache (2026-07-21): Das Dashboard feuert ~10 Abfragen je Öffnung.
// Statt jedes Mal ALLES zu laden, entscheidet EINE Mini-Abfrage (Report-Kopf),
// ob sich etwas geändert hat — unverändert => Cache; geändert => Vollreload.
// Der Report wird bei jedem Messlauf upsertet (Score/Mentions/Parts ändern
// sich), damit ist der Kopf ein verlässlicher Änderungs-Marker.
const AIVIS_CACHE = new Map<string, { key: string; data: AIVisibilityData }>();

export async function loadAIVisibility(
  clientId: string,
  clientLabel?: string,
  date?: string,
): Promise<AIVisibilityData | null> {
  // 1) Neuester (oder gegebener) Report.
  let q = sb
    .from("ai_visibility_reports")
    .select("*")
    .eq("client_id", clientId)
    .order("snapshot_date", { ascending: false })
    .limit(1);
  if (date) q = sb.from("ai_visibility_reports").select("*").eq("client_id", clientId).eq("snapshot_date", date).limit(1);
  const { data: reports, error } = await q;
  if (error) throw new Error(error.message);
  const rep: any = reports?.[0];
  if (!rep) return null; // Empty-State: noch kein Report für diesen Kunden

  // Änderungs-Marker: gleicher Report-Stand -> alles aus dem Cache (0 weitere Abfragen).
  const cacheId = `${clientId}|${date || "latest"}`;
  const cacheKey = `${rep.id}|${rep.score}|${rep.mentions}|${rep.citations}|${rep.cited_pages}|${JSON.stringify(rep.parts?.pr?.mentions ?? null)}|${JSON.stringify(rep.parts?.bc?.answered ?? null)}`;
  const hit = AIVIS_CACHE.get(cacheId);
  if (hit && hit.key === cacheKey) return hit.data;

  // 2) Kind-Tabellen parallel (client_id-Filter zusätzlich -> nutzt die RLS-Policy direkt).
  const [models, topics, prompts, sources, attribution, history, sovRes, reviewCount] = await Promise.all([
    sb.from("ai_visibility_models").select("*").eq("report_id", rep.id),
    sb.from("ai_visibility_topics").select("*").eq("report_id", rep.id).order("visibility", { ascending: false }),
    fetchAllPromptRows(rep.id),
    sb.from("ai_visibility_sources").select("*").eq("report_id", rep.id).order("mentions", { ascending: false }),
    sb.from("ai_visibility_attribution").select("*").eq("report_id", rep.id).order("sessions", { ascending: false }),
    // Trend: genug Reports fuer 12 MONATE laden (taegliche Snapshots + rueck-
    // datierte Backfill-Monate); Monats-Aggregation passiert unten in JS.
    sb
      .from("ai_visibility_reports")
      .select("id, snapshot_date, mentions, citations, cited_pages, score, sentiment:parts->sentiment")
      .eq("client_id", clientId)
      .gte("snapshot_date", new Date(Date.now() - 370 * 864e5).toISOString().slice(0, 10))
      .order("snapshot_date", { ascending: false })
      .limit(1000),
    sb.from("ai_visibility_sov").select("*").eq("report_id", rep.id).order("share", { ascending: false }),
    // Zur Prüfung markierte Prompt-Defs (needs_review): frisch geseedet ODER vom
    // Relevanz-Audit als fremd deaktiviert — Transparenz-Banner im Prompts-Tab.
    sb.from("ai_visibility_prompt_defs").select("id", { count: "exact", head: true }).eq("client_id", clientId).eq("needs_review", true),
  ]);
  // Massnahmen-Marker (13.08.): Agent-Läufe mit tatsächlichen Deploys der
  // letzten 60 Tage — Wirkungsnachweis im Score-Trend. RLS-gated (org-member);
  // Fehler hier dürfen das Dashboard nie kippen.
  const { data: deployRuns } = await sb
    .from("agent_runs").select("run_at, agent_name, deploy_count, summary")
    .eq("client_id", clientId).gt("deploy_count", 0)
    .gte("run_at", new Date(Date.now() - 60 * 864e5).toISOString())
    .order("run_at", { ascending: true }).limit(50)
    .then((r: any) => r, () => ({ data: [] }));
  const modelRows = models.data ?? [];
  const modelIds = modelRows.map((m: any) => m.id);
  const { data: mcRows } = modelIds.length
    ? await sb.from("ai_visibility_model_country").select("*").in("model_id", modelIds)
    : { data: [] as any[] };

  // 3) Mapping auf den Vertrag (Spec §7.3).
  const byModel: Record<string, Record<string, number>> = {};
  const countryTotals: Record<string, number> = {};
  for (const r of mcRows ?? []) {
    (byModel[r.model_id] ??= {})[r.country] = (byModel[r.model_id]?.[r.country] || 0) + Number(r.mentions ?? 0);
    countryTotals[r.country] = (countryTotals[r.country] || 0) + Number(r.mentions ?? 0);
  }
  // Monats-Reports (je Monat der NEUESTE) — Basis für trend UND Domain-Trend.
  const perMonthRep = new Map<string, any>();
  for (const h of history.data ?? []) {
    const key = String(h.snapshot_date).slice(0, 7); // YYYY-MM
    if (!perMonthRep.has(key)) perMonthRep.set(key, h);
  }
  const monthlyReps = [...perMonthRep.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([, h]) => h);
  // Domain-Zitier-Trend (K): Quellen der Monats-Reports nachladen (max. 12 IDs).
  const { data: histSources } = monthlyReps.length
    ? await sb.from("ai_visibility_sources").select("report_id, domain, mentions").in("report_id", monthlyReps.map((h: any) => h.id))
    : { data: [] as any[] };
  const srcByRep = new Map<string, Map<string, number>>();
  const srcTotals = new Map<string, number>();
  for (const s of histSources ?? []) {
    const rid = String(s.report_id), dom = String(s.domain || "");
    if (!dom) continue;
    (srcByRep.get(rid) ?? srcByRep.set(rid, new Map()).get(rid)!).set(dom, Number(s.mentions ?? 0));
    srcTotals.set(dom, (srcTotals.get(dom) || 0) + Number(s.mentions ?? 0));
  }
  const topDomains = [...srcTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([d]) => d);
  const sourceTrend = {
    months: monthlyReps.map((h: any) => monShort(String(h.snapshot_date))),
    series: topDomains.map((domain) => ({
      domain,
      values: monthlyReps.map((h: any) => srcByRep.get(String(h.id))?.get(domain) ?? 0),
    })),
  };

  const promptRows = prompts; // fetchAllPromptRows liefert bereits das Array
  const intentTotals: Record<string, number> = {};
  for (const r of promptRows) {
    if (r.intent) intentTotals[r.intent] = (intentTotals[r.intent] || 0) + 1;
  }

  // Score v2: Versionswechsel-Marker + Heimmarkt-Split aus den Report-Parts.
  const repParts: any = rep.parts || {};
  const versionSwitch: string | null = repParts?.meta?.versionSwitch ?? null;
  let brHomeSplit: { home: number; intl: number } | null = null;
  if (Array.isArray(repParts?.br?.models)) {
    let home = 0, intl = 0;
    for (const m of repParts.br.models) {
      for (const [land, v] of Object.entries(m?.byCountry || {})) {
        if (land === "Schweiz") home += Number(v || 0);
        else intl += Number(v || 0);
      }
    }
    if (home + intl > 0) brHomeSplit = { home, intl };
  }

  const result: AIVisibilityData = {
    clientId,
    client: clientLabel || String(rep.market ?? ""),
    // Domain für die Zitierquellen-Typologie (Eigene-Website-Erkennung):
    // clientLabel ist per Aufrufer-Konvention domain||name — nur echte Domains übernehmen.
    domain: clientLabel && clientLabel.includes(".") ? clientLabel : "",
    market: String(rep.market ?? ""),
    date: deCH(String(rep.snapshot_date)),
    score: Number(rep.score ?? 0),
    scoreDelta: Number(rep.score_delta ?? 0),
    scoreRaw: rep.score_raw != null ? Number(rep.score_raw) : undefined,
    measurementVersion: rep.measurement_version ?? undefined,
    versionSwitch,
    brHomeSplit,
    kpis: {
      mentions: kpi(Number(rep.mentions ?? 0), Number(rep.mentions_delta ?? 0)),
      citations: kpi(Number(rep.citations ?? 0), Number(rep.citations_delta ?? 0)),
      citedPages: kpi(Number(rep.cited_pages ?? 0), Number(rep.cited_pages_delta ?? 0)),
    },
    // Monats-Trend (max. 12 Monate, ab dem ersten Messpunkt — 13.08. Volkan):
    // je Monat der NEUESTE Report (monthlyReps oben); my = "Aug 2026" für die
    // "seit …"-Beschriftung der Entwicklungs-Karte.
    trend: monthlyReps.map((h: any) => ({
      m: monShort(String(h.snapshot_date)),
      my: new Date(String(h.snapshot_date) + "T00:00:00").toLocaleDateString("de-CH", { month: "short", year: "numeric" }).replace(".", ""),
      mentions: Number(h.mentions ?? 0),
      citations: Number(h.citations ?? 0),
      pages: Number(h.cited_pages ?? 0),
      score: h.score != null ? Number(h.score) : null, // VisibilityHero (03.08.)
    })),
    sourceTrend,
    // Sentiment-Score 0-100 (11.08., Searchable-Parität): pos=100/neu=50/neg=0
    // über alle Judge-bewerteten Antworten; Trend aus parts->sentiment je Report
    // (Backfill 11.08. über alle Bestands-Reports).
    sentiment: (() => {
      const cur: any = (rep.parts as any)?.sentiment;
      const trendPts = (history.data ?? [])
        .slice(0, 20)
        .reverse()
        .map((h: any) => ({
          d: new Date(String(h.snapshot_date) + "T00:00:00").toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" }),
          score: h.sentiment?.score != null ? Number(h.sentiment.score) : null,
        }))
        .filter((p: any) => p.score != null);
      if (!cur && !trendPts.length) return undefined;
      return {
        score: cur?.score != null ? Number(cur.score) : null,
        pos: Number(cur?.pos ?? 0), neu: Number(cur?.neu ?? 0), neg: Number(cur?.neg ?? 0),
        trend: trendPts,
      };
    })(),
    // Letzte 14 einzelne Snapshots, chronologisch (history kommt absteigend).
    dailyTrend: (history.data ?? [])
      .slice(0, 14)
      .reverse()
      .map((h: any) => ({
        d: new Date(String(h.snapshot_date) + "T00:00:00").toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" }),
        iso: String(h.snapshot_date),
        score: h.score != null ? Number(h.score) : null,
        mentions: Number(h.mentions ?? 0),
      })),
    deployMarkers: ((deployRuns as any[]) || []).map((r: any) => ({
      iso: String(r.run_at || "").slice(0, 10),
      label: `${String(r.agent_name || "Agent")}: ${Number(r.deploy_count)} Änderung${Number(r.deploy_count) === 1 ? "" : "en"}${r.summary ? ` — ${String(r.summary).slice(0, 120)}` : ""}`,
    })),
    models: modelRows.map((m: any) => ({
      name: String(m.model_name ?? ""),
      layer: m.layer === "custom" ? "custom" : "macro",
      mentions: Number(m.mentions ?? 0),
      sov: Number(m.sov ?? 0),
      byCountry: byModel[m.id] ?? {},
    })),
    topics: (topics.data ?? []).map((t: any) => ({
      topic: String(t.topic ?? ""),
      vis: Number(t.visibility ?? 0),
      mentions: Number(t.mentions ?? 0),
      // null = keine Volumen-Daten (AI-Suchvolumen gibt es nur für gängige
      // Suchbegriffe) — im UI "–", NICHT 0 ("keine Nachfrage").
      vol: t.volume == null ? null : Number(t.volume),
      intent: String(t.intent ?? ""),
    })),
    // Zur Prüfung markierte Prompt-Defs (Fehl-Seeding-Prävention): Banner im UI.
    promptsNeedsReview: Number(reviewCount?.count ?? 0),
    // Markt-Prompts (Sichtbarkeit); Brand-Prompts laufen separat in den Marken-Check.
    prompts: promptRows.filter((r: any) => !r.is_opportunity && (r.prompt_type || "markt") !== "brand").map((r: any) => mapPrompt(r, false)),
    promptOpps: promptRows.filter((r: any) => r.is_opportunity && (r.prompt_type || "markt") !== "brand").map((r: any) => mapPrompt(r, true)),
    brandPrompts: promptRows.filter((r: any) => r.prompt_type === "brand").map((r: any) => {
      const p = mapPrompt(r, false);
      const be = r.brand_eval || {};
      (p as any).brandEval = { faktentreue: be.faktentreue ?? null, tonalitaet: be.tonalitaet ?? null, halluzination: be.halluzination ?? null };
      return p;
    }),
    brandCheck: (rep.parts as any)?.bc ?? null,
    fanout: Array.isArray((rep.parts as any)?.sa?.fanout) ? (rep.parts as any).sa.fanout : undefined,
    // Neu (13.08.) aiSearch; Altdaten (chatgptFanout) werden auf dieselbe
    // Form gehoben, damit die Karte auch ohne frischen Lauf etwas zeigt.
    aiSearch: (() => {
      const sa: any = (rep.parts as any)?.sa;
      const neu = Array.isArray(sa?.aiSearch) ? sa.aiSearch : null;
      const rows = neu ?? (Array.isArray(sa?.chatgptFanout) ? sa.chatgptFanout : []);
      return rows.length ? rows.map((r: any) => ({
        kw: String(r?.kw ?? ""),
        engine: String(r?.engine ?? "ChatGPT"),
        ...(r?.branded ? { branded: true } : {}),
        text: String(r?.text ?? ""),
        sources: (Array.isArray(r?.sources) ? r.sources : []).map((s: any) => ({ d: String(s?.d ?? ""), u: String(s?.u ?? ""), t: String(s?.t ?? "") })),
        brands: (Array.isArray(r?.brands) ? r.brands : []).map(String),
        queries: (Array.isArray(r?.queries) ? r.queries : []).map(String),
      })).filter((r: any) => r.kw) : undefined;
    })(),
    serpAi: (() => {
      const sa: any = (rep.parts as any)?.sa;
      if (!sa || (!sa.aio && !sa.aim)) return undefined;
      const pick = (x: any) => x ? {
        checked: Number(x.checked ?? 0), present: Number(x.present ?? 0), cited: Number(x.cited ?? 0), citations: Number(x.citations ?? 0),
        keywords: Array.isArray(x.keywords) ? x.keywords.map(String) : [],
        answers: (Array.isArray(x.answers) ? x.answers : []).map((a: any) => ({
          kw: String(a?.kw ?? ""), land: String(a?.land ?? ""), text: String(a?.text ?? ""),
          refs: (Array.isArray(a?.refs) ? a.refs : []).map((r: any) => ({ d: String(r?.d ?? ""), u: String(r?.u ?? ""), t: String(r?.t ?? "") })),
        })).filter((a: SerpAnswer) => a.kw && a.text),
      } : undefined;
      return { aio: pick(sa.aio), aim: pick(sa.aim), gemessenAm: sa.gemessenAm ? String(sa.gemessenAm) : undefined, uebernommen: !!sa.uebernommen };
    })(),
    brandHistory: await (async () => {
      const { data: hist } = await sb
        .from("ai_visibility_brand_history")
        .select("point_date, source, provider, data")
        .eq("client_id", clientId)
        .order("point_date", { ascending: true })
        .limit(500);
      return (hist ?? []).map((h: any) => ({
        date: String(h.point_date),
        source: String(h.source),
        provider: String(h.provider || ""),
        faktentreueQuote: h.data?.faktentreueQuote ?? null,
        tonalitaet: h.data?.tonalitaetsVerteilung ?? {},
        answered: Number(h.data?.answered ?? 0),
      }));
    })(),
    sources: (sources.data ?? []).map((s: any) => ({
      domain: String(s.domain ?? ""),
      mentions: Number(s.mentions ?? 0),
      share: Number(s.share ?? 0),
      urls: Number(s.urls ?? 0),
      traffic: Number(s.traffic ?? 0),
    })),
    attribution: (attribution.data ?? []).map((a: any) => ({
      engine: String(a.engine ?? ""),
      sessions: Number(a.sessions ?? 0),
      conv: Number(a.conversions ?? 0),
      events: Array.isArray(a.events)
        ? a.events
            .map((e: any) => ({
              name: String(e?.name ?? ""),
              count: Number(e?.count ?? 0),
              value: Number(e?.value ?? 0),
              country: String(e?.country ?? ""),
              device: String(e?.device ?? ""),
              date: String(e?.date ?? ""),
              ...(e?.txn ? { txn: String(e.txn) } : {}),
              ...(e?.currency ? { currency: String(e.currency) } : {}),
            }))
            .filter((e: any) => e.name)
        : [],
      visitors: Array.isArray(a.visitors)
        ? a.visitors
            .map((v: any) => ({ country: String(v?.country ?? ""), sessions: Number(v?.sessions ?? 0) }))
            .filter((v: any) => v.sessions > 0)
        : [],
    })),
    countries: Object.entries(countryTotals)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value),
    promptIntent: Object.entries(intentTotals)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value),
    sov: (sovRes.data ?? [])
      .map((s: any) => ({
        brand: String(s.brand ?? ""),
        isSelf: !!s.is_self,
        mentions: Number(s.mentions ?? 0),
        share: Number(s.share ?? 0),
      }))
      .sort((a: any, b: any) => b.share - a.share),
  };
  AIVIS_CACHE.set(cacheId, { key: cacheKey, data: result });
  return result;
}

export function useEzyAIVisibility(clientId?: string, clientLabel?: string) {
  const [data, setData] = useState<AIVisibilityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!clientId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setData(await loadAIVisibility(clientId, clientLabel));
    } catch (e: any) {
      setError(e?.message || "Laden fehlgeschlagen");
      setData(null);
    }
    setLoading(false);
  }, [clientId, clientLabel]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, error, reload };
}

// ── Prompt-Historie (11.08., Searchable "Response History") ──────────────────
// Verlauf EINES Prompts über die letzten Mess-Snapshots: Status/Antwort je
// Engine je Datum. Lazy beim Öffnen des Drilldowns — nutzt die bestehenden
// RLS-Read-Policies (reports + prompts), kein neuer Endpoint nötig.
export type PromptHistoryRow = {
  date: string;        // ISO snapshot_date
  platform: string;
  status: string | null;
  position: string | null;
  sentiment: string | null;
  response: string;
  checkedAt: string | null;
};
export async function fetchPromptHistory(
  clientId: string,
  prompt: string,
  maxReports = 15,
): Promise<PromptHistoryRow[]> {
  const { data: reps } = await sb
    .from("ai_visibility_reports")
    .select("id, snapshot_date")
    .eq("client_id", clientId)
    .order("snapshot_date", { ascending: false })
    .limit(maxReports);
  const byId = new Map<string, string>((reps ?? []).map((r: any) => [String(r.id), String(r.snapshot_date)]));
  if (!byId.size) return [];
  const { data: rows } = await sb
    .from("ai_visibility_prompts")
    .select("report_id, platform, status, position, sentiment, response, checked_at")
    .in("report_id", [...byId.keys()])
    .eq("prompt", prompt)
    .limit(1000);
  return (rows ?? [])
    .map((r: any) => ({
      date: byId.get(String(r.report_id)) || "",
      platform: String(r.platform ?? ""),
      status: r.status ?? null,
      position: r.position ?? null,
      sentiment: r.sentiment ?? null,
      response: String(r.response ?? ""),
      checkedAt: r.checked_at ?? null,
    }))
    .filter((r) => r.date)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.platform.localeCompare(b.platform)));
}
