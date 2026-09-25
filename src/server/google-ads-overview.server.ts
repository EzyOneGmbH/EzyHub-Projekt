import { adsApiBase } from "./google-ads-api.server";
import { getGoogleAccessToken } from "./google-tokens.server";
import { adsFenster, adsRows, type AdsZeitraum } from "./google-ads.server";
import { gaqlBetween, type Zeitraum } from "@/lib/date-range";

// Agentur-Performance-Tabelle (EzyPerformance, 25.09.2026): schlanke
// Kontokennzahlen je Kunde fuer Zeitraum + Vergleich — 4 GAQL-Abfragen statt
// des vollen Snapshots. Conversions getrennt nach Buchung und Allgemein.
// Nur lesend, nichts wird persistiert.

export type OverviewKennzahlen = {
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  bookings: number;
  bookingValue: number;
  /** Alle uebrigen (primaeren) Conversions = conversions - bookings. */
  general: number;
};

export type OverviewZeile = {
  clientId: string;
  cur: OverviewKennzahlen | null;
  prev: OverviewKennzahlen | null;
  error: string | null;
};

// Buchung = Conversion-Aktion der Kategorie «Kauf» (Buchungsmaschinen melden
// Hotelbuchungen als PURCHASE). Aktionen ohne sprechende Kategorie zaehlen nur
// per Name als Buchung — Anfragen/Leads («Buchungsanfrage») bewusst nicht.
const BUCHUNG_KATEGORIEN = new Set(["PURCHASE", "STORE_SALE"]);
const UNSPEZIFISCH = new Set(["", "DEFAULT", "UNKNOWN", "UNSPECIFIED"]);
const BUCHUNG_NAME = /buchung|booking|reservation|reservierung|purchase|kauf|bestellung/i;
const ANFRAGE_NAME = /anfrage|inquiry|enquiry|request|kontakt|contact|lead|formular|form/i;

export function istBuchung(category: unknown, name: unknown): boolean {
  const cat = String(category ?? "").toUpperCase();
  if (BUCHUNG_KATEGORIEN.has(cat)) return true;
  if (!UNSPEZIFISCH.has(cat)) return false;
  const n = String(name ?? "");
  return BUCHUNG_NAME.test(n) && !ANFRAGE_NAME.test(n);
}

/** customer-Zeile (metrics) → Grundkennzahlen. */
export function parseKontoTotals(
  rows: Array<any>,
): Omit<OverviewKennzahlen, "bookings" | "bookingValue" | "general"> {
  const out = { cost: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 };
  for (const row of rows) {
    const m = row?.metrics ?? {};
    out.cost += Number(m.costMicros ?? 0) / 1_000_000;
    out.impressions += Number(m.impressions ?? 0);
    out.clicks += Number(m.clicks ?? 0);
    out.conversions += Number(m.conversions ?? 0);
    out.conversionValue += Number(m.conversionsValue ?? 0);
  }
  return out;
}

/** Zeilen je Conversion-Aktion → Buchungen (Anzahl + Wert). */
export function parseBuchungen(rows: Array<any>): { bookings: number; bookingValue: number } {
  let bookings = 0;
  let bookingValue = 0;
  for (const row of rows) {
    const s = row?.segments ?? {};
    if (!istBuchung(s.conversionActionCategory, s.conversionActionName)) continue;
    bookings += Number(row?.metrics?.conversions ?? 0);
    bookingValue += Number(row?.metrics?.conversionsValue ?? 0);
  }
  return { bookings, bookingValue };
}

export function kombiniere(
  totals: ReturnType<typeof parseKontoTotals>,
  b: { bookings: number; bookingValue: number },
): OverviewKennzahlen {
  const bookings = Math.min(b.bookings, totals.conversions || b.bookings);
  return {
    ...totals,
    bookings,
    bookingValue: b.bookingValue,
    general: Math.max(0, totals.conversions - bookings),
  };
}

// Kurzzeit-Cache: Tab-Wechsel und Re-Renders sollen die Ads-API nicht erneut
// fuer jeden Kunden treffen.
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; zeile: OverviewZeile }>();

export async function fetchAdsOverviewZeile(
  clientId: string,
  googleAdsCustomer: string | null | undefined,
  range: AdsZeitraum,
  compareRange?: { start: string; end: string } | null,
): Promise<OverviewZeile> {
  const { aktuell, vorher } = adsFenster(range, compareRange);
  const key = `${clientId}|${aktuell.startDate}|${aktuell.endDate}|${vorher.startDate}|${vorher.endDate}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.zeile;

  const fehler = (error: string): OverviewZeile => ({ clientId, cur: null, prev: null, error });
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!devToken) return fehler("GOOGLE_ADS_DEVELOPER_TOKEN fehlt");
  const customerId = String(googleAdsCustomer ?? "").replace(/\D/g, "");
  if (!customerId) return fehler("Kein Google-Ads-Konto hinterlegt");
  const loginCustomerId = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "").replace(/\D/g, "");
  let accessToken: string;
  try {
    accessToken = (await getGoogleAccessToken(clientId)).accessToken;
  } catch {
    return fehler("Google nicht verbunden");
  }

  const query = async (gaql: string) => {
    const res = await fetch(`${adsApiBase()}/customers/${customerId}/googleAds:searchStream`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": devToken,
        "Content-Type": "application/json",
        ...(loginCustomerId ? { "login-customer-id": loginCustomerId } : {}),
      },
      body: JSON.stringify({ query: gaql }),
    });
    if (!res.ok) throw new Error(`Ads API HTTP ${res.status}`);
    return adsRows((await res.json()) as Array<{ results?: Array<any> }>);
  };
  const periode = async (z: Zeitraum): Promise<OverviewKennzahlen> => {
    const [tot, conv] = await Promise.all([
      query(
        `SELECT metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM customer WHERE ${gaqlBetween(z)}`,
      ),
      query(
        `SELECT segments.conversion_action_category, segments.conversion_action_name, metrics.conversions, metrics.conversions_value FROM customer WHERE ${gaqlBetween(z)}`,
      ),
    ]);
    return kombiniere(parseKontoTotals(tot), parseBuchungen(conv));
  };

  try {
    const [cur, prev] = await Promise.all([periode(aktuell), periode(vorher)]);
    const zeile: OverviewZeile = { clientId, cur, prev, error: null };
    cache.set(key, { at: Date.now(), zeile });
    return zeile;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fehler(msg.slice(0, 200));
  }
}
