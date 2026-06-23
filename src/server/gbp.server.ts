import { getGoogleAccessToken } from "./google-tokens.server";

// Google Business Profile (GBP) helper. Uses the client's existing Google OAuth
// (scope business.manage). Account/location discovery via the v1 management
// APIs; reviews + local posts via the legacy v4 API (still the only way Google
// exposes them). Server-only.
//
// PREREQUISITES (Google Cloud, one-time): the project must have the Business
// Profile APIs enabled AND approved access (Google access-request form). Until
// approved, calls return 403 / quota 0.

const ACCT_API = "https://mybusinessaccountmanagement.googleapis.com/v1";
const INFO_API = "https://mybusinessbusinessinformation.googleapis.com/v1";
const V4_API = "https://mybusiness.googleapis.com/v4";

async function gFetch(token: string, url: string, options?: { method?: string; body?: any }) {
  const res = await fetch(url, {
    method: options?.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const msg = json?.error?.message || `HTTP ${res.status}`;
    return { ok: false, status: res.status, error: String(msg).slice(0, 300), data: null };
  }
  return { ok: true, status: res.status, error: null, data: json };
}

// List accounts the connected Google user manages.
export async function gbpAccounts(clientId: string) {
  const { accessToken } = await getGoogleAccessToken(clientId);
  const r = await gFetch(accessToken, `${ACCT_API}/accounts`);
  if (!r.ok) return r;
  return { ok: true, accounts: (r.data?.accounts || []).map((a: any) => ({ name: a.name, accountName: a.accountName, type: a.type })) };
}

// List locations for an account (name = "accounts/123").
export async function gbpLocations(clientId: string, account: string) {
  const { accessToken } = await getGoogleAccessToken(clientId);
  const fields = "name,title,storefrontAddress,phoneNumbers,websiteUri,metadata";
  const r = await gFetch(accessToken, `${INFO_API}/${account}/locations?readMask=${encodeURIComponent(fields)}&pageSize=100`);
  if (!r.ok) return r;
  return {
    ok: true,
    locations: (r.data?.locations || []).map((l: any) => ({
      name: l.name, // "locations/456"
      title: l.title,
      address: l.storefrontAddress,
      phone: l.phoneNumbers?.primaryPhone,
      website: l.websiteUri,
    })),
  };
}

// Auto-discover the first account+location (convenience for single-location clients).
export async function gbpResolveDefault(clientId: string): Promise<{ ok: boolean; account?: string; location?: string; error?: string }> {
  const acc = await gbpAccounts(clientId);
  if (!acc.ok) return { ok: false, error: acc.error };
  const account = acc.accounts?.[0]?.name;
  if (!account) return { ok: false, error: "Kein GBP-Account gefunden" };
  const loc = await gbpLocations(clientId, account);
  if (!loc.ok) return { ok: false, error: loc.error };
  const location = loc.locations?.[0]?.name;
  if (!location) return { ok: false, error: "Keine GBP-Location gefunden" };
  return { ok: true, account, location };
}

// Reviews (v4): name pattern accounts/{a}/locations/{l}
export async function gbpReviews(clientId: string, account: string, location: string) {
  const { accessToken } = await getGoogleAccessToken(clientId);
  const loc = location.replace(/^locations\//, "");
  const acc = account.replace(/^accounts\//, "");
  const r = await gFetch(accessToken, `${V4_API}/accounts/${acc}/locations/${loc}/reviews?pageSize=50&orderBy=updateTime%20desc`);
  if (!r.ok) return r;
  return {
    ok: true,
    averageRating: r.data?.averageRating,
    totalReviewCount: r.data?.totalReviewCount,
    reviews: (r.data?.reviews || []).map((rv: any) => ({
      reviewId: rv.reviewId,
      reviewer: rv.reviewer?.displayName,
      rating: rv.starRating,
      comment: rv.comment || "",
      createTime: rv.createTime,
      reply: rv.reviewReply?.comment || null,
    })),
  };
}

export async function gbpReplyReview(clientId: string, account: string, location: string, reviewId: string, comment: string) {
  const { accessToken } = await getGoogleAccessToken(clientId);
  const acc = account.replace(/^accounts\//, "");
  const loc = location.replace(/^locations\//, "");
  const r = await gFetch(accessToken, `${V4_API}/accounts/${acc}/locations/${loc}/reviews/${reviewId}/reply`, {
    method: "PUT",
    body: { comment },
  });
  return r.ok ? { ok: true } : r;
}

export async function gbpCreatePost(clientId: string, account: string, location: string, post: { summary: string; ctaUrl?: string; ctaType?: string }) {
  const { accessToken } = await getGoogleAccessToken(clientId);
  const acc = account.replace(/^accounts\//, "");
  const loc = location.replace(/^locations\//, "");
  const body: any = { languageCode: "de", summary: post.summary, topicType: "STANDARD" };
  if (post.ctaUrl) body.callToAction = { actionType: post.ctaType || "LEARN_MORE", url: post.ctaUrl };
  const r = await gFetch(accessToken, `${V4_API}/accounts/${acc}/locations/${loc}/localPosts`, { method: "POST", body });
  return r.ok ? { ok: true, post: { name: r.data?.name, state: r.data?.state } } : r;
}
