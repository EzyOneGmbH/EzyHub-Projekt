import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "./google-tokens.server";

// Keyword-Suchvolumen direkt aus dem Google Ads Keyword Planner
// (KeywordPlanIdeaService.generateKeywordHistoricalMetrics) — 2026-09-09, Volkan:
// dieselbe Quelle, die DataForSEO fuer keywords_data/google_ads anzapft und
// mit ~0.09 USD/Request weiterverkauft; hier kostenlos (zaehlt nur gegen das
// Tages-Kontingent des Developer-Tokens). Genutzt vom agent-service
// (/keyword-volume, INT-US-Volumen) ueber /api/admin/keyword-metrics und vom
// Populate (jobGscQueries) direkt.
//
// Zugang: Keyword Planner laeuft NICHT ueber ein Manager-Konto — es braucht ein
// echtes Kundenkonto mit google_ads_customer + Google-OAuth (adwords-Scope).
// KWPLAN_CLIENT_ID (clients.id) legt das Konto fest; ohne Vorgabe wird das
// erste Konto genommen, dessen Aufruf gelingt, und 6 h gemerkt.

const ADS_API = "https://googleads.googleapis.com/v24";

// Google-Sprachkonstanten (languageConstants/<id>).
const LANGUAGE_IDS: Record<string, number> = {
  de: 1001,
  en: 1000,
  fr: 1002,
  it: 1004,
  es: 1003,
  pt: 1014,
  nl: 1010,
};
const MONTHS: Record<string, number> = {
  JANUARY: 1,
  FEBRUARY: 2,
  MARCH: 3,
  APRIL: 4,
  MAY: 5,
  JUNE: 6,
  JULY: 7,
  AUGUST: 8,
  SEPTEMBER: 9,
  OCTOBER: 10,
  NOVEMBER: 11,
  DECEMBER: 12,
};

export type KeywordMetric = {
  kw: string;
  search_volume: number | null;
  cpc: number | null;
  cpc_currency: string | null;
  competition: string | null;
  competition_index: number | null;
  monthly_searches: Array<{ year: number; month: number; search_volume: number }> | null;
};

export type KeywordMetricsResult =
  | {
      ok: true;
      source: "google-ads-keyword-planner";
      customer_used: string;
      location: number;
      language: string;
      keywords: KeywordMetric[];
      missing: string[];
    }
  | { ok: false; error: string };

