import { getGoogleAccessToken } from "./google-tokens.server";
import { zeitraum, vorperiode, istYmd, gaqlBetween, type Zeitraum } from "@/lib/date-range";

// Shared Google Ads data fetch used by both the live route (/api/google/ads-data)
// and the batch job (admin.populate jobGoogleAds), so the persisted snapshot
// shape stays identical. Requires GOOGLE_ADS_DEVELOPER_TOKEN; optional
// GOOGLE_ADS_LOGIN_CUSTOMER_ID (MCC) is sent as login-customer-id.

const ADS_API = "https://googleads.googleapis.com/v24";

export type AdsCampaign = {
  name: string;
  status: string;
  cost: number;
  clicks: number;
  impressions: number;
  conversions: number;
  conversionValue: number;
  roas: number;
};

export type AdsSnapshot = {
  days: number;
  /** Exakter, inklusiver Zeitraum (13.09.2026) */
  range: { from: string; to: string };
  prevRange: { from: string; to: string };
  totals: {
    cost: number;
    clicks: number;
    impressions: number;
    conversions: number;
    conversionValue: number;
  };
  ctr: number;
  cpc: number;
  cpa: number;
  roas: number;
  series: Array<{
    date: string;
    cost: number;
    clicks: number;
    impressions: number;
    conversions: number;
  }>;
  campaigns: AdsCampaign[];
  conversionActions: Array<{ name: string; count: number; value: number }>;
  primary: { name: string; count: number; value: number } | null;
  prev: {
    cost: number;
    clicks: number;
    impressions: number;
    conversions: number;
    conversionValue: number;
    ctr: number;
    cpc: number;
    primaryCount: number;
  };
  error: string | null;
};

/** Zeitraum-Eingabe: «letzte N Tage» (inklusive, endet heute) oder exakter Range. */
export type AdsZeitraum = number | { startDate: string; endDate: string };

/**
 * Aktuelles Fenster + Vergleichsfenster (13.09.2026, pure, vitest-gedeckt):
 * beide exakt und inklusiv, gleich lang, nahtlos — frueher war das aktuelle
 * Fenster [heute-N, heute] = N+1 Tage, das Vergleichsfenster N Tage.
 */
export function adsFenster(
  range: AdsZeitraum,
  compareRange?: { start?: string | null; end?: string | null } | null,
): { aktuell: Zeitraum; vorher: Zeitraum } {
  const aktuell =
    typeof range === "number"
      ? zeitraum({ days: range, maxDays: 366 })
      : zeitraum({ startDate: range.startDate, endDate: range.endDate, maxDays: 366 });
  const vorher =
    compareRange && istYmd(compareRange.start) && istYmd(compareRange.end)
      ? zeitraum({ startDate: compareRange.start, endDate: compareRange.end, maxDays: 366 })
      : vorperiode(aktuell);
  return { aktuell, vorher };
}

/**
 * Pull a full Google Ads snapshot for a client.
 * @returns { ok, result?, error?, skipped? }
 */
