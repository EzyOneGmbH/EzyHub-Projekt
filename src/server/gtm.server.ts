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
  const domain = String(clientDomain || "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();
  const core = domain ? domain.split(".")[0] : "";

  // Read the GTM id(s) actually installed on the client's live site FIRST.
  let siteIds: string[] = [];
  if (domain) {
    try {
      const html = await (await fetch(`https://${domain}/`, { signal: AbortSignal.timeout(15_000) })).text();
      siteIds = [...new Set(html.match(/GTM-[A-Z0-9]+/g) || [])];
    } catch { /* site unreachable */ }
  }

  const acc = await gtmAccounts(clientId);
  if (!acc.ok) return { ok: false, error: (acc as any).error };

  // Iterate accounts, SHORT-CIRCUIT as soon as a container matches the site's
  // GTM id (the reliable signal) — avoids listing every tenant's containers.
  let nameMatch: any = null;
  let firstWeb: any = null;
  for (const a of (acc as any).accounts || []) {
    const c = await gtmContainers(clientId, a.path);
    if (!c.ok) continue;
    for (const x of (c as any).containers || []) {
      const cont = { ...x, accountPath: a.path };
      if (siteIds.includes(cont.publicId)) {
        return { ok: true, accountPath: a.path, containerPath: cont.path, publicId: cont.publicId, matchedBy: "site" };
      }
      if (!nameMatch && core && String(cont.name || "").toLowerCase().includes(core)) nameMatch = cont;
      if (!firstWeb && (cont.usageContext || []).includes("web")) firstWeb = cont;
    }
  }

  // Site has a GTM id but it is NOT in the connected account → likely the client's
  // own Site-Kit/Google account. Honest, actionable result instead of a wrong match.
  if (siteIds.length && !nameMatch) {
    return { ok: false, error: `Website nutzt ${siteIds.join(", ")}, dieser Container ist aber nicht im verbundenen GTM-Konto (gehört evtl. zum Kunden-/Site-Kit-Konto). Container manuell zuordnen oder Zugriff anfordern.` };
  }
  const chosen = nameMatch || firstWeb;
  if (!chosen) return { ok: false, error: "Kein passender GTM-Container im verbundenen Konto gefunden" };
  return { ok: true, accountPath: chosen.accountPath, containerPath: chosen.path, publicId: chosen.publicId, matchedBy: nameMatch ? "name" : "fallback" };
}
