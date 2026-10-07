// KI-Attribution aus GA4 (23.09.2026): aus admin.aivis-sync.ts (jobAttribution)
// herausgezogen und um den Zeitraum parametrisiert. Der naechtliche Lauf ruft
// weiterhin mit 30 Tagen (Snapshot in ai_visibility_attribution); die Route
// /api/admin/aivis-attribution liefert dieselben Zahlen live fuer den im Hub
// gewaehlten Zeitraum — damit der Datumsfilter im Conversions-Tab greift.
//
// Ergebnis je Engine: sessions (KI-Verweis-Sessions), conversions (keyEvents),
// events[] (einzelne Conversions mit Name/Land/Geraet/Datum/Wert, gedeckelt)
// und visitors[] (Top-Laender der Besucher).
//
// «Zaehlt als Conversion» (23.09.2026, Tabelle client_conversion_events): fuer
// dort hinterlegte Ereignisse zaehlt eventCount statt keyEvents — GA4 zaehlt
// Key Events erst ab der Markierung, das Rohereignis aber seit jeher. Damit
// sind z. B. form_submit-Sendungen aus KI-Quellen RUECKWIRKEND sichtbar. Der
// keyEvents-Anteil dieser Ereignisse wird ersetzt, nicht addiert (keine
// Doppelzaehlung ab der Markierung).
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
// Detailreport nur fuer KI-Quellen: haelt die Kardinalitaet klein — sonst
// aggregiert GA4 minutengenaue Zeilen (x Seite) ueber lange Zeitraeume zu
// "(other)", und "(other)" matcht keine Engine (23.09.2026).
const AI_SOURCE_FILTER = {
  filter: {
    fieldName: "sessionSource",
    stringFilter: {
      matchType: "PARTIAL_REGEXP",
      value: ENGINES.map((e) => e.re.source).join("|"),
      caseSensitive: false,
    },
  },
};

// Detailbericht (07.10.2026, La Campagnola): organische Bing-Suche und bezahlte
// Kanaele schon in der ABFRAGE ausschliessen — sonst fuellen Bing-SEO-Zeilen
// das Zeilenlimit, bevor die KI-Conversions kommen (Totale stimmten, Einzel-
// zeilen fehlten). Die Nachfilterung im Code bleibt als zweite Sicherung.
const DETAIL_FILTER = {
  andGroup: {
    expressions: [
      AI_SOURCE_FILTER,
      {
        notExpression: {
          andGroup: {
            expressions: [
              {
                filter: {
                  fieldName: "sessionSource",
                  stringFilter: {
                    matchType: "PARTIAL_REGEXP",
                    value: "(^|\\.)bing",
                    caseSensitive: false,
                  },
                },
              },
              {
                filter: {
                  fieldName: "sessionDefaultChannelGroup",
                  stringFilter: {
                    matchType: "PARTIAL_REGEXP",
                    value: "organic",
                    caseSensitive: false,
                  },
                },
              },
            ],
          },
        },
      },
      {
        notExpression: {
          filter: {
            fieldName: "sessionDefaultChannelGroup",
            stringFilter: {
              matchType: "PARTIAL_REGEXP",
              value: "^(paid|cross-network)",
              caseSensitive: false,
            },
          },
        },
      },
    ],
  },
};

// Bezahlter KI-Traffic (02.10.2026, Volkan): ChatGPT Ads kommen in GA4 als
// chatgpt / cpc an und landen im Standard-Kanal «Paid Search» bzw. «Paid
// Other» — sie gehoeren in den Ads-Report, nicht in die Organic-Zahlen.
// Erkennung ueber den Kanal (in allen Reports vorhanden), optional Medium.
export const istBezahlt = (channel: string, medium = "") =>
  /^(paid|cross-network)/i.test(String(channel || "").trim()) ||
  /^(cpc|ppc|cpm|cpv|paid.*|display|retargeting)$/i.test(String(medium || "").trim());

export const isOrganicBing = (src: string, channel: string) =>
  /(^|\.)bing\b/i.test(src) && !/copilot|chat|edgeservices/i.test(src) && /organic/i.test(channel);

