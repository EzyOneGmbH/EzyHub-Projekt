// EzyAI — Agentur-Performance-Tabelle (Volkan 29.09.2026, analog EzyRank
// SeoAgencyTable / EzyPerformance AdsAgencyTable): je Kunde Kennzahlen fuer
// Zeitraum + Vergleich, getrennt nach Organic und Ads.
//
// Organic: KI-Besucher + KI-Conversions (GA4, gleiche Engine-Erkennung und
//          «Zaehlt als Conversion»-Logik wie die Attribution) plus
//          KI-Sichtbarkeit aus dem juengsten Messlauf zum Periodenende
//          (ai_visibility_reports: Score, Erwaehnungen, Zitate).
// Ads:     ChatGPT-Ads-Summen aus chatgpt_ads_insights_daily (Kosten,
//          Impressionen, Klicks, Conversions) plus GA4-Sessions/-Conversions
//          aus Quelle chatgpt / Medium cpc.
// Nur lesend, keine Persistenz.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "@/server/google-tokens.server";
import { ga4DateRange, type Zeitraum } from "@/lib/date-range";
import { ENGINES, isOrganicBing, countedConversionEvents } from "@/server/aivis-attribution.server";
import { GA4_MEDIUM_RE, GA4_SOURCE_RE } from "@/server/chatgpt-ads-report.server";

const GA4 = "https://analyticsdata.googleapis.com/v1beta";
type Fenster = { aktuell: Zeitraum; vorher: Zeitraum };

export type OrganicKpi = {
  kiBesucher: number | null;
  kiConversions: number | null;
  score: number | null;
  mentions: number | null;
  citations: number | null;
};
export type AdsKpi = {
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  conversions: number | null;
  ga4Sessions: number | null;
  ga4Conversions: number | null;
};
export type AiOverviewZeile<K> = {
  clientId: string;
  cur: K | null;
  prev: K | null;
  currency?: string | null;
  demo?: boolean;
  keinKonto?: boolean;
  stand?: { cur: string | null; prev: string | null }; // Messlauf-Datum (Organic)
  hinweise: string[];
  error: string | null;
};

