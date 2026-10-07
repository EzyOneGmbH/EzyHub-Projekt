import { adsApiBase } from "./google-ads-api.server";
import { getGoogleAccessToken } from "./google-tokens.server";
import { adsRows } from "./google-ads.server";
import { istBuchung } from "./ads-buchung";
import { cacheLesen, cacheSchreiben } from "./uebersicht-cache.server";
import { gaqlBetween, type Zeitraum } from "@/lib/date-range";

// Kanal-Tabelle Conversions (07.10.2026, Volkan): bei EzyPerformance-Kunden
// ersetzen die Google-Ads-Zahlen die GA4-Zeilen «Paid Search» und
// «Cross-network» — gleiche Quelle wie EzyPerformance (Attribution Google Ads).
// Search-Kampagnen → Paid Search, alle uebrigen (PMax, Demand Gen, Display,
// Video, Shopping) → Cross-network (so ordnet GA4 sie auch ein). Nur lesend.

export type AdsKanalWerte = {
  clicks: number;
  cost: number;
  conversions: number;
  conversionValue: number;
  bookings: number;
  bookingValue: number;
};
export type AdsKanaele = { paidSearch: AdsKanalWerte; crossNetwork: AdsKanalWerte };

const leer = (): AdsKanalWerte => ({
  clicks: 0,
  cost: 0,
  conversions: 0,
  conversionValue: 0,
  bookings: 0,
  bookingValue: 0,
});

export function adsKanalVonTyp(typ: unknown): keyof AdsKanaele {
  return String(typ ?? "").toUpperCase() === "SEARCH" ? "paidSearch" : "crossNetwork";
}

/** campaign-Zeilen (Kennzahlen) + campaign×Conversion-Aktion-Zeilen → je Kanal. */
export function parseAdsKanaele(kampagnen: Array<any>, aktionen: Array<any>): AdsKanaele {
  const out: AdsKanaele = { paidSearch: leer(), crossNetwork: leer() };
  for (const row of kampagnen) {
    const k = out[adsKanalVonTyp(row?.campaign?.advertisingChannelType)];
    const m = row?.metrics ?? {};
    k.clicks += Number(m.clicks ?? 0);
    k.cost += Number(m.costMicros ?? 0) / 1_000_000;
    k.conversions += Number(m.conversions ?? 0);
    k.conversionValue += Number(m.conversionsValue ?? 0);
  }
  for (const row of aktionen) {
    const s = row?.segments ?? {};
    if (!istBuchung(s.conversionActionCategory, s.conversionActionName)) continue;
    const k = out[adsKanalVonTyp(row?.campaign?.advertisingChannelType)];
    k.bookings += Number(row?.metrics?.conversions ?? 0);
    k.bookingValue += Number(row?.metrics?.conversionsValue ?? 0);
  }
  return out;
}

export async function fetchAdsKanaele(
  clientId: string,
  googleAdsCustomer: string | null | undefined,
  z: Zeitraum,
): Promise<{ ok: true; kanaele: AdsKanaele } | { ok: false; error: string }> {
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!devToken) return { ok: false, error: "GOOGLE_ADS_DEVELOPER_TOKEN fehlt" };
  const customerId = String(googleAdsCustomer ?? "").replace(/\D/g, "");
  if (!customerId) return { ok: false, error: "Kein Google-Ads-Konto hinterlegt" };
  const key = `kanaele|${clientId}|${customerId}|${z.startDate}|${z.endDate}`;
  const hit = await cacheLesen<AdsKanaele>("ads", key);
  if (hit) return { ok: true, kanaele: hit };
  const loginCustomerId = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "").replace(/\D/g, "");
  let accessToken: string;
  try {
    accessToken = (await getGoogleAccessToken(clientId)).accessToken;
  } catch {
    return { ok: false, error: "Google nicht verbunden" };
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
  try {
    const [kampagnen, aktionen] = await Promise.all([
      query(
        `SELECT campaign.advertising_channel_type, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign WHERE ${gaqlBetween(z)}`,
      ),
      query(
        `SELECT campaign.advertising_channel_type, segments.conversion_action_category, segments.conversion_action_name, metrics.conversions, metrics.conversions_value FROM campaign WHERE ${gaqlBetween(z)}`,
      ),
    ]);
    const kanaele = parseAdsKanaele(kampagnen, aktionen);
    await cacheSchreiben("ads", key, clientId, kanaele);
    return { ok: true, kanaele };
  } catch (e) {
    return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
}
