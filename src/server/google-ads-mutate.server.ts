import { getGoogleAccessToken } from "./google-tokens.server";

// Google Ads WRITE operations for the Autopilot: add negative keyword, adjust
// ad-group bid (hard-capped at +/-15%), set campaign budget. Mirrors the fetch
// style of google-ads.server.ts (Workers-compatible, fetch-only). Every op
// supports dryRun (returns before/after WITHOUT mutating) and a noTouch guard.
// Requires GOOGLE_ADS_DEVELOPER_TOKEN; optional GOOGLE_ADS_LOGIN_CUSTOMER_ID (MCC).

const ADS_API = "https://googleads.googleapis.com/v24";
const MICROS = 1_000_000;
export const MAX_BID_PCT = 15;

export type MutateResult<B = unknown, A = unknown> = {
  ok: boolean;
  dryRun: boolean;
  before?: B;
  after?: A;
  error?: string;
  skipped?: string;
};

type Ctx = {
  customerId: string;
  loginCustomerId: string;
  accessToken: string;
  devToken: string;
};

// GAQL string literals use single quotes; escape backslash + quote to avoid
// injection via campaign/ad-group names.
function gaqlEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function inNoTouch(name: string | undefined, noTouch: string[] | undefined): boolean {
  if (!name || !noTouch?.length) return false;
  return noTouch.map((c) => c.trim()).filter(Boolean).includes(name);
}

async function context(
  clientId: string,
  googleAdsCustomer: string | null | undefined,
): Promise<{ ctx?: Ctx; skipped?: string }> {
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!devToken) return { skipped: "GOOGLE_ADS_DEVELOPER_TOKEN fehlt" };
  const customerId = String(googleAdsCustomer ?? "").replace(/\D/g, "");
  if (!customerId) return { skipped: "keine google_ads_customer" };
  const loginCustomerId = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "").replace(/\D/g, "");
  try {
    const t = await getGoogleAccessToken(clientId);
    return { ctx: { customerId, loginCustomerId, accessToken: t.accessToken, devToken } };
  } catch (e) {
    return { skipped: e instanceof Error ? e.message : "kein Google-Token" };
  }
}

function headers(ctx: Ctx): Record<string, string> {
  return {
    Authorization: `Bearer ${ctx.accessToken}`,
    "developer-token": ctx.devToken,
    "Content-Type": "application/json",
    ...(ctx.loginCustomerId ? { "login-customer-id": ctx.loginCustomerId } : {}),
  };
}