export async function fetchAdsSnapshot(
  clientId: string,
  googleAdsCustomer: string | null | undefined,
  range: AdsZeitraum,
  compareRange?: { start: string; end: string } | null,
): Promise<{ ok: boolean; result?: AdsSnapshot; error?: string; skipped?: string }> {
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!devToken) return { ok: false, skipped: "GOOGLE_ADS_DEVELOPER_TOKEN fehlt" };
  const customerId = String(googleAdsCustomer ?? "").replace(/\D/g, "");
  if (!customerId) return { ok: false, skipped: "keine google_ads_customer" };
  const loginCustomerId = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "").replace(/\D/g, "");

  let accessToken: string;
  try {
    const t = await getGoogleAccessToken(clientId);
    accessToken = t.accessToken;
  } catch {
    return { ok: false, skipped: "kein Google-Token" };
  }

  // Zeitfenster (13.09.2026): exakt, inklusiv, gleich lang (siehe adsFenster).
  const { aktuell, vorher } = adsFenster(range, compareRange);
  const days = aktuell.days;
  const dateFrom = aktuell.startDate;
  const dateTo = aktuell.endDate;
  const prevFrom = vorher.startDate;
  const prevTo = vorher.endDate;
  void gaqlBetween;

  let firstError: string | null = null;
  const query = async (gaql: string): Promise<Array<{ results?: Array<any> }>> => {
    const res = await fetch(`${ADS_API}/customers/${customerId}/googleAds:searchStream`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": devToken,
        "Content-Type": "application/json",
        ...(loginCustomerId ? { "login-customer-id": loginCustomerId } : {}),
      },
      body: JSON.stringify({ query: gaql }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Ads API HTTP ${res.status}: ${t.slice(0, 300)}`);
    }
    return (await res.json()) as Array<{ results?: Array<any> }>;
  };
  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      if (!firstError) firstError = e instanceof Error ? e.message : String(e);
      return fallback;
    }
  };

  // 1) Totals (current)
  const totals = { cost: 0, clicks: 0, impressions: 0, conversions: 0, conversionValue: 0 };
  await safe(async () => {
    const r = await query(
      `SELECT metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value FROM customer WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'`,
    );
    const m = r?.[0]?.results?.[0]?.metrics;
    if (m) {
      totals.cost = Number(m.costMicros ?? 0) / 1_000_000;
      totals.clicks = Number(m.clicks ?? 0);
      totals.impressions = Number(m.impressions ?? 0);
      totals.conversions = Number(m.conversions ?? 0);
      totals.conversionValue = Number(m.conversionsValue ?? 0);
    }
  }, undefined);

  // 2) Daily series
  const series = await safe(
    async () => {
      const r = await query(
        `SELECT segments.date, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM customer WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}' ORDER BY segments.date`,
      );
      return (r?.[0]?.results ?? []).map((row: any) => ({
        date: String(row.segments?.date ?? ""),
        cost: Number(row.metrics?.costMicros ?? 0) / 1_000_000,
        clicks: Number(row.metrics?.clicks ?? 0),
        impressions: Number(row.metrics?.impressions ?? 0),
        conversions: Number(row.metrics?.conversions ?? 0),
      }));
    },
    [] as AdsSnapshot["series"],
  );

  // 3) Campaigns (with revenue + ROAS)
  const campaigns = await safe(async () => {
    const r = await query(
      `SELECT campaign.name, campaign.status, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}' ORDER BY metrics.conversions_value DESC LIMIT 25`,
    );
    return (r?.[0]?.results ?? []).map((row: any): AdsCampaign => {
      const cost = Number(row.metrics?.costMicros ?? 0) / 1_000_000;
      const value = Number(row.metrics?.conversionsValue ?? 0);
      return {
        name: String(row.campaign?.name ?? ""),
        status: String(row.campaign?.status ?? "").replace("CAMPAIGN_STATUS_", ""),
        cost,
        clicks: Number(row.metrics?.clicks ?? 0),
        impressions: Number(row.metrics?.impressions ?? 0),
        conversions: Number(row.metrics?.conversions ?? 0),
        conversionValue: value,
        roas: cost > 0 ? value / cost : 0,
      };
    });
  }, [] as AdsCampaign[]);

  // 4) Conversion actions (current) — aggregate by action name
  const aggActions = (rows: Array<any>) => {
    const map = new Map<string, { name: string; count: number; value: number }>();
    for (const row of rows) {
      const name = String(row.segments?.conversionActionName ?? "").trim();
      if (!name) continue;
      const cur = map.get(name) ?? { name, count: 0, value: 0 };
      cur.count += Number(row.metrics?.conversions ?? 0);
      cur.value += Number(row.metrics?.conversionsValue ?? 0);
      map.set(name, cur);
    }
    return [...map.values()].sort((a, b) => b.value - a.value || b.count - a.count);
  };
  const conversionActions = await safe(
    async () => {
      const r = await query(
        `SELECT segments.conversion_action_name, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'`,
      );
      return aggActions(r?.[0]?.results ?? []);
    },
    [] as AdsSnapshot["conversionActions"],
  );
  const primary = conversionActions[0] ?? null;

  // 5) Totals (previous period)
  const prevTotals = { cost: 0, clicks: 0, impressions: 0, conversions: 0, conversionValue: 0 };
  await safe(async () => {
    const r = await query(
      `SELECT metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value FROM customer WHERE segments.date BETWEEN '${prevFrom}' AND '${prevTo}'`,
    );
    const m = r?.[0]?.results?.[0]?.metrics;
    if (m) {
      prevTotals.cost = Number(m.costMicros ?? 0) / 1_000_000;
      prevTotals.clicks = Number(m.clicks ?? 0);
      prevTotals.impressions = Number(m.impressions ?? 0);
      prevTotals.conversions = Number(m.conversions ?? 0);
      prevTotals.conversionValue = Number(m.conversionsValue ?? 0);
    }
  }, undefined);

  // 6) Conversion actions (previous) — only need the primary action's prev count
  let prevPrimaryCount = 0;
  if (primary) {
    await safe(async () => {
      const r = await query(
        `SELECT segments.conversion_action_name, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${prevFrom}' AND '${prevTo}'`,
      );
      const prevActions = aggActions(r?.[0]?.results ?? []);
      prevPrimaryCount = prevActions.find((a) => a.name === primary.name)?.count ?? 0;
    }, undefined);
  }

  const result: AdsSnapshot = {
    days,
    range: { from: dateFrom, to: dateTo },
    prevRange: { from: prevFrom, to: prevTo },
    totals,
    ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0,
    cpc: totals.clicks > 0 ? totals.cost / totals.clicks : 0,
    cpa: totals.conversions > 0 ? totals.cost / totals.conversions : 0,
    roas: totals.cost > 0 ? totals.conversionValue / totals.cost : 0,
    series,
    campaigns,
    conversionActions,
    primary,
    prev: {
      cost: prevTotals.cost,
      clicks: prevTotals.clicks,
      impressions: prevTotals.impressions,
      conversions: prevTotals.conversions,
      conversionValue: prevTotals.conversionValue,
      ctr: prevTotals.impressions > 0 ? (prevTotals.clicks / prevTotals.impressions) * 100 : 0,
      cpc: prevTotals.clicks > 0 ? prevTotals.cost / prevTotals.clicks : 0,
      primaryCount: prevPrimaryCount,
    },
    error: firstError,
  };

  return { ok: true, result };
}
