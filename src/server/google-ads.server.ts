import { adsApiBase } from "./google-ads-api.server";
import { getGoogleAccessToken } from "./google-tokens.server";
import { zeitraum, vorperiode, istYmd, gaqlBetween, type Zeitraum } from "@/lib/date-range";

// Shared Google Ads data fetch used by both the live route (/api/google/ads-data)
// and the batch job (admin.populate jobGoogleAds), so the persisted snapshot
// shape stays identical. Requires GOOGLE_ADS_DEVELOPER_TOKEN; optional
// GOOGLE_ADS_LOGIN_CUSTOMER_ID (MCC) is sent as login-customer-id.

// Basis-URL zentral versioniert (21.09.2026): google-ads-api.server.ts (v25; Env-Override GOOGLE_ADS_API_VERSION).

export type AdsCampaign = {
  name: string;
  status: string;
  cost: number;
  clicks: number;
  impressions: number;
  conversions: number;
  conversionValue: number;
  roas: number;
  /** v25 (21.09.2026, nur lesend): Brand Guidelines aktiv (nur PMax) / NCA-Ziel verknuepft */
  brandGuidelinesEnabled?: boolean;
  ncaGoalActive?: boolean;
};

/** cart_data_sales_view (v24+): Produktebene-Conversions aus Warenkorbdaten. */
export type AdsCartProduct = {
  itemId: string;
  title: string;
  orders: number;
  unitsSold: number;
  /** metrics.revenue_micros (biddable) in Kontowaehrung */
  revenue: number;
  grossProfit: number;
  /** metrics.all_revenue_micros — inkl. nicht-biddable Conversion-Aktionen */
  allRevenue: number;
};

/**
 * Biddable vs. nur Reporting (v24/v25): metrics.conversions zaehlt nur Aktionen
 * mit conversion_action.include_in_conversions_metric=true (Gebotsoptimierung),
 * metrics.all_conversions zaehlt alle. Ein eigenes non_biddable_*-Feld gibt es
 * in v25 NICHT — «nur Reporting» ist die Differenz all - biddable.
 */
export type AdsConversionSplit = {
  biddable: { count: number; value: number };
  reportingOnly: { count: number; value: number };
  all: { count: number; value: number };
  actions: Array<{ name: string; biddable: boolean; count: number; value: number }>;
};

/** v25, nur lesend: Campaign.brand_guidelines_enabled + campaign_goal_config (NCA). */
export type AdsCampaignFlags = {
  id: string;
  name: string;
  channelType: string;
  brandGuidelinesEnabled: boolean;
  ncaGoalActive: boolean;
};

/** Optionale Zusatzbloecke (fail-soft): Fehler landen in errors, nie im Snapshot-Fehler. */
export type AdsExtras = {
  cartProducts: AdsCartProduct[] | null;
  conversionSplit: AdsConversionSplit | null;
  campaignFlags: AdsCampaignFlags[] | null;
  errors: string[];
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
  /** 21.09.2026 (API-Stand v25): Produkt-Report, Conversion-Split, Kampagnen-Flags */
  extras?: AdsExtras;
  error: string | null;
};

// ── Zusatz-Reports (21.09.2026, v25) — pure Parser, vitest-gedeckt ──────────
const MICROS = 1_000_000;

/** searchStream liefert Chunks {results:[...]} — flach machen. */
export function adsRows(r: Array<{ results?: Array<any> }> | null | undefined): Array<any> {
  return (r ?? []).flatMap((b) => b?.results ?? []);
}

/** cart_data_sales_view: Zeilen → Top-Produkte nach Umsatz (revenue_micros). */
export function parseCartProducts(rows: Array<any>): AdsCartProduct[] {
  const out: AdsCartProduct[] = [];
  for (const row of rows) {
    const itemId = String(row?.segments?.productItemId ?? "").trim();
    const title = String(row?.segments?.productTitle ?? "").trim();
    if (!itemId && !title) continue;
    const m = row?.metrics ?? {};
    out.push({
      itemId,
      title,
      orders: Number(m.orders ?? 0),
      unitsSold: Number(m.unitsSold ?? 0),
      revenue: Number(m.revenueMicros ?? 0) / MICROS,
      grossProfit: Number(m.grossProfitMicros ?? 0) / MICROS,
      allRevenue: Number(m.allRevenueMicros ?? 0) / MICROS,
    });
  }
  return out.sort((a, b) => b.revenue - a.revenue || b.orders - a.orders);
}

