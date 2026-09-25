// ChatGPT-Ads-Report (Volkan 25.09.2026): GA4 und OpenAI Ads kombiniert,
// je Kampagne und je Region — Grundlage fuer den Tab «Report» im Ads-Modus.
//
// GA4        : Sessions, Nutzer, Key Events aus Quelle ≈ chatgpt / Medium cpc
//              (paid), je sessionCampaignName × Land.
// OpenAI Ads : Impressionen, Klicks, Spend, Conversions je Kampagne aus
//              chatgpt_ads_insights_daily (Sync); Laender-Aufteilung LIVE aus
//              der Advertiser-API (Segment country — wird nicht gespeichert).
//              Conversions liefert die API nicht je Land -> in Regionen zaehlen
//              die GA4-Key-Events.
// Zusammenfuehrung: GA4-Kampagnenname (utm_campaign) gegen Kampagnenname
//              oder Kampagnen-ID der Ads (normalisiert). Nicht zuordenbare
//              GA4-Zeilen erscheinen als eigene Zeile «nur GA4».
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "@/server/google-tokens.server";
import { decryptSecret } from "@/server/secretbox.server";
import { ga4DateRange, type Zeitraum } from "@/lib/date-range";

const GA4 = "https://analyticsdata.googleapis.com/v1beta";
const ADS_API = "https://api.ads.openai.com/v1";

// Quelle/Medium, die als «ChatGPT / CPC» gelten.
export const GA4_SOURCE_RE = "chatgpt|openai";
export const GA4_MEDIUM_RE = "^(cpc|ppc|paid|paidsearch|paid_search|paid-search)$";

export type AdsMetrics = {
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number | null; // null = von der API nicht geliefert (z. B. je Land)
};
export type Ga4Metrics = { sessions: number; users: number; conversions: number };
// subregions: GA4-Region (Kanton/Bundesland) unter dem Land — nur GA4-Werte,
// die Ads-API kennt keine Regionen unterhalb des Landes.
export type SubRegion = { region: string; ga4: Ga4Metrics };
export type RegionRow = {
  country: string;
  ads: AdsMetrics | null;
  ga4: Ga4Metrics | null;
  subregions: SubRegion[];
};
export type CampaignRow = {
  key: string;
  name: string;
  status: string | null;
  openaiId: string | null;
  ga4Campaign: string | null; // utm_campaign, wie GA4 ihn sieht
  ads: AdsMetrics | null;
  ga4: Ga4Metrics | null;
  regions: RegionRow[];
  // Kontexthinweise je Anzeigengruppe (Konfiguration; Leistung je Hinweis
  // liefert die API nicht).
  adGroups: Array<{ name: string; status: string | null; contextHints: string[] }>;
};
export type AdsReport = {
  ok: true;
  range: { from: string; to: string; days: number };
  account: { name: string | null; currency: string; isMock: boolean } | null;
  ga4: { connected: boolean; error?: string; filter: { source: string; medium: string } };
  adsCountryError?: string;
  totals: { ads: AdsMetrics; ga4: Ga4Metrics };
  campaigns: CampaignRow[];
  regions: RegionRow[];
  debug?: unknown;
};

const norm = (s: string) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");

// Laendercode (CH) -> englischer Name wie GA4 ("Switzerland").
function countryName(v: string): string {
  const s = String(v || "").trim();
  if (/^[A-Za-z]{2}$/.test(s)) {
    try {
      return new Intl.DisplayNames(["en"], { type: "region" }).of(s.toUpperCase()) || s;
    } catch {
      return s.toUpperCase();
    }
  }
  return s || "(unbekannt)";
}

const emptyAds = (): AdsMetrics => ({ impressions: 0, clicks: 0, spend: 0, conversions: 0 });
const emptyGa4 = (): Ga4Metrics => ({ sessions: 0, users: 0, conversions: 0 });
const addAds = (a: AdsMetrics, b: AdsMetrics): AdsMetrics => ({
  impressions: a.impressions + b.impressions,
  clicks: a.clicks + b.clicks,
  spend: Math.round((a.spend + b.spend) * 100) / 100,
  conversions:
    a.conversions == null && b.conversions == null
      ? null
      : (a.conversions ?? 0) + (b.conversions ?? 0),
});
const addGa4 = (a: Ga4Metrics, b: Ga4Metrics): Ga4Metrics => ({
  sessions: a.sessions + b.sessions,
  users: a.users + b.users,
  conversions: a.conversions + b.conversions,
});

