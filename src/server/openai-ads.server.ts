// OpenAI Conversions API (ChatGPT Ads, 26.08.2026).
// Serverseitiges Conversion-Tracking: POST https://bzr.openai.com/v1/events?pid=<PIXEL>
// mit Bearer <Conversions-API-Key>. Der Key liegt Secretbox-verschluesselt in
// openai_ads_config.api_key_enc und verlaesst den Server nie.
//
// OpenAI-Regeln (Doku-Stand 08/2026): timestamp_ms max. 7 Tage alt und max.
// 10 Min. in der Zukunft; amount als Ganzzahl in der kleinsten Waehrungs-
// einheit; gleiche Event-ID wie das Browser-Pixel = Deduplication.

const OPENAI_CONVERSIONS_URL = "https://bzr.openai.com/v1/events";

export type OpenAiAdsEventRow = {
  event_id: string;
  event_type: string;
  oppref: string | null;
  obref: string | null;
  amount_cents: number | null;
  currency: string | null;
  source_url: string | null;
  action_source: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

/** DB-Zeile -> OpenAI-Event-Shape (Felder ohne Wert werden weggelassen). */
export function buildOpenAiEvent(row: OpenAiAdsEventRow): Record<string, unknown> {
  const p = (row.payload || {}) as Record<string, unknown>;
  const ev: Record<string, unknown> = {
    id: row.event_id,
    type: row.event_type,
    // OpenAI verlangt Event-Zeit <= 7 Tage — bei Retries alter Events wird die
    // Original-Zeit gesendet, solange sie im Fenster liegt, sonst gedeckelt.
    timestamp_ms: Math.max(
      Date.now() - 6.5 * 864e5,
      Math.min(Date.now(), new Date(row.created_at).getTime() || Date.now()),
    ),
    action_source: row.action_source || "web",
  };
  if (row.oppref) ev.oppref = row.oppref;
  if (row.source_url) ev.source_url = row.source_url;
  // user-Block: obref (First-Party-Cookie __obref) + optionale Matching-Daten
  // aus dem payload (nur bereits gehashte Felder werden durchgereicht).
  const user: Record<string, unknown> = {};
  if (row.obref) user.obref = row.obref;
  const pUser = (p.user || {}) as Record<string, unknown>;
  for (const k of ["email_sha256", "external_id_sha256", "country", "city", "zip_code"]) {
    if (pUser[k]) user[k] = pUser[k];
  }
  if (Object.keys(user).length) ev.user = user;
  // data-Block: Kauf mit Betrag -> contents-Shape, sonst customer_action.
  if (row.amount_cents != null && row.currency) {
    ev.data = {
      type: "contents",
      amount: row.amount_cents,
      currency: row.currency,
      ...(Array.isArray(p.contents) ? { contents: p.contents } : {}),
    };
  } else {
    ev.data = (p.data as Record<string, unknown>) || { type: "customer_action" };
  }
  return ev;
}

export type SendResult = { ok: boolean; status: number; response: unknown };

/** Sendet Events an die OpenAI Conversions API (validate_only fuer Tests). */
export async function sendConversionEvents(
  pixelId: string,
  apiKey: string,
  events: Array<Record<string, unknown>>,
  validateOnly = false,
): Promise<SendResult> {
  const r = await fetch(`${OPENAI_CONVERSIONS_URL}?pid=${encodeURIComponent(pixelId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ validate_only: validateOnly, events }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await r.text();
  let response: unknown;
  try {
    response = JSON.parse(text);
  } catch {
    response = { raw: text.slice(0, 2000) };
  }
  return { ok: r.ok, status: r.status, response };
}
