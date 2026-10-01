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
  const passend = (channels ?? []).filter(
    (ch) =>
      /^organic search$/i.test(String(ch.channel ?? "")) ||
      (mitKi && /^ai assistant$/i.test(String(ch.channel ?? ""))),
  );
  if (!passend.some((ch) => ch.revenue != null)) return { umsatz: gesamt, organisch: false };
  return {
    umsatz: passend.reduce((a, ch) => a + (Number(ch.revenue) || 0), 0),
    organisch: true,
  };
}