// Seit 23.09.2026 je EINZELNE Conversion eine Zeile (count = 1): GA4 liefert
// Gruppen, wir fragen minutengenau (dateHourMinute) plus Stadt und Seite ab
// und loesen Rest-Gruppen (gleiche Minute) in Einzelzeilen auf.
export type AttributionEvent = {
  name: string;
  count: number;
  value: number;
  country: string;
  device: string;
  date: string; // YYYYMMDD
  time?: string; // HH:MM (Zeitzone der GA4-Property)
  city?: string;
  page?: string; // pagePath, auf der die Conversion ausgeloest wurde
  label?: string; // Anzeigename aus client_event_labels (z. B. «Suchformular»)
  txn?: string;
  currency?: string;
};

const MAX_EVENT_ROWS = 200; // je Engine, nach Datum absteigend

export type AttributionEngine = {
  engine: string;
  sessions: number;
  conversions: number;
  events: AttributionEvent[];
  visitors: Array<{ country: string; sessions: number }>;
};

export type AttributionResult =
  | { engines: AttributionEngine[]; detailError?: string; detailDebug?: string }
  | { skipped: string }
  | { error: string };

const GA4 = "https://analyticsdata.googleapis.com/v1beta";

async function conversionModus(
  clientId: string,
  modus: "zaehlt" | "ignoriert",
): Promise<Set<string>> {
  try {
    const { data } = await (supabaseAdmin as any)
      .from("client_conversion_events")
      .select("event_name")
      .eq("client_id", clientId)
      .eq("modus", modus);
    return new Set<string>((data ?? []).map((x: any) => String(x.event_name)));
  } catch {
    return new Set<string>();
  }
}
// «Zaehlt als Conversion»: Ereignis zaehlt mit eventCount (auch rueckwirkend).
export const countedConversionEvents = (clientId: string) => conversionModus(clientId, "zaehlt");
// «Zaehlt nicht» (06.10.2026): GA4-Key-Event wird im Hub ignoriert, z. B. aus
// Universal Analytics uebernommene Engagement-Ziele (excent: ua__4_seiten).
export const ignoredConversionEvents = (clientId: string) => conversionModus(clientId, "ignoriert");
const GA4_ADMIN = "https://analyticsadmin.googleapis.com/v1beta";

// Anzeigenamen je Ereignis (Admin Center -> Conversions -> «Anzeigename»).
export async function eventLabels(clientId: string): Promise<Map<string, string>> {
  try {
    const { data } = await (supabaseAdmin as any)
      .from("client_event_labels")
      .select("event_name, label")
      .eq("client_id", clientId);
    return new Map<string, string>(
      (data ?? [])
        .filter((x: any) => String(x.label ?? "").trim())
        .map((x: any) => [String(x.event_name), String(x.label).trim()]),
    );
  } catch {
    return new Map<string, string>();
  }
}

