// KI-Attribution aus GA4 (23.09.2026): aus admin.aivis-sync.ts (jobAttribution)
// herausgezogen und um den Zeitraum parametrisiert. Der naechtliche Lauf ruft
// weiterhin mit 30 Tagen (Snapshot in ai_visibility_attribution); die Route
// /api/admin/aivis-attribution liefert dieselben Zahlen live fuer den im Hub
// gewaehlten Zeitraum — damit der Datumsfilter im Conversions-Tab greift.
//
// Ergebnis je Engine: sessions (KI-Verweis-Sessions), conversions (keyEvents),
// events[] (einzelne Conversions mit Name/Land/Geraet/Datum/Wert, gedeckelt)
// und visitors[] (Top-Laender der Besucher).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "@/server/google-tokens.server";
import { redactSecrets } from "@/server/google-oauth.server";
import { ga4DateRange, type Zeitraum } from "@/lib/date-range";

export const ENGINES: Array<{ name: string; re: RegExp }> = [
  { name: "ChatGPT", re: /chatgpt|openai/i },
  { name: "Perplexity", re: /perplexity/i },
  { name: "Gemini", re: /gemini|bard/i },
  { name: "Claude", re: /claude|anthropic/i },
  { name: "Copilot", re: /copilot|bing|edgeservices/i },
  { name: "Grok", re: /grok|x\.ai/i },
  { name: "DeepSeek", re: /deepseek/i },
];
// Bing-Sonderfall (06.08.): plain "bing" aus der ORGANISCHEN Bing-Suche ist
// klassisches SEO, kein KI-Traffic — sonst zaehlt Bing-SEO als Copilot.
export const isOrganicBing = (src: string, channel: string) =>
  /(^|\.)bing\b/i.test(src) && !/copilot|chat|edgeservices/i.test(src) && /organic/i.test(channel);

export type AttributionEvent = {
  name: string;
  count: number;
  value: number;
  country: string;
  device: string;
  date: string;
  txn?: string;
  currency?: string;
};

export type AttributionEngine = {
  engine: string;
  sessions: number;
  conversions: number;
  events: AttributionEvent[];
  visitors: Array<{ country: string; sessions: number }>;
};

export type AttributionResult =
  | { engines: AttributionEngine[] }
  | { skipped: string }
  | { error: string };

const GA4 = "https://analyticsdata.googleapis.com/v1beta";
const GA4_ADMIN = "https://analyticsadmin.googleapis.com/v1beta";

