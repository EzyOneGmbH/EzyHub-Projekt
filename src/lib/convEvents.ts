// Conversion-Events (01.10.2026, Morosani-Befund): GA4-E-Commerce-Funnel-
// Schritte sind KEINE Conversions. «begin_checkout» passte auf das Kauf-Muster
// (/checkout/) und zählte als Purchase — Morosani organisch 62 statt 37 Käufe.
// Geteilt von Live-Route, Populate-Snapshot und Conversions-Tab.

const FUNNEL_EVENT_RE =
  /^(begin_checkout|add_to_cart|remove_from_cart|view_cart|add_payment_info|add_shipping_info|add_to_wishlist|view_item|view_item_list|select_item|view_promotion|select_promotion)$/i;

/** GA4-Standard-Funnel-Schritt (Warenkorb, Checkout-Beginn …), kein Abschluss. */
export function isFunnelEvent(eventName: unknown): boolean {
  return FUNNEL_EVENT_RE.test(String(eventName ?? "").trim());
}

type Kanal = { channel?: string; revenue?: number | string | null };

/**
 * Umsatz für die Kachel «Generated»: nur Organic Search (EzyRank) bzw.
 * Organic Search + AI Assistant (EzyAI). Fehlt der Kanal-Split oder der
 * Kanal-Umsatz, gilt der Gesamtumsatz (`organisch: false`).
 */
export function generatedUmsatz(
  channels: Kanal[] | null | undefined,
  mitKi: boolean,
  gesamt: number,
): { umsatz: number; organisch: boolean } {
  const passend = (channels ?? []).filter((ch) => istOrganischerKanal(ch.channel, mitKi));
  if (!passend.some((ch) => ch.revenue != null)) return { umsatz: gesamt, organisch: false };
  return {
    umsatz: passend.reduce((a, ch) => a + (Number(ch.revenue) || 0), 0),
    organisch: true,
  };
}

export type ConvBreakdown = { phone: number; mail: number; maps: number; contact: number };
export type ConvBucket = keyof ConvBreakdown;

/** Kanäle, die als «organisch» zählen: Organic Search, in EzyAI plus AI Assistant. */
export function istOrganischerKanal(channel: unknown, mitKi: boolean): boolean {
  const ch = String(channel ?? "");
  return /^organic search$/i.test(ch) || (mitKi && /^ai assistant$/i.test(ch));
}

/**
 * Lead-Breakdown je GA4-Kanal (01.10.2026): Zeilen eventName × Kanal →
 * { Kanal: {phone, mail, maps, contact} }. Funnel-Schritte zählen nie.
 */
export function breakdownJeKanal(
  rows: Array<{ eventName: string; channel: string; count: number }>,
  bucketOf: (eventName: string) => ConvBucket | null,
): Record<string, ConvBreakdown> {
  const out: Record<string, ConvBreakdown> = {};
  for (const r of rows) {
    if (isFunnelEvent(r.eventName)) continue;
    const b = bucketOf(r.eventName);
    if (!b) continue;
    const ch = r.channel || "(other)";
    out[ch] ??= { phone: 0, mail: 0, maps: 0, contact: 0 };
    out[ch][b] += Number(r.count) || 0;
  }
  return out;
}

/**
 * Organischer Lead-Breakdown für die Kacheln Phone/Mail/Maps/Contact.
 * null = Snapshot ohne Kanal-Aufteilung (ältere Läufe) → Aufrufer zeigt den
 * Gesamtwert und beschriftet ihn als «alle Kanäle».
 */
export function organischerBreakdown(
  jeKanal: Record<string, Partial<ConvBreakdown>> | null | undefined,
  mitKi: boolean,
): ConvBreakdown | null {
  if (!jeKanal || typeof jeKanal !== "object") return null;
  const sum: ConvBreakdown = { phone: 0, mail: 0, maps: 0, contact: 0 };
  for (const [ch, b] of Object.entries(jeKanal)) {
    if (!istOrganischerKanal(ch, mitKi) || !b) continue;
    for (const k of Object.keys(sum) as ConvBucket[]) sum[k] += Number(b[k]) || 0;
  }
  return sum;
}

/**
 * Käufe als Transaktionen zählen (02.10.2026, Morosani: doppelt feuernde
 * Kauf-Tags blähten die Event-Zahl ~3,5-fach auf). Für `purchase` gilt die Zahl
 * eindeutiger Buchungsnummern (GA4 `transactions`), sofern vorhanden; sonst und
 * für alle anderen Events die Event-Zahl.
 */