// Mock-Konten: gleiche Aufteilung wie admin.chatgpt-ads (MOCK_SPLIT.country).
const MOCK_COUNTRIES: Array<[string, number]> = [
  ["Switzerland", 0.72],
  ["Germany", 0.18],
  ["Austria", 0.07],
  ["Other", 0.03],
];

async function adsGet(
  apiKey: string,
  adAccountId: string,
  path: string,
  query: Record<string, string | string[]>,
) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query))
    for (const one of Array.isArray(v) ? v : [v]) sp.append(k, one);
  const r = await fetch(`${ADS_API}${path}?${sp}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Ad-Account": adAccountId,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const json = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, json };
}

// Laender je Kampagne (live). Liefert Map<Land, AdsMetrics> oder einen Fehler.
async function adsCountries(
  apiKey: string,
  acc: { openai_ad_account_id: string; timezone: string | null },
  campaignOpenaiId: string,
  zr: Pick<Zeitraum, "startDate" | "endDate">,
): Promise<Map<string, AdsMetrics> | { error: string }> {
  const tr = JSON.stringify({
    type: "date_range",
    since: zr.startDate,
    until: zr.endDate,
    timezone: acc.timezone || "UTC",
  });
  const fields = ["country.name", "country.impressions", "country.clicks", "country.spend"];
  const q = (f: string[]) => ({
    time_granularity: "none",
    aggregation_level: "campaign",
    limit: "500",
    "time_ranges[]": [tr],
    "segments[]": ["country"],
    "fields[]": f,
  });
  let r = await adsGet(
    apiKey,
    acc.openai_ad_account_id,
    `/campaigns/${campaignOpenaiId}/insights`,
    q(fields),
  );
  if (!r.ok && r.status === 400)
    r = await adsGet(
      apiKey,
      acc.openai_ad_account_id,
      `/campaigns/${campaignOpenaiId}/insights`,
      q(fields.slice(0, 1)),
    );
  if (!r.ok)
    return { error: `Ads-Laender HTTP ${r.status}: ${JSON.stringify(r.json)?.slice(0, 160)}` };
  const out = new Map<string, AdsMetrics>();
  for (const row of r.json?.data || []) {
    const land = countryName(String(row.country_name ?? row.country ?? row.country_code ?? ""));
    const m: AdsMetrics = {
      impressions: Number(row.country_impressions ?? row.impressions ?? 0),
      clicks: Number(row.country_clicks ?? row.clicks ?? 0),
      spend: Number(row.country_spend ?? row.spend ?? 0),
      conversions: null,
    };
    out.set(land, out.has(land) ? addAds(out.get(land)!, m) : m);
  }
  return out;
}

type Ga4Row = {
  source: string;
  medium: string;
  campaign: string;
  country: string;
  region: string;
} & Ga4Metrics;

async function ga4Rows(
  client: { id: string; ga4_property?: string | null },
  zr: Pick<Zeitraum, "startDate" | "endDate">,
  debug: boolean,
): Promise<{ rows: Ga4Row[]; error?: string; connected: boolean; sample?: unknown }> {
  if (!client.ga4_property)
    return { rows: [], connected: false, error: "kein GA4-Property hinterlegt" };
  let token: string;
  try {
    token = (await getGoogleAccessToken(client.id)).accessToken;
  } catch (e) {
    return {
      rows: [],
      connected: false,
      error: "Google-Token: " + String((e as any)?.message || e).slice(0, 160),
    };
  }
  const propertyId = String(client.ga4_property).replace(/^properties\//, "");
  const run = (withMedium: boolean) =>
    fetch(`${GA4}/properties/${encodeURIComponent(propertyId)}:runReport`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRanges: [ga4DateRange(zr)],
        dimensions: [
          { name: "sessionSource" },
          { name: "sessionMedium" },
          { name: "sessionCampaignName" },
          { name: "country" },
          { name: "region" },
        ],
        metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "keyEvents" }],
        dimensionFilter: withMedium
          ? {
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
            }
          : {
              filter: {
                fieldName: "sessionSource",
                stringFilter: {
                  matchType: "PARTIAL_REGEXP",
                  value: GA4_SOURCE_RE,
                  caseSensitive: false,
                },
              },
            },
        limit: 10000,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  const r = await run(true);
  if (!r.ok) return { rows: [], connected: true, error: `GA4 HTTP ${r.status}` };
  const j: any = await r.json().catch(() => ({}));
  const rows: Ga4Row[] = (j.rows ?? []).map((row: any) => {
    const d = (i: number) => String(row.dimensionValues?.[i]?.value ?? "");
    const m = (i: number) => Number(row.metricValues?.[i]?.value ?? 0);
    return {
      source: d(0),
      medium: d(1),
      campaign: d(2),
      country: d(3) || "(not set)",
      region: d(4) && d(4) !== "(not set)" ? d(4) : "Unbekannt",
      sessions: m(0),
      users: m(1),
      conversions: m(2),
    };
  });
  let sample: unknown;
  if (debug) {
    // Diagnose: welche chatgpt-Quellen/Medien gibt es ueberhaupt (ohne Medium-Filter)?
    const r2 = await run(false);
    const j2: any = r2.ok ? await r2.json().catch(() => ({})) : {};
    const agg: Record<string, number> = {};
    for (const row of j2.rows ?? []) {
      const k = `${row.dimensionValues?.[0]?.value} / ${row.dimensionValues?.[1]?.value} / ${row.dimensionValues?.[2]?.value}`;
      agg[k] = (agg[k] ?? 0) + Number(row.metricValues?.[0]?.value ?? 0);
    }
    sample = Object.entries(agg)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30);
  }
  return { rows, connected: true, sample };
}

export async function buildAdsReport(
  client: { id: string; name?: string | null; ga4_property?: string | null },
  zr: Pick<Zeitraum, "startDate" | "endDate" | "days">,
  opts: { debug?: boolean } = {},
): Promise<AdsReport> {
  const sb = supabaseAdmin as any;
  const { data: accs } = await sb
    .from("chatgpt_ads_accounts")
    .select("id, name, openai_ad_account_id, currency_code, timezone, api_key_enc, is_mock, status")
    .eq("client_id", client.id)
    .order("is_mock", { ascending: true })
    .limit(1);
  const acc = accs?.[0] ?? null;

  // ── OpenAI Ads: Kampagnen + Summen aus dem Sync ──
  const campaignsAds: Array<{ id: string; name: string; status: string | null; m: AdsMetrics }> =
    [];
  const gruppenJeKampagne = new Map<string, CampaignRow["adGroups"]>();
  if (acc) {
    const [{ data: kamp }, { data: ins }, { data: gruppen }] = await Promise.all([
      sb
        .from("chatgpt_ads_campaigns")
        .select("openai_campaign_id, name, status")
        .eq("account_id", acc.id),
      sb
        .from("chatgpt_ads_insights_daily")
        .select("scope_openai_id, impressions, clicks, spend, conversions")
        .eq("account_id", acc.id)
        .eq("scope", "campaign")
        .gte("date", zr.startDate)
        .lte("date", zr.endDate),
      sb
        .from("chatgpt_ads_ad_groups")
        .select("name, status, raw, campaign:chatgpt_ads_campaigns(openai_campaign_id)")
        .eq("account_id", acc.id),
    ]);
    for (const gr of gruppen || []) {
      const cid = String(gr.campaign?.openai_campaign_id || "");
      if (!cid) continue;
      const hints = Array.isArray(gr.raw?.context_hints) ? gr.raw.context_hints.map(String) : [];
      const liste = gruppenJeKampagne.get(cid) ?? [];
      liste.push({ name: String(gr.name || ""), status: gr.status ?? null, contextHints: hints });
      gruppenJeKampagne.set(cid, liste);
    }
    const sum = new Map<string, AdsMetrics>();
    for (const r of ins || []) {
      const k = String(r.scope_openai_id);
      const m: AdsMetrics = {
        impressions: Number(r.impressions || 0),
        clicks: Number(r.clicks || 0),
        spend: Number(r.spend || 0),
        conversions: r.conversions != null ? Number(r.conversions) : null,
      };
      sum.set(k, sum.has(k) ? addAds(sum.get(k)!, m) : m);
    }
    for (const k of kamp || [])
      campaignsAds.push({
        id: String(k.openai_campaign_id),
        name: String(k.name || k.openai_campaign_id),
        status: k.status ?? null,
        m: sum.get(String(k.openai_campaign_id)) ?? emptyAds(),
      });
    // Insights zu Kampagnen, die nicht (mehr) in der Kampagnenliste stehen.
    for (const [id, m] of sum)
      if (!campaignsAds.some((c) => c.id === id))
        campaignsAds.push({ id, name: id, status: null, m });
  }

  // ── OpenAI Ads: Laender je Kampagne (live) ──
  let adsCountryError: string | undefined;
  const adsCountryByCampaign = new Map<string, Map<string, AdsMetrics>>();
  if (acc) {
    if (acc.is_mock) {
      for (const c of campaignsAds)
        adsCountryByCampaign.set(
          c.id,
          new Map(
            MOCK_COUNTRIES.map(([land, f]) => [
              land,
              {
                impressions: Math.round(c.m.impressions * f),
                clicks: Math.round(c.m.clicks * f),
                spend: Math.round(c.m.spend * f * 100) / 100,
                conversions: null,
              },
            ]),
          ),
        );
    } else {
      let key: string | null = null;
      try {
        key = decryptSecret(acc.api_key_enc);
      } catch (e: any) {
        adsCountryError = `Key nicht lesbar: ${String(e?.message || e).slice(0, 120)}`;
      }
      if (key)
        for (const c of campaignsAds.filter((x) => x.m.impressions > 0)) {
          const res = await adsCountries(key, acc, c.id, zr);
          if ("error" in res) adsCountryError ??= res.error;
          else adsCountryByCampaign.set(c.id, res);
        }
    }
  }

  // ── GA4 ──
  const g = await ga4Rows(client, zr, !!opts.debug);

  // ── Zusammenfuehren ──
  const byNorm = new Map<string, (typeof campaignsAds)[number]>();
  for (const c of campaignsAds) {
    byNorm.set(norm(c.name), c);
    byNorm.set(norm(c.id), c);
  }
  const rows = new Map<string, CampaignRow>();
  for (const c of campaignsAds)
    rows.set(c.id, {
      key: c.id,
      name: c.name,
      status: c.status,
      openaiId: c.id,
      ga4Campaign: null,
      ads: c.m,
      ga4: null,
      regions: [],
      adGroups: gruppenJeKampagne.get(c.id) ?? [],
    });
  const ga4ByCampaignCountry = new Map<string, Map<string, Ga4Metrics>>();
  // Schluessel "<kampagne>\0<land>" -> Region -> GA4
  const ga4Sub = new Map<string, Map<string, Ga4Metrics>>();
  for (const r of g.rows) {
    const treffer = byNorm.get(norm(r.campaign));
    const key = treffer ? treffer.id : `ga4:${r.campaign || "(not set)"}`;
    if (!rows.has(key))
      rows.set(key, {
        key,
        name: r.campaign && r.campaign !== "(not set)" ? r.campaign : "Ohne Kampagnenzuordnung",
        status: null,
        openaiId: null,
        ga4Campaign: r.campaign || null,
        ads: null,
        ga4: null,
        regions: [],
        adGroups: [],
      });
    const row = rows.get(key)!;
    row.ga4Campaign ??= r.campaign || null;
    const m: Ga4Metrics = { sessions: r.sessions, users: r.users, conversions: r.conversions };
    row.ga4 = row.ga4 ? addGa4(row.ga4, m) : m;
    const cc = ga4ByCampaignCountry.get(key) ?? new Map<string, Ga4Metrics>();
    cc.set(r.country, cc.has(r.country) ? addGa4(cc.get(r.country)!, m) : m);
    ga4ByCampaignCountry.set(key, cc);
    const rk = `${key}\u0000${r.country}`;
    const rr = ga4Sub.get(rk) ?? new Map<string, Ga4Metrics>();
    rr.set(r.region, rr.has(r.region) ? addGa4(rr.get(r.region)!, m) : m);
    ga4Sub.set(rk, rr);
  }
  const subOf = (m?: Map<string, Ga4Metrics>): SubRegion[] =>
    [...(m ?? new Map<string, Ga4Metrics>()).entries()]
      .map(([region, ga4]) => ({ region, ga4 }))
      .sort((a, b) => b.ga4.sessions - a.ga4.sessions || a.region.localeCompare(b.region));

  const regionsTotal = new Map<string, RegionRow>();
  for (const row of rows.values()) {
    const ads = adsCountryByCampaign.get(row.key) ?? new Map<string, AdsMetrics>();
    const ga4 = ga4ByCampaignCountry.get(row.key) ?? new Map<string, Ga4Metrics>();
    const laender = new Set([...ads.keys(), ...ga4.keys()]);
    row.regions = [...laender]
      .map((country) => ({
        country,
        ads: ads.get(country) ?? null,
        ga4: ga4.get(country) ?? null,
        subregions: subOf(ga4Sub.get(`${row.key}\u0000${country}`)),
      }))
      .sort(
        (a, b) =>
          (b.ads?.clicks ?? 0) +
          (b.ga4?.sessions ?? 0) -
          ((a.ads?.clicks ?? 0) + (a.ga4?.sessions ?? 0)),
      );
    for (const rg of row.regions) {
      const t: RegionRow = regionsTotal.get(rg.country) ?? {
        country: rg.country,
        ads: null,
        ga4: null,
        subregions: [],
      };
      if (rg.ads) t.ads = t.ads ? addAds(t.ads, rg.ads) : { ...rg.ads };
      if (rg.ga4) t.ga4 = t.ga4 ? addGa4(t.ga4, rg.ga4) : { ...rg.ga4 };
      // Regionen ueber Kampagnen summieren
      const sm = new Map(t.subregions.map((x) => [x.region, x.ga4] as const));
      for (const sr of rg.subregions)
        sm.set(sr.region, sm.has(sr.region) ? addGa4(sm.get(sr.region)!, sr.ga4) : { ...sr.ga4 });
      t.subregions = subOf(new Map(sm));
      regionsTotal.set(rg.country, t);
    }
  }

  const campaigns = [...rows.values()].sort(
    (a, b) =>
      (b.ads?.spend ?? 0) - (a.ads?.spend ?? 0) || (b.ga4?.sessions ?? 0) - (a.ga4?.sessions ?? 0),
  );
  const totals = {
    ads: campaigns.reduce((s, c) => (c.ads ? addAds(s, c.ads) : s), emptyAds()),
    ga4: campaigns.reduce((s, c) => (c.ga4 ? addGa4(s, c.ga4) : s), emptyGa4()),
  };

  return {
    ok: true,
    range: { from: zr.startDate, to: zr.endDate, days: zr.days },
    account: acc
      ? { name: acc.name ?? null, currency: acc.currency_code || "CHF", isMock: !!acc.is_mock }
      : null,
    ga4: {
      connected: g.connected,
      ...(g.error ? { error: g.error } : {}),
      filter: { source: GA4_SOURCE_RE, medium: GA4_MEDIUM_RE },
    },
    ...(adsCountryError ? { adsCountryError } : {}),
    totals,
    campaigns,
    regions: [...regionsTotal.values()].sort(
      (a, b) =>
        (b.ads?.clicks ?? 0) +
        (b.ga4?.sessions ?? 0) -
        ((a.ads?.clicks ?? 0) + (a.ga4?.sessions ?? 0)),
    ),
    ...(opts.debug ? { debug: { ga4Sources: g.sample, ga4RowCount: g.rows.length } } : {}),
  };
}