export async function fetchAttribution(
  c: { id: string; ga4_property?: string | null },
  zr: Pick<Zeitraum, "startDate" | "endDate">,
): Promise<AttributionResult> {
  if (!c.ga4_property) return { skipped: "kein ga4_property" };
  let token: string;
  try {
    token = (await getGoogleAccessToken(c.id)).accessToken;
  } catch (e) {
    return { error: "Google-Token: " + redactSecrets(e) };
  }
  const propertyId = String(c.ga4_property).replace(/^properties\//, "");
  const dateRanges = [ga4DateRange(zr)];
  let r: Response;
  try {
    r = await fetch(`${GA4}/properties/${encodeURIComponent(propertyId)}:runReport`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRanges,
        // country zusaetzlich: liefert die Besucher-Herkunft je Engine
        // (Totale werden hier selbst aufsummiert — sessions/keyEvents sind additiv).
        // channelGroup fuer den Bing-Sonderfall (organische Bing-Suche != Copilot).
        dimensions: [
          { name: "sessionSource" },
          { name: "country" },
          { name: "sessionDefaultChannelGroup" },
        ],
        metrics: [{ name: "sessions" }, { name: "keyEvents" }],
        limit: 10000,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    return { error: "GA4 fetch: " + redactSecrets(e) };
  }
  if (!r.ok) return { error: `GA4 HTTP ${r.status}` };
  const json: any = await r.json().catch(() => ({}));
  const agg: Record<string, { sessions: number; conversions: number }> = {};
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

  // Detail: WELCHE Key-Events je Engine ausgeloest wurden — inkl. Land, Geraet,
  // Datum und Wert. Session-scoped ueber sessionSource. Buchungs-Setups (GTM)
  // senden den Betrag als Custom Dimension dl_value, dl_reservationid/
  // transactionId vereinzelt die Conversions.
  const events: Record<string, AttributionEvent[]> = {};
  if (Object.values(agg).some((v) => v.conversions > 0)) {
    try {
      const custom = new Set<string>();
      try {
        const rd = await fetch(
          `${GA4_ADMIN}/properties/${encodeURIComponent(propertyId)}/customDimensions?pageSize=200`,
          { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
        );
        if (rd.ok) {
          const jd: any = await rd.json().catch(() => ({}));
          for (const d of jd.customDimensions ?? [])
            if (d?.scope === "EVENT") custom.add(String(d.parameterName || ""));
        }
      } catch {
        /* Erkennung optional — Fallback unten deckt alles ab */
      }
      const hasDlValue = custom.has("dl_value");
      const hasDlCurrency = custom.has("dl_currency");
      // Manuell hinterlegte Conversion-Werte — letzte Stufe der Betrags-Kaskade.
      const manual = new Map<string, { value: number; currency: string }>();
      try {
        const { data: mv } = await (supabaseAdmin as any)
          .from("client_conversion_values")
          .select("event_name, value, currency")
          .eq("client_id", c.id);
        for (const m of mv ?? [])
          manual.set(String(m.event_name), {
            value: Number(m.value),
            currency: String(m.currency || "CHF"),
          });
      } catch {
        /* optional */
      }
      const idDim = custom.has("dl_reservationid")
        ? "customEvent:dl_reservationid"
        : "transactionId";
      const dims = (withCustom: boolean) => [
        { name: "sessionSource" },
        { name: "eventName" },
        { name: "country" },
        { name: "deviceCategory" },
        { name: "date" },
        { name: "sessionDefaultChannelGroup" },
        ...(withCustom
          ? [
              { name: idDim },
              ...(hasDlValue ? [{ name: "customEvent:dl_value" }] : []),
              ...(hasDlCurrency ? [{ name: "customEvent:dl_currency" }] : []),
            ]
          : []),
      ];
      const runDetail = (withCustom: boolean) =>
        fetch(`${GA4}/properties/${encodeURIComponent(propertyId)}:runReport`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            dateRanges,
            dimensions: dims(withCustom),
            metrics: [{ name: "keyEvents" }, { name: "eventValue" }, { name: "totalRevenue" }],
            limit: 5000,
          }),
          signal: AbortSignal.timeout(30_000),
        });
      let r2 = await runDetail(true);
      // Unbekannte Custom-Dimension o. Ae. -> einmal ohne Zusatz-Dimensionen.
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
          // Betrags-Kaskade: dl_value > totalRevenue > eventValue > manueller Wert (x Anzahl).
          const gaVal =
            dlVal ||
            Number(row.metricValues?.[2]?.value ?? 0) ||
            Number(row.metricValues?.[1]?.value ?? 0);
          const val = gaVal || (man ? man.value * n : 0);
          const curFinal =
            (cur && cur !== "(not set)" ? cur : "") || (!gaVal && man ? man.currency : "");
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
        for (const k of Object.keys(events))
          events[k] = events[k]
            .sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.count - a.count)
            .slice(0, 100);
      }
    } catch {
      /* Detail optional — Totale bleiben gueltig */
    }
  }
  return {
    engines: Object.entries(agg).map(([engine, v]) => ({
      engine,
      ...v,
      events: events[engine] ?? [],
      visitors: Object.entries(visitors[engine] ?? {})
        .map(([country, sessions]) => ({ country, sessions }))
        .sort((a, b) => b.sessions - a.sessions)
        .slice(0, 50),
    })),
  };
}
