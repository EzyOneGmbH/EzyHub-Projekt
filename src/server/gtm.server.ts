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

// Resolve the RIGHT container for a client in a multi-tenant GTM account:
// 1) read the client's live site for its GTM-XXXX id and match that container,
// 2) else match the client domain against the container name,
// 3) else first web container. Avoids picking another client's container.
export async function gtmResolveDefault(
  clientId: string,
  clientDomain?: string,
): Promise<{ ok: boolean; accountPath?: string; containerPath?: string; publicId?: string; matchedBy?: string; error?: string }> {
  const acc = await gtmAccounts(clientId);
  if (!acc.ok) return { ok: false, error: acc.error };
  // Gather containers across ALL accounts the user manages.
  const containers: any[] = [];
  for (const a of acc.accounts || []) {
    const c = await gtmContainers(clientId, a.path);
    if (c.ok) for (const x of c.containers || []) containers.push({ ...x, accountPath: a.path });
  }
  if (!containers.length) return { ok: false, error: "Keine GTM-Container gefunden" };

  const domain = String(clientDomain || "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();

  // 1) Match the GTM id actually installed on the client's live site.
  let siteIds: string[] = [];
  if (domain) {
    try {
      const html = await (await fetch(`https://${domain}/`, { signal: AbortSignal.timeout(15_000) })).text();
      siteIds = [...new Set(html.match(/GTM-[A-Z0-9]+/g) || [])];
    } catch { /* site unreachable — fall through */ }
  }
  let chosen = containers.find((c) => siteIds.includes(c.publicId));
  let matchedBy = chosen ? "site" : "";

  // 2) Match domain core against container name.
  if (!chosen && domain) {
    const core = domain.split(".")[0];
    chosen = containers.find((c) => String(c.name || "").toLowerCase().includes(core));
    if (chosen) matchedBy = "name";
  }
  // 3) Fallback: first web container (ambiguous → caller should verify).
  if (!chosen) {
    chosen = containers.find((c) => (c.usageContext || []).includes("web")) || containers[0];
    matchedBy = "fallback";
  }
  return { ok: true, accountPath: chosen.accountPath, containerPath: chosen.path, publicId: chosen.publicId, matchedBy };
}