// ── Erstkontakt-Attribution (06.10.2026) ──────────────────────────────────
// Sitzungs-Attribution (fetchAttribution) zaehlt nur Conversions im SELBEN
// Besuch. Hier: Nutzer, deren ERSTER Besuch aus einer KI kam (firstUserSource),
// und deren Conversions ueber alle spaeteren Besuche, egal welcher Kanal —
// z. B. ChatGPT-Fund, Anfrage Tage spaeter direkt. Gleiche Regeln: bezahlte
// Erstkontakte (Ads) und organisches Bing zaehlen nicht; «zaehlt»/«ignoriert»
// wie in der Sitzungs-Attribution. Nur lesend.
export type ErstkontaktEngine = {
  engine: string;
  users: number;
  conversions: number;
  nachEreignis: Array<{ name: string; count: number; users: number }>;
};
export async function fetchErstkontakt(
  c: { id: string; ga4_property?: string | null },
  zr: Pick<Zeitraum, "startDate" | "endDate">,
): Promise<{ engines: ErstkontaktEngine[] } | { skipped: string } | { error: string }> {
  if (!c.ga4_property) return { skipped: "kein ga4_property" };
  let token: string;
  try {
    token = (await getGoogleAccessToken(c.id)).accessToken;
  } catch (e) {
    return { error: "Google-Token: " + redactSecrets(e) };
  }
  const propertyId = String(c.ga4_property).replace(/^properties\//, "");
  const [counted, ignored] = await Promise.all([
    countedConversionEvents(c.id),
    ignoredConversionEvents(c.id),
  ]);
  const run = async (body: unknown) => {
    const r = await fetch(`${GA4}/properties/${encodeURIComponent(propertyId)}:runReport`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok)
      throw new Error(`GA4 HTTP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
    return r.json().catch(() => ({}));
  };
  const quelleFilter = {
    filter: {
      fieldName: "firstUserSource",
      stringFilter: {
        matchType: "PARTIAL_REGEXP",
        value: ENGINES.map((e) => e.re.source).join("|"),
        caseSensitive: false,
      },
    },
  };
  try {
    const dateRanges = [ga4DateRange(zr)];
    const [ju, je] = await Promise.all([
      run({
        dateRanges,
        dimensions: [{ name: "firstUserSource" }, { name: "firstUserDefaultChannelGroup" }],
        metrics: [{ name: "totalUsers" }],
        dimensionFilter: quelleFilter,
        limit: 1000,
      }),
      run({
        dateRanges,
        dimensions: [
          { name: "firstUserSource" },
          { name: "firstUserDefaultChannelGroup" },
          { name: "eventName" },
        ],
        metrics: [{ name: "keyEvents" }, { name: "eventCount" }, { name: "totalUsers" }],
        dimensionFilter: quelleFilter,
        limit: 10000,
      }),
    ]);
    const out = new Map<string, ErstkontaktEngine>();
    const engineVon = (src: string, kanal: string) => {
      const eng = ENGINES.find((e) => e.re.test(src));
      if (!eng || isOrganicBing(src, kanal) || istBezahlt(kanal)) return null;
      if (!out.has(eng.name))
        out.set(eng.name, { engine: eng.name, users: 0, conversions: 0, nachEreignis: [] });
      return out.get(eng.name)!;
    };
    for (const row of ju.rows ?? []) {
      const e = engineVon(
        String(row.dimensionValues?.[0]?.value ?? ""),
        String(row.dimensionValues?.[1]?.value ?? ""),
      );
      if (e) e.users += Number(row.metricValues?.[0]?.value ?? 0);
    }
    for (const row of je.rows ?? []) {
      const e = engineVon(
        String(row.dimensionValues?.[0]?.value ?? ""),
        String(row.dimensionValues?.[1]?.value ?? ""),
      );
      if (!e) continue;
      const ev = String(row.dimensionValues?.[2]?.value ?? "");
      if (ignored.has(ev)) continue;
      const ke = Number(row.metricValues?.[0]?.value ?? 0);
      const ec = Number(row.metricValues?.[1]?.value ?? 0);
      const n = counted.has(ev) ? ec : ke;
      if (n <= 0) continue;
      e.conversions += n;
      const vorh = e.nachEreignis.find((x) => x.name === ev);
      const users = Number(row.metricValues?.[2]?.value ?? 0);
      if (vorh) {
        vorh.count += n;
        vorh.users += users;
      } else e.nachEreignis.push({ name: ev, count: n, users });
    }
    return { engines: [...out.values()].sort((a, b) => b.users - a.users) };
  } catch (e) {
    return { error: redactSecrets(e) };
  }
}

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
  const counted = await countedConversionEvents(c.id);
  const ignored = await ignoredConversionEvents(c.id);
  const labels = await eventLabels(c.id);
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
    if (istBezahlt(String(row.dimensionValues?.[2]?.value ?? ""))) continue;
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

  // Gezaehlte Ereignisse: eventCount ersetzt deren keyEvents-Anteil.
  if (counted.size || ignored.size) {
    try {
      const r3 = await fetch(`${GA4}/properties/${encodeURIComponent(propertyId)}:runReport`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          dateRanges,
          dimensions: [
            { name: "sessionSource" },
            { name: "sessionDefaultChannelGroup" },
            { name: "eventName" },
          ],
          metrics: [{ name: "keyEvents" }, { name: "eventCount" }],
          dimensionFilter: {
            filter: {
              fieldName: "eventName",
              inListFilter: { values: [...counted, ...ignored] },
            },
          },
          limit: 10000,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (r3.ok) {
        const j3: any = await r3.json().catch(() => ({}));
        for (const row of j3.rows ?? []) {
          const src = String(row.dimensionValues?.[0]?.value ?? "");
          const eng = ENGINES.find((e) => e.re.test(src));
          if (!eng) continue;
          if (isOrganicBing(src, String(row.dimensionValues?.[1]?.value ?? ""))) continue;
          if (istBezahlt(String(row.dimensionValues?.[1]?.value ?? ""))) continue;
          const ke = Number(row.metricValues?.[0]?.value ?? 0);
          const ec = Number(row.metricValues?.[1]?.value ?? 0);
          const ev = String(row.dimensionValues?.[2]?.value ?? "");
          agg[eng.name] ??= { sessions: 0, conversions: 0 };
          // gezaehlt: eventCount ersetzt keyEvents; ignoriert: keyEvents raus.
          if (ignored.has(ev)) agg[eng.name].conversions -= ke;
          else agg[eng.name].conversions += ec - ke;
        }
      }
    } catch {
      /* optional — keyEvents-Totale bleiben gueltig */
    }
  }

  // Detail: WELCHE Key-Events je Engine ausgeloest wurden — inkl. Land, Geraet,
  // Datum und Wert. Session-scoped ueber sessionSource. Buchungs-Setups (GTM)
  // senden den Betrag als Custom Dimension dl_value, dl_reservationid/
  // transactionId vereinzelt die Conversions.
  const events: Record<string, AttributionEvent[]> = {};
  let detailError: string | undefined;
  let detailDebug: string | undefined;
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
      // GA4 erlaubt max. 9 Dimensionen: Betrags-Dimensionen haben Vorrang,
      // Stadt/Seite fallen bei vollem Buchungs-Setup zuerst weg (get() liefert "").
      // rich 2 = minutengenau + Stadt + Seite, 1 = minutengenau + Seite,
      // 0 = Tagesgruppen (bisheriges Verhalten). GA4 unterdrueckt bei
      // Thresholding (Google Signals) feine Zeilen stillschweigend -> dann
      // kommt eine leere, aber gueltige Antwort; darum geht die Leiter auch
      // bei leerem Ergebnis weiter.
      const dims = (withCustom: boolean, rich: 0 | 1 | 2) =>
        [
          { name: "sessionSource" },
          { name: "eventName" },
          { name: "country" },
          { name: "deviceCategory" },
          { name: rich ? "dateHourMinute" : "date" },
          { name: "sessionDefaultChannelGroup" },
          ...(withCustom
            ? [
                { name: idDim },
                ...(hasDlValue ? [{ name: "customEvent:dl_value" }] : []),
                ...(hasDlCurrency ? [{ name: "customEvent:dl_currency" }] : []),
              ]
            : []),
          ...(rich === 2 ? [{ name: "city" }] : []),
          ...(rich ? [{ name: "pagePath" }] : []),
        ].slice(0, 9);
      const runDetail = (withCustom: boolean, rich: 0 | 1 | 2) =>
        fetch(`${GA4}/properties/${encodeURIComponent(propertyId)}:runReport`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            dateRanges,
            dimensions: dims(withCustom, rich),
            dimensionFilter: DETAIL_FILTER,
            // Ohne «zaehlt»-Rohereignisse genuegen Zeilen mit Key Events.
            ...(counted.size
              ? {}
              : {
                  metricFilter: {
                    filter: {
                      fieldName: "keyEvents",
                      numericFilter: { operation: "GREATER_THAN", value: { int64Value: "0" } },
                    },
                  },
                }),
            metrics: [
              { name: "keyEvents" },
              { name: "eventValue" },
              { name: "totalRevenue" },
              { name: "eventCount" },
            ],
            limit: 25000,
          }),
          signal: AbortSignal.timeout(30_000),
        });
      // Rueckfall-Leiter: reich mit/ohne Custom-Dimensionen, dann Tagesgruppen.
      // Der erste GA4-Fehlertext bleibt fuer die Diagnose erhalten (detailError).
      let j2: any = null;
      for (const [wc, rich] of [
        [true, 2],
        [true, 1],
        [false, 1],
        [true, 0],
        [false, 0],
      ] as Array<[boolean, 0 | 1 | 2]>) {
        const r2 = await runDetail(wc, rich);
        if (!r2.ok) {
          detailError ??= `GA4 ${r2.status} (custom=${wc}, rich=${rich}): ${(await r2.text().catch(() => "")).slice(0, 300)}`;
          continue;
        }
        const jj: any = await r2.json().catch(() => ({}));
        if ((jj.rows ?? []).length) {
          j2 = jj;
          break;
        }
        detailError ??= `leer (custom=${wc}, rich=${rich}, thresholding=${String(jj?.metadata?.subjectToThresholding ?? "?")})`;
      }
      if (j2) {
        const dh: string[] = (j2.dimensionHeaders ?? []).map((h: any) => String(h?.name ?? ""));
        detailDebug = `rows=${(j2.rows ?? []).length} dims=${dh.join(",")} first=${JSON.stringify(j2.rows?.[0] ?? null).slice(0, 400)}`;
        for (const row of j2.rows ?? []) {
          const get = (nm: string) => {
            const i = dh.indexOf(nm);
            return i >= 0 ? String(row.dimensionValues?.[i]?.value ?? "") : "";
          };
          const src = get("sessionSource");
          const eng = ENGINES.find((e) => e.re.test(src));
          const evName = get("eventName");
          // gezaehlte Ereignisse: Rohanzahl statt Key-Event-Anzahl (rueckwirkend)
          if (ignored.has(evName)) continue; // im Hub ignoriertes Key Event
          const n = Number(row.metricValues?.[counted.has(evName) ? 3 : 0]?.value ?? 0);
          if (
            !eng ||
            n <= 0 ||
            isOrganicBing(src, get("sessionDefaultChannelGroup")) ||
            istBezahlt(get("sessionDefaultChannelGroup"))
          )
            continue;
          const idRaw = get(idDim);
          const txn = idRaw && idRaw !== "(not set)" ? idRaw : undefined;
          const cur = get("customEvent:dl_currency");
          const dlVal = Number(get("customEvent:dl_value")) || 0;
          const man = manual.get(evName);
          // Betrags-Kaskade: dl_value > totalRevenue > eventValue > manueller Wert (x Anzahl).
          const gaVal =
            dlVal ||
            Number(row.metricValues?.[2]?.value ?? 0) ||
            Number(row.metricValues?.[1]?.value ?? 0);
          const val = gaVal || (man ? man.value * n : 0);
          const curFinal =
            (cur && cur !== "(not set)" ? cur : "") || (!gaVal && man ? man.currency : "");
          const dhm = get("dateHourMinute"); // YYYYMMDDHHMM
          const city = get("city");
          const page = get("pagePath");
          const basis = {
            name: evName,
            ...(labels.get(evName) ? { label: labels.get(evName) } : {}),
            count: 1,
            value: val / n,
            country: get("country"),
            device: get("deviceCategory"),
            // Tages-Stufe (rich 0) liefert «date» statt «dateHourMinute» (07.10.).
            date: dhm ? dhm.slice(0, 8) : get("date"),
            ...(dhm.length >= 12 ? { time: `${dhm.slice(8, 10)}:${dhm.slice(10, 12)}` } : {}),
            ...(city && city !== "(not set)" ? { city } : {}),
            ...(page && page !== "(not set)" ? { page } : {}),
            ...(txn ? { txn } : {}),
            ...(curFinal ? { currency: curFinal } : {}),
          };
          // Rest-Gruppe (mehrere in derselben Minute) -> Einzelzeilen.
          const list = (events[eng.name] ??= []);
          for (let i = 0; i < n && list.length < MAX_EVENT_ROWS * 2; i++) list.push({ ...basis });
        }
        for (const k of Object.keys(events))
          events[k] = events[k]
            .sort(
              (a, b) =>
                String(b.date).localeCompare(String(a.date)) ||
                String(b.time ?? "").localeCompare(String(a.time ?? "")),
            )
            .slice(0, MAX_EVENT_ROWS);
      }
    } catch (e) {
      /* Detail optional — Totale bleiben gueltig */
      detailError ??= "Detail: " + redactSecrets(e);
    }
  }
  return {
    ...(detailError ? { detailError } : {}),
    ...(detailDebug ? { detailDebug } : {}),
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