async function query(ctx: Ctx, gaql: string): Promise<Array<Record<string, any>>> {
  const res = await fetch(`${ADS_API}/customers/${ctx.customerId}/googleAds:searchStream`, {
    method: "POST",
    headers: headers(ctx),
    body: JSON.stringify({ query: gaql }),
  });
  if (!res.ok) throw new Error(`Ads API HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const json = (await res.json()) as Array<{ results?: Array<Record<string, any>> }>;
  return json.flatMap((b) => b.results ?? []);
}

async function mutate(ctx: Ctx, resource: string, operations: unknown[]): Promise<void> {
  const res = await fetch(`${ADS_API}/customers/${ctx.customerId}/${resource}:mutate`, {
    method: "POST",
    headers: headers(ctx),
    body: JSON.stringify({ operations }),
  });
  if (!res.ok) throw new Error(`Ads API HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
}

// ─────────────────────────────────────────────── add negative keyword (campaign level)
export async function addNegativeKeyword(p: {
  clientId: string;
  googleAdsCustomer: string | null | undefined;
  campaignName: string;
  term: string;
  matchType?: "EXACT" | "PHRASE" | "BROAD";
  dryRun?: boolean;
  noTouch?: string[];
}): Promise<MutateResult<{ campaign: string }, { campaign: string; negative: string; matchType: string }>> {
  const dryRun = !!p.dryRun;
  const matchType = p.matchType ?? "EXACT";
  const before = { campaign: p.campaignName };
  const after = { campaign: p.campaignName, negative: p.term, matchType };
  if (inNoTouch(p.campaignName, p.noTouch)) return { ok: false, dryRun, skipped: `Kampagne '${p.campaignName}' ist no_touch` };
  if (!p.term.trim()) return { ok: false, dryRun, error: "leerer Suchbegriff" };
  if (dryRun) return { ok: true, dryRun, before, after };

  const { ctx, skipped } = await context(p.clientId, p.googleAdsCustomer);
  if (!ctx) return { ok: false, dryRun, skipped };
  try {
    const rows = await query(ctx, `SELECT campaign.id FROM campaign WHERE campaign.name = '${gaqlEscape(p.campaignName)}' LIMIT 1`);
    const campId = rows?.[0]?.campaign?.id;
    if (!campId) return { ok: false, dryRun, error: `Kampagne '${p.campaignName}' nicht gefunden` };
    await mutate(ctx, "campaignCriteria", [
      {
        create: {
          campaign: `customers/${ctx.customerId}/campaigns/${campId}`,
          negative: true,
          keyword: { text: p.term, matchType },
        },
      },
    ]);
    return { ok: true, dryRun, before, after };
  } catch (e) {
    return { ok: false, dryRun, before, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─────────────────────────────────────────────── adjust ad-group CPC bid (+/-15% hard cap)
export async function adjustAdGroupBid(p: {
  clientId: string;
  googleAdsCustomer: string | null | undefined;
  adGroupName: string;
  pct: number;
  campaignName?: string;
  dryRun?: boolean;
  noTouch?: string[];
}): Promise<MutateResult<{ adGroup: string; cpcChf: number | null }, { adGroup: string; cpcChf: number | null; pct: number }>> {
  const dryRun = !!p.dryRun;
  if (!Number.isFinite(p.pct) || Math.abs(p.pct) > MAX_BID_PCT)
    return { ok: false, dryRun, error: `pct ${p.pct} ausserhalb +/-${MAX_BID_PCT}` };
  if (inNoTouch(p.campaignName, p.noTouch)) return { ok: false, dryRun, skipped: `Kampagne '${p.campaignName}' ist no_touch` };

  const { ctx, skipped } = await context(p.clientId, p.googleAdsCustomer);
  if (!ctx) return { ok: false, dryRun, skipped };
  try {
    const rows = await query(
      ctx,
      `SELECT ad_group.id, ad_group.cpc_bid_micros FROM ad_group WHERE ad_group.name = '${gaqlEscape(p.adGroupName)}' LIMIT 1`,
    );
    const ag = rows?.[0]?.adGroup;
    const beforeMicros = ag?.cpcBidMicros != null ? Number(ag.cpcBidMicros) : null;
    const before = { adGroup: p.adGroupName, cpcChf: beforeMicros != null ? beforeMicros / MICROS : null };
    if (!ag?.id || beforeMicros == null)
      return { ok: false, dryRun, before, error: `Ad-Group '${p.adGroupName}' ohne CPC-Gebot / nicht gefunden` };
    const newMicros = Math.round(beforeMicros * (1 + p.pct / 100));
    const after = { adGroup: p.adGroupName, cpcChf: newMicros / MICROS, pct: p.pct };
    if (dryRun) return { ok: true, dryRun, before, after };
    await mutate(ctx, "adGroups", [
      {
        update: { resourceName: `customers/${ctx.customerId}/adGroups/${ag.id}`, cpcBidMicros: newMicros },
        updateMask: "cpc_bid_micros",
      },
    ]);
    return { ok: true, dryRun, before, after };
  } catch (e) {
    return { ok: false, dryRun, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─────────────────────────────────────────────── set campaign daily budget (approval-only upstream)
export async function setCampaignBudget(p: {
  clientId: string;
  googleAdsCustomer: string | null | undefined;
  campaignName: string;
  dailyChf: number;
  dryRun?: boolean;
  noTouch?: string[];
}): Promise<MutateResult<{ campaign: string; dailyChf: number | null }, { campaign: string; dailyChf: number }>> {
  const dryRun = !!p.dryRun;
  if (!Number.isFinite(p.dailyChf) || p.dailyChf <= 0) return { ok: false, dryRun, error: "ungueltiges Tagesbudget" };
  if (inNoTouch(p.campaignName, p.noTouch)) return { ok: false, dryRun, skipped: `Kampagne '${p.campaignName}' ist no_touch` };
  const after = { campaign: p.campaignName, dailyChf: p.dailyChf };

  const { ctx, skipped } = await context(p.clientId, p.googleAdsCustomer);
  if (!ctx) return { ok: false, dryRun, skipped };
  try {
    const rows = await query(
      ctx,
      `SELECT campaign_budget.id, campaign_budget.amount_micros FROM campaign WHERE campaign.name = '${gaqlEscape(p.campaignName)}' LIMIT 1`,
    );
    const b = rows?.[0]?.campaignBudget;
    const before = { campaign: p.campaignName, dailyChf: b?.amountMicros != null ? Number(b.amountMicros) / MICROS : null };
    if (!b?.id) return { ok: false, dryRun, before, error: `Kampagne '${p.campaignName}' / Budget nicht gefunden` };
    if (dryRun) return { ok: true, dryRun, before, after };
    await mutate(ctx, "campaignBudgets", [
      {
        update: { resourceName: `customers/${ctx.customerId}/campaignBudgets/${b.id}`, amountMicros: Math.round(p.dailyChf * MICROS) },
        updateMask: "amount_micros",
      },
    ]);
    return { ok: true, dryRun, before, after };
  } catch (e) {
    return { ok: false, dryRun, error: e instanceof Error ? e.message : String(e) };
  }
}
