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

export type AIPrompt = {
  prompt: string;
  platform: string;
  country: string;
  status?: string;
  sentiment?: string; // 'pos' | 'neu' | 'neg'
  position?: string;  // 'top' | 'list' | 'passing' | 'none'
  brands: number;
  sources: number;
  response: string;
  comps: string[];
};

export type AIVisibilityData = {
  client: string;
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
  trend: { m: string; mentions: number; citations: number; pages: number }[];
  models: {
    name: string;
    layer: "macro" | "custom";
    mentions: number;
    sov: number;
    byCountry: Record<string, number>;
  }[];
  topics: { topic: string; vis: number; mentions: number; vol: number; intent: string }[];
  prompts: AIPrompt[];
  promptOpps: AIPrompt[];
  sources: { domain: string; mentions: number; share: number; urls: number; traffic: number }[];
  attribution: {
    engine: string;
    sessions: number;
    conv: number;
    events: { name: string; count: number; value: number; country: string; device: string; date: string }[];
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

  // 2) Kind-Tabellen parallel (client_id-Filter zusätzlich -> nutzt die RLS-Policy direkt).
  const [models, topics, prompts, sources, attribution, history, sovRes] = await Promise.all([
    sb.from("ai_visibility_models").select("*").eq("report_id", rep.id),
    sb.from("ai_visibility_topics").select("*").eq("report_id", rep.id).order("visibility", { ascending: false }),
    fetchAllPromptRows(rep.id),
    sb.from("ai_visibility_sources").select("*").eq("report_id", rep.id).order("mentions", { ascending: false }),
    sb.from("ai_visibility_attribution").select("*").eq("report_id", rep.id).order("sessions", { ascending: false }),
    // Trend: genug Reports fuer 12 MONATE laden (taegliche Snapshots + rueck-
    // datierte Backfill-Monate); Monats-Aggregation passiert unten in JS.
    sb
      .from("ai_visibility_reports")
      .select("snapshot_date, mentions, citations, cited_pages")
      .eq("client_id", clientId)
      .gte("snapshot_date", new Date(Date.now() - 370 * 864e5).toISOString().slice(0, 10))
      .order("snapshot_date", { ascending: false })
      .limit(1000),
    sb.from("ai_visibility_sov").select("*").eq("report_id", rep.id).order("share", { ascending: false }),
  ]);
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

  return {
    client: clientLabel || String(rep.market ?? ""),
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
    // Monats-Trend (12 Monate): je Monat der NEUESTE Report (Reports kommen
    // snapshot_date-absteigend -> erster Treffer je Monat gewinnt).
    trend: (() => {
      const perMonth = new Map<string, any>();
      for (const h of history.data ?? []) {
        const key = String(h.snapshot_date).slice(0, 7); // YYYY-MM
        if (!perMonth.has(key)) perMonth.set(key, h);
      }
      return [...perMonth.entries()]
        .sort(([a], [b]) => a.localeCompare(b)) // chronologisch
        .slice(-12)
        .map(([, h]: [string, any]) => ({
          m: monShort(String(h.snapshot_date)),
          mentions: Number(h.mentions ?? 0),
          citations: Number(h.citations ?? 0),
          pages: Number(h.cited_pages ?? 0),
        }));
    })(),
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
      vol: Number(t.volume ?? 0),
      intent: String(t.intent ?? ""),
    })),
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
            }))
            .filter((e: any) => e.name)
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