/** conversion_action-Zeilen (all_conversions je Aktion + include_in_conversions_metric). */
export function parseConversionSplit(rows: Array<any>): AdsConversionSplit {
  const map = new Map<string, { name: string; biddable: boolean; count: number; value: number }>();
  for (const row of rows) {
    const name = String(row?.conversionAction?.name ?? "").trim();
    if (!name) continue;
    const cur = map.get(name) ?? {
      name,
      biddable: row?.conversionAction?.includeInConversionsMetric === true,
      count: 0,
      value: 0,
    };
    cur.count += Number(row?.metrics?.allConversions ?? 0);
    cur.value += Number(row?.metrics?.allConversionsValue ?? 0);
    map.set(name, cur);
  }
  const actions = [...map.values()].sort((a, b) => b.count - a.count || b.value - a.value);
  const summe = (f: (a: (typeof actions)[number]) => boolean) =>
    actions.filter(f).reduce((s, a) => ({ count: s.count + a.count, value: s.value + a.value }), {
      count: 0,
      value: 0,
    });
  return {
    biddable: summe((a) => a.biddable),
    reportingOnly: summe((a) => !a.biddable),
    all: summe(() => true),
    actions,
  };
}

/** campaign-Zeilen (brand_guidelines_enabled) + campaign_goal_config-Zeilen (NCA-Ziel). */
export function parseCampaignFlags(campRows: Array<any>, goalRows: Array<any>): AdsCampaignFlags[] {
  const nca = new Set<string>();
  for (const g of goalRows) {
    const cfg = g?.campaignGoalConfig ?? {};
    const id =
      String(cfg.campaign ?? "")
        .split("/")
        .pop() ?? "";
    const istNca =
      /NEW_CUSTOMER_ACQUISITION/i.test(String(cfg.goalType ?? "")) ||
      cfg.campaignNewCustomerAcquisitionSettings != null;
    if (id && istNca) nca.add(id);
  }
  return campRows
    .map((r) => {
      const id = String(r?.campaign?.id ?? "");
      return {
        id,
        name: String(r?.campaign?.name ?? ""),
        channelType: String(r?.campaign?.advertisingChannelType ?? ""),
        brandGuidelinesEnabled: r?.campaign?.brandGuidelinesEnabled === true,
        ncaGoalActive: nca.has(id),
      };
    })
    .filter((f) => f.name);
}

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

  let firstError: string | null = null;
  const query = async (gaql: string): Promise<Array<{ results?: Array<any> }>> => {
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

  // 7) Zusatzbloecke (21.09.2026, API-Stand v25) — fail-soft: jeder Block
  //    einzeln, Fehler landen in extras.errors und beruehren weder firstError
  //    noch den bestehenden Snapshot. Zeitraum ueber gaqlBetween (inklusiv).
  const extras: AdsExtras = {
    cartProducts: null,
    conversionSplit: null,
    campaignFlags: null,
    errors: [],
  };
  const zusatz = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      extras.errors.push(`${label}: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`);
    }
  };
  const between = gaqlBetween(aktuell);
  // a) cart_data_sales_view (v24+): Top-Produkte nach Umsatz. Erst mit
  //    product_title; faellt die Abfrage (Feld/Recht), Rueckfall auf item_id.
  await zusatz("cart_data_sales_view", async () => {
    const felder =
      "metrics.orders, metrics.units_sold, metrics.revenue_micros, metrics.gross_profit_micros, metrics.all_revenue_micros";
    const gaql = (mitTitel: boolean) =>
      `SELECT segments.product_item_id${mitTitel ? ", segments.product_title" : ""}, ${felder} FROM cart_data_sales_view WHERE ${between} ORDER BY metrics.revenue_micros DESC LIMIT 10`;
    let r: Array<{ results?: Array<any> }>;
    try {
      r = await query(gaql(true));
    } catch {
      r = await query(gaql(false));
    }
    extras.cartProducts = parseCartProducts(adsRows(r));
  });
  // b) Biddable vs. nur Reporting je Conversion-Aktion (all_conversions).
  await zusatz("conversion_split", async () => {
    const r = await query(
      `SELECT conversion_action.name, conversion_action.include_in_conversions_metric, metrics.all_conversions, metrics.all_conversions_value FROM conversion_action WHERE ${between}`,
    );
    extras.conversionSplit = parseConversionSplit(adsRows(r));
  });
  // d) v25 nur lesend: Brand Guidelines (PMax) + NCA-Ziel (campaign_goal_config).
  await zusatz("campaign_flags", async () => {
    const camps = await query(
      `SELECT campaign.id, campaign.name, campaign.advertising_channel_type, campaign.brand_guidelines_enabled FROM campaign WHERE campaign.status IN ('ENABLED','PAUSED')`,
    );
    let goals: Array<any> = [];
    try {
      goals = adsRows(
        await query(
          `SELECT campaign_goal_config.campaign, campaign_goal_config.goal_type FROM campaign_goal_config`,
        ),
      );
    } catch (e) {
      extras.errors.push(
        `campaign_goal_config: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`,
      );
    }
    extras.campaignFlags = parseCampaignFlags(adsRows(camps), goals);
    const byName = new Map(extras.campaignFlags.map((f) => [f.name, f]));
    for (const c of campaigns) {
      const f = byName.get(c.name);
      if (!f) continue;
      c.brandGuidelinesEnabled = f.brandGuidelinesEnabled;
      c.ncaGoalActive = f.ncaGoalActive;
    }
  });

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
    extras,
    error: firstError,
  };

  return { ok: true, result };
}