export function kaufZaehler(
  eventName: unknown,
  eventCount: number,
  transactions: number | null,
): number {
  if (String(eventName ?? "") === "purchase" && transactions != null && transactions > 0) {
    return transactions;
  }
  return eventCount;
}

export type KaufJeKanal = Record<string, { keyEvents: number; transactions: number }>;

/**
 * Kanal-Conversions (Key Events) um doppelte `purchase`-Events bereinigen:
 * Conversions − purchase-Key-Events + Transaktionen. Nur wenn `purchase` in dem
 * Kanal als Key Event zählt und Transaktionen hat; sonst unverändert.
 */
export function kanaeleKaeufeBereinigt<T extends { channel?: string; conversions?: number | null }>(
  channels: T[],
  kauf: KaufJeKanal | null | undefined,
): T[] {
  if (!kauf) return channels;
  return channels.map((ch) => {
    const k = kauf[String(ch.channel ?? "")];
    if (!k || ch.conversions == null || !(k.keyEvents > 0) || !(k.transactions > 0)) return ch;
    return {
      ...ch,
      conversions: Math.max(0, Number(ch.conversions) - k.keyEvents + k.transactions),
    };
  });
}

type Ga4Call = (body: unknown) => Promise<{
  rows?: Array<{
    dimensionValues?: Array<{ value?: string }>;
    metricValues?: Array<{ value?: string }>;
  }>;
}>;

/** purchase je Kanal: Key Events + Transaktionen. null = Abfrage nicht möglich. */
export async function ladeKaufJeKanal(
  call: Ga4Call,
  dateRanges: unknown,
): Promise<KaufJeKanal | null> {
  try {
    const r = await call({
      dateRanges,
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "keyEvents" }, { name: "transactions" }],
      dimensionFilter: { filter: { fieldName: "eventName", stringFilter: { value: "purchase" } } },
    });
    const out: KaufJeKanal = {};
    for (const row of r.rows ?? []) {
      out[row.dimensionValues?.[0]?.value ?? "(other)"] = {
        keyEvents: Number(row.metricValues?.[0]?.value ?? 0) || 0,
        transactions: Number(row.metricValues?.[1]?.value ?? 0) || 0,
      };
    }
    return out;
  } catch {
    return null;
  }
}

// ── Zählregeln (02.10.2026, GTM-Conversion-Audit) ─────────────────────────────
// Vorher zu grob: «form» zählte form_start/form_aborted, «submit» Suche und
// Newsletter, «tel» ohne Wortgrenze traf «Bestellen»/«Hotels», «kauf» Ticket-
// Klicks; Müll-Events (gtm.dom, Mews distributor*/ga4_*, Eventname = Mess-ID)
// wurden mitgezählt; Anfragen wie booking_request/seminar_request fehlten.

const MUELL_RE = /^(gtm\.|ga4_|distributor)|^G-[A-Z0-9]{6,}$|^google_analytics$/i;
const KEIN_LEAD_RE =
  /^form_(start|aborted?|abandon\w*|submit|interaction)$|search|newsletter|signup|sign_up|login/i;

/** Technische oder fehlkonfigurierte Events, die nie als Conversion zählen. */
export function isMuellEvent(eventName: unknown): boolean {
  return MUELL_RE.test(String(eventName ?? "").trim());
}

const BUCKET_RE: Array<{ key: ConvBucket; re: RegExp }> = [
  // «tel» nur am Wortanfang (nicht «Bes-tel-len», «Ho-tel-s»); phone/call/anruf überall
  { key: "phone", re: /phone|call|anruf|(^|[^a-z])tel/i },
  { key: "mail", re: /mail/i },
  { key: "maps", re: /(^|[^a-z])map|route|direction|wegbeschreibung|standort/i },
  {
    key: "contact",
    re: /contact|kontakt|lead|anfrage|offerte|offer|quote|request|formular|form_submitted|form_success|reserv/i,
  },
];

/** Lead-Kategorie eines GA4-Events (Phone/Mail/Maps/Contact) oder null. */
export function convBucketVon(eventName: unknown): ConvBucket | null {
  const n = String(eventName ?? "").trim();
  if (!n || isMuellEvent(n) || isFunnelEvent(n) || KEIN_LEAD_RE.test(n)) return null;
  return BUCKET_RE.find((b) => b.re.test(n))?.key ?? null;
}

/** Abschluss-Event (Kauf/Buchung), keine Funnel-Schritte, kein Ticket-«Kaufen»-Klick. */
export function isKaufEvent(eventName: unknown): boolean {
  const n = String(eventName ?? "").trim();
  if (!n || isMuellEvent(n) || isFunnelEvent(n)) return false;
  return /purchase|transaction|^order$|_order$|^order_/i.test(n);
}