async function runReport(token: string, propertyId: string, body: unknown): Promise<any> {
  const r = await fetch(`${GA4}/properties/${encodeURIComponent(propertyId)}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`GA4 HTTP ${r.status}`);
  return r.json().catch(() => ({}));
}

async function ga4Zugang(c: { id: string; ga4_property?: string | null }) {
  if (!c.ga4_property) return null;
  const token = (await getGoogleAccessToken(c.id)).accessToken;
  return { token, propertyId: String(c.ga4_property).replace(/^properties\//, "") };
}

// KI-Besucher + KI-Conversions einer Periode (leichtgewichtig: keine Details).
async function kiTraffic(
  g: { token: string; propertyId: string },
  zr: Pick<Zeitraum, "startDate" | "endDate">,
  counted: Set<string>,
): Promise<{ sessions: number; conversions: number }> {
  const j = await runReport(g.token, g.propertyId, {
    dateRanges: [ga4DateRange(zr)],
    dimensions: [{ name: "sessionSource" }, { name: "sessionDefaultChannelGroup" }],
    metrics: [{ name: "sessions" }, { name: "keyEvents" }],
    limit: 10000,
  });
  let sessions = 0;
  let conversions = 0;
  for (const row of j.rows ?? []) {
    const src = String(row.dimensionValues?.[0]?.value ?? "");
    if (!ENGINES.some((e) => e.re.test(src))) continue;
    if (isOrganicBing(src, String(row.dimensionValues?.[1]?.value ?? ""))) continue;
    sessions += Number(row.metricValues?.[0]?.value ?? 0);
    conversions += Number(row.metricValues?.[1]?.value ?? 0);
  }
  if (counted.size) {
    // «Zaehlt als Conversion»: eventCount ersetzt den keyEvents-Anteil.
    const j2 = await runReport(g.token, g.propertyId, {
      dateRanges: [ga4DateRange(zr)],
      dimensions: [
        { name: "sessionSource" },
        { name: "sessionDefaultChannelGroup" },
        { name: "eventName" },
      ],
      metrics: [{ name: "keyEvents" }, { name: "eventCount" }],
      dimensionFilter: {
        filter: { fieldName: "eventName", inListFilter: { values: [...counted] } },
      },
      limit: 10000,
    });
    for (const row of j2.rows ?? []) {
      const src = String(row.dimensionValues?.[0]?.value ?? "");
      if (!ENGINES.some((e) => e.re.test(src))) continue;
      if (isOrganicBing(src, String(row.dimensionValues?.[1]?.value ?? ""))) continue;
      conversions +=
        Number(row.metricValues?.[1]?.value ?? 0) - Number(row.metricValues?.[0]?.value ?? 0);
    }
  }
  return { sessions, conversions };
}

// Juengster Messlauf bis zum Periodenende.
async function sichtbarkeit(clientId: string, bis: string) {
  const { data } = await (supabaseAdmin as any)
    .from("ai_visibility_reports")
    .select("snapshot_date, score, mentions, citations")
    .eq("client_id", clientId)
    .lte("snapshot_date", bis)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export async function fetchAiOrganicZeile(
  c: { id: string; ga4_property?: string | null },
  f: Fenster,
): Promise<AiOverviewZeile<OrganicKpi>> {
  const hinweise: string[] = [];
  let tCur: { sessions: number; conversions: number } | null = null;
  let tPrev: { sessions: number; conversions: number } | null = null;
  try {
    const g = await ga4Zugang(c);
    if (!g) hinweise.push("Kein GA4 verbunden");
    else {
      const counted = await countedConversionEvents(c.id);
      [tCur, tPrev] = await Promise.all([
        kiTraffic(g, f.aktuell, counted),
        kiTraffic(g, f.vorher, counted),
      ]);
    }
  } catch (e) {
    hinweise.push(`GA4: ${String((e as any)?.message || e).slice(0, 120)}`);
  }
  const [sCur, sPrev] = await Promise.all([
    sichtbarkeit(c.id, f.aktuell.endDate),
    sichtbarkeit(c.id, f.vorher.endDate),
  ]);
  if (!sCur) hinweise.push("Noch kein KI-Messlauf");
  const kpi = (t: typeof tCur, s: any): OrganicKpi => ({
    kiBesucher: t ? t.sessions : null,
    kiConversions: t ? t.conversions : null,
    score: s?.score ?? null,
    mentions: s?.mentions ?? null,
    citations: s?.citations ?? null,
  });
  return {
    clientId: c.id,
    cur: kpi(tCur, sCur),
    // Vergleich der Sichtbarkeit nur, wenn es einen AELTEREN Lauf gibt.
    prev: kpi(tPrev, sPrev && sPrev.snapshot_date !== sCur?.snapshot_date ? sPrev : null),
    stand: { cur: sCur?.snapshot_date ?? null, prev: sPrev?.snapshot_date ?? null },
    hinweise,
    error: null,
  };
}

async function adsSummen(accountId: string, zr: Pick<Zeitraum, "startDate" | "endDate">) {
  const { data } = await (supabaseAdmin as any)
    .from("chatgpt_ads_insights_daily")
    .select("impressions, clicks, spend, conversions")
    .eq("account_id", accountId)
    .eq("scope", "campaign")
    .gte("date", zr.startDate)
    .lte("date", zr.endDate);
  let impressions = 0;
  let clicks = 0;
  let spend = 0;
  let conversions: number | null = null;
  for (const r of data || []) {
    impressions += Number(r.impressions || 0);
    clicks += Number(r.clicks || 0);
    spend += Number(r.spend || 0);
    if (r.conversions != null) conversions = (conversions ?? 0) + Number(r.conversions);
  }
  return { impressions, clicks, spend: Math.round(spend * 100) / 100, conversions };
}

async function ga4Cpc(
  g: { token: string; propertyId: string },
  zr: Pick<Zeitraum, "startDate" | "endDate">,
) {
  const j = await runReport(g.token, g.propertyId, {
    dateRanges: [ga4DateRange(zr)],
    metrics: [{ name: "sessions" }, { name: "keyEvents" }],
    dimensionFilter: {
      andGroup: {
        expressions: [
          {
            filter: {
              fieldName: "sessionSource",
              stringFilter: {
                matchType: "PARTIAL_REGEXP",
                value: GA4_SOURCE_RE,
                caseSensitive: false,
              },
            },
          },
          {
            filter: {
              fieldName: "sessionMedium",
              stringFilter: {
                matchType: "FULL_REGEXP",
                value: GA4_MEDIUM_RE,
                caseSensitive: false,
              },
            },
          },
        ],
      },
    },
  });
  const row = j.rows?.[0];
  return {
    sessions: Number(row?.metricValues?.[0]?.value ?? 0),
    conversions: Number(row?.metricValues?.[1]?.value ?? 0),
  };
}

export async function fetchAiAdsZeile(
  c: { id: string; ga4_property?: string | null },
  f: Fenster,
): Promise<AiOverviewZeile<AdsKpi>> {
  const { data: accs } = await (supabaseAdmin as any)
    .from("chatgpt_ads_accounts")
    .select("id, currency_code, is_mock, status, last_sync_error")
    .eq("client_id", c.id)
    .order("is_mock", { ascending: true })
    .limit(1);
  const acc = accs?.[0];
  if (!acc)
    return { clientId: c.id, cur: null, prev: null, keinKonto: true, hinweise: [], error: null };
  const hinweise: string[] = [];
  if (acc.last_sync_error) hinweise.push(`Sync: ${String(acc.last_sync_error).slice(0, 120)}`);
  const [aCur, aPrev] = await Promise.all([
    adsSummen(acc.id, f.aktuell),
    adsSummen(acc.id, f.vorher),
  ]);
  let gCur: { sessions: number; conversions: number } | null = null;
  let gPrev: { sessions: number; conversions: number } | null = null;
  try {
    const g = await ga4Zugang(c);
    if (!g) hinweise.push("Kein GA4 verbunden");
    else [gCur, gPrev] = await Promise.all([ga4Cpc(g, f.aktuell), ga4Cpc(g, f.vorher)]);
  } catch (e) {
    hinweise.push(`GA4: ${String((e as any)?.message || e).slice(0, 120)}`);
  }
  const kpi = (a: Awaited<ReturnType<typeof adsSummen>>, g: typeof gCur): AdsKpi => ({
    ...a,
    ga4Sessions: g ? g.sessions : null,
    ga4Conversions: g ? g.conversions : null,
  });
  return {
    clientId: c.id,
    cur: kpi(aCur, gCur),
    prev: kpi(aPrev, gPrev),
    currency: acc.currency_code || "CHF",
    demo: !!acc.is_mock,
    hinweise: acc.is_mock ? ["Demo-Konto (Testdaten)", ...hinweise] : hinweise,
    error: null,
  };
}