// Google-Ads-Keyword-Regeln (wie /keyword-volume im agent-service): >80 Zeichen,
// >10 Woerter oder Sonderzeichen lassen den ganzen Request scheitern.
export function adsKeywordOk(k: string): boolean {
  return (
    k.length > 0 &&
    k.length <= 80 &&
    k.split(/\s+/).length <= 10 &&
    !/[,!@%^()={};~`<>?\\|"*[\]]/.test(k)
  );
}

type Candidate = { id: string; name: string; customer: string };
let cachedCandidate: { at: number; c: Candidate } | null = null;

async function candidates(): Promise<Candidate[]> {
  const { data } = await supabaseAdmin
    .from("clients")
    .select("id, name, google_ads_customer")
    .not("google_ads_customer", "is", null)
    .order("name");
  const list: Candidate[] = (data || [])
    .map((c: any) => ({
      id: String(c.id),
      name: String(c.name || ""),
      customer: String(c.google_ads_customer || "").replace(/\D/g, ""),
    }))
    .filter((c) => c.customer);
  const pinned = process.env.KWPLAN_CLIENT_ID;
  if (pinned) {
    const p = list.find((c) => c.id === pinned);
    return p ? [p, ...list.filter((c) => c.id !== pinned)] : list;
  }
  if (cachedCandidate && Date.now() - cachedCandidate.at < 6 * 3600_000) {
    const c = cachedCandidate.c;
    return [c, ...list.filter((x) => x.id !== c.id)];
  }
  return list;
}

async function callPlanner(
  cand: Candidate,
  keywords: string[],
  location: number,
  languageId: number,
  devToken: string,
): Promise<{ ok: true; results: any[] } | { ok: false; error: string; fatal?: boolean }> {
  let accessToken: string;
  try {
    accessToken = (await getGoogleAccessToken(cand.id)).accessToken;
  } catch (e) {
    return {
      ok: false,
      error: `Token ${cand.name}: ${String((e as Error)?.message || e).slice(0, 120)}`,
    };
  }
  const loginCustomerId = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "").replace(/\D/g, "");
  const res = await fetch(
    `${ADS_API}/customers/${cand.customer}:generateKeywordHistoricalMetrics`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": devToken,
        "Content-Type": "application/json",
        ...(loginCustomerId ? { "login-customer-id": loginCustomerId } : {}),
      },
      body: JSON.stringify({
        keywords,
        geoTargetConstants: [`geoTargetConstants/${location}`],
        language: `languageConstants/${languageId}`,
        keywordPlanNetwork: "GOOGLE_SEARCH",
        historicalMetricsOptions: { includeAverageCpc: true },
      }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    // Developer-Token-/Keyword-Fehler betreffen alle Konten -> nicht weiterprobieren.
    const fatal = /DEVELOPER_TOKEN|INVALID_ARGUMENT|KEYWORD_TEXT/i.test(t);
    return {
      ok: false,
      fatal,
      error: `Ads API HTTP ${res.status} (${cand.name}): ${t.slice(0, 200)}`,
    };
  }
  const j: any = await res.json().catch(() => ({}));
  return { ok: true, results: Array.isArray(j.results) ? j.results : [] };
}

function toMetric(kw: string, m: any, currency: string | null): KeywordMetric {
  const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
  const cpcMicros = num(m?.averageCpcMicros ?? m?.highTopOfPageBidMicros);
  const months = Array.isArray(m?.monthlySearchVolumes)
    ? m.monthlySearchVolumes
        .map((x: any) => ({
          year: Number(x.year),
          month: MONTHS[String(x.month)] ?? 0,
          search_volume: Number(x.monthlySearches ?? 0),
        }))
        .filter((x: any) => x.year && x.month)
        .sort((a: any, b: any) => b.year - a.year || b.month - a.month)
        .slice(0, 12)
    : null;
  return {
    kw,
    search_volume: num(m?.avgMonthlySearches),
    cpc: cpcMicros != null ? Math.round(cpcMicros / 10_000) / 100 : null,
    cpc_currency: cpcMicros != null ? currency : null,
    competition: m?.competition ? String(m.competition) : null,
    competition_index: num(m?.competitionIndex),
    monthly_searches: months,
  };
}

/**
 * Historische Keyword-Metriken fuer bis zu 2000 Keywords (Chunks a 500).
 * location = Google-Geo-ID (2756 CH, 2840 US — identisch zu den
 * DataForSEO-location_codes), language = ISO-Kuerzel.
 */
export async function fetchKeywordMetrics(
  rawKeywords: string[],
  location = 2756,
  language = "de",
): Promise<KeywordMetricsResult> {
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!devToken) return { ok: false, error: "GOOGLE_ADS_DEVELOPER_TOKEN fehlt" };
  const languageId =
    LANGUAGE_IDS[
      String(language || "de")
        .toLowerCase()
        .slice(0, 2)
    ];
  if (!languageId) return { ok: false, error: `Sprache ${language} nicht unterstuetzt` };
  const keywords = [
    ...new Set(
      rawKeywords
        .map((k) =>
          String(k || "")
            .trim()
            .toLowerCase(),
        )
        .filter(adsKeywordOk),
    ),
  ].slice(0, 2000);
  if (!keywords.length) return { ok: false, error: "keine gueltigen Keywords" };

  const cands = await candidates();
  if (!cands.length) return { ok: false, error: "kein Kunde mit google_ads_customer" };

  const errors: string[] = [];
  for (const cand of cands.slice(0, 5)) {
    const results: any[] = [];
    let failed: string | null = null;
    let fatal = false;
    for (let i = 0; i < keywords.length; i += 500) {
      const r = await callPlanner(cand, keywords.slice(i, i + 500), location, languageId, devToken);
      if (!r.ok) {
        failed = r.error;
        fatal = !!r.fatal;
        break;
      }
      results.push(...r.results);
    }
    if (failed) {
      errors.push(failed);
      if (fatal) break;
      continue;
    }
    cachedCandidate = { at: Date.now(), c: cand };
    // Waehrung des Kontos (CPC) — best effort, sonst null.
    let currency: string | null = null;
    try {
      const { data: cl } = await supabaseAdmin
        .from("clients")
        .select("metadata")
        .eq("id", cand.id)
        .maybeSingle();
      currency = (cl as any)?.metadata?.currency || null;
    } catch {
      /* optional */
    }
    const byText = new Map<string, any>();
    for (const r of results) {
      const text = String(r?.text || "").toLowerCase();
      if (text) byText.set(text, r.keywordMetrics || {});
      for (const v of r?.closeVariants || [])
        byText.set(String(v).toLowerCase(), r.keywordMetrics || {});
    }
    const out: KeywordMetric[] = [];
    const missing: string[] = [];
    for (const kw of keywords) {
      const m = byText.get(kw);
      if (m) out.push(toMetric(kw, m, currency));
      else missing.push(kw);
    }
    return {
      ok: true,
      source: "google-ads-keyword-planner",
      customer_used: cand.name,
      location,
      language,
      keywords: out,
      missing,
    };
  }
  return { ok: false, error: errors.join(" | ").slice(0, 600) || "kein Konto erreichbar" };
}
