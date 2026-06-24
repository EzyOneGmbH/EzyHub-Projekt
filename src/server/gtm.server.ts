import { getGoogleAccessToken } from "./google-tokens.server";

// Google Tag Manager (GTM) helper — read-only. Uses the client's Google OAuth
// (scope tagmanager.readonly) to verify conversion tracking: lists accounts,
// containers and the LIVE container version's tags/triggers/variables.
// Server-only.

const API = "https://tagmanager.googleapis.com/tagmanager/v2";

async function gFetch(token: string, url: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) return { ok: false, status: res.status, error: String(json?.error?.message || `HTTP ${res.status}`).slice(0, 300), data: null };
  return { ok: true, status: res.status, error: null, data: json };
}

export async function gtmAccounts(clientId: string) {
  const { accessToken } = await getGoogleAccessToken(clientId);
  const r = await gFetch(accessToken, `${API}/accounts`);
  if (!r.ok) return r;
  return { ok: true, accounts: (r.data?.account || []).map((a: any) => ({ accountId: a.accountId, name: a.name, path: a.path })) };
}

export async function gtmContainers(clientId: string, accountPath: string) {
  const { accessToken } = await getGoogleAccessToken(clientId);
  const r = await gFetch(accessToken, `${API}/${accountPath}/containers`);
  if (!r.ok) return r;
  return {
    ok: true,
    containers: (r.data?.container || []).map((c: any) => ({
      containerId: c.containerId, name: c.name, path: c.path,
      publicId: c.publicId, // GTM-XXXX
      usageContext: c.usageContext,
    })),
  };
}

// Read the LIVE (published) container version — what's actually deployed.
export async function gtmLiveTags(clientId: string, containerPath: string) {
  const { accessToken } = await getGoogleAccessToken(clientId);
  const r = await gFetch(accessToken, `${API}/${containerPath}/versions:live`);
  if (!r.ok) return r;
  const v = r.data || {};
  return {
    ok: true,
    version: { name: v.name, versionId: v.containerVersionId },
    tags: (v.tag || []).map((t: any) => ({ name: t.name, type: t.type, firing: (t.firingTriggerId || []).length })),
    triggers: (v.trigger || []).map((t: any) => ({ name: t.name, type: t.type })),
    variables: (v.variable || []).map((vr: any) => ({ name: vr.name, type: vr.type })),
  };
}

export async function gtmResolveDefault(clientId: string): Promise<{ ok: boolean; accountPath?: string; containerPath?: string; publicId?: string; error?: string }> {
  const acc = await gtmAccounts(clientId);
  if (!acc.ok) return { ok: false, error: acc.error };
  const accountPath = acc.accounts?.[0]?.path;
  if (!accountPath) return { ok: false, error: "Kein GTM-Account gefunden" };
  const cont = await gtmContainers(clientId, accountPath);
  if (!cont.ok) return { ok: false, error: cont.error };
  const c = (cont.containers || []).find((x: any) => (x.usageContext || []).includes("web")) || cont.containers?.[0];
  if (!c) return { ok: false, error: "Kein GTM-Container gefunden" };
  return { ok: true, accountPath, containerPath: c.path, publicId: c.publicId };
}
