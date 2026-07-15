import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { GOOGLE_CHILDREN, SERVICE_PARENT, SERVICE_KEYS, type ServiceKey } from "@/lib/services";

/** Liest alle client_integrations-Zeilen eines Kunden als provider->enabled Map. */
async function loadIntegrationMap(clientId: string): Promise<Record<string, boolean>> {
  const { data } = await supabaseAdmin
    .from("client_integrations")
    .select("provider, enabled")
    .eq("client_id", clientId);
  const map: Record<string, boolean> = {};
  for (const r of data ?? []) map[String((r as any).provider)] = !!(r as any).enabled;
  return map;
}

/**
 * Returns true if the given provider is enabled for the client.
 * Default policy: missing row => disabled.
 *
 * Hierarchie-bewusst + abwaertskompatibel:
 *  - Grobes "google": true, wenn die google-Zeile aktiv ist ODER irgendein
 *    feines Kind (ga4/gsc/google-ads/gtm/gbp) aktiv ist.
 *  - Feines Google-Kind: explizite feine Zeile gewinnt; fehlt sie, faellt es
 *    auf die grobe "google"-Zeile zurueck (Alt-Kunden bleiben funktionsfaehig).
 *  - Eigenstaendige Provider (ahrefs/canonry/perplexity/bing/wordpress/anthropic):
 *    1:1 ihre eigene Zeile.
 */
export async function isProviderEnabled(clientId: string, provider: string): Promise<boolean> {
  const map = await loadIntegrationMap(clientId);
  return resolveEnabled(map, provider);
}

function resolveEnabled(map: Record<string, boolean>, provider: string): boolean {
  // Grobes "google" = Eltern mehrerer feiner Dienste.
  if (provider === "google") {
    if (map.google === true) return true;
    return GOOGLE_CHILDREN.some((c) => map[c] === true);
  }
  // Feines Google-Kind: explizite Einstellung gewinnt, sonst Fallback auf "google".
  if (SERVICE_PARENT[provider] === "google") {
    if (Object.prototype.hasOwnProperty.call(map, provider)) return map[provider] === true;
    return map.google === true;
  }
  // Eigenstaendig.
  return map[provider] === true;
}

/**
 * Liefert die aufgeloeste Enablement-Map aller feinen Service-Keys fuer einen
 * Kunden (fuer client-domains -> agent-service Auto-Connect-Gating).
 */
export async function getEnabledServices(clientId: string): Promise<Record<ServiceKey, boolean>> {
  return resolveServices(await loadIntegrationMap(clientId));
}

/** Loest alle feinen Service-Keys aus einer vorab geladenen provider->enabled Map auf. */
export function resolveServices(map: Record<string, boolean>): Record<ServiceKey, boolean> {
  const out = {} as Record<ServiceKey, boolean>;
  for (const k of SERVICE_KEYS) out[k] = resolveEnabled(map, k);
  return out;
}

/**
 * Server-side check: may this user trigger paid audit runs in this org?
 * Mirrors public.can_run_audits(_org) (owner/admin/member).
 */
export async function canRunAudits(userId: string, organizationId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("app_users")
    .select("role")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  const role = (data as any)?.role;
  return role === "owner" || role === "admin" || role === "member";
}

/**
 * Server-side check: is this user owner/admin in the given org? Mirrors
 * public.is_org_admin(_org). Used to gate team-/user-management (RBAC).
 * Returns the role too, so callers can distinguish owner from admin.
 */
export async function orgRoleOf(userId: string, organizationId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("app_users")
    .select("role")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return ((data as any)?.role as string) ?? null;
}
export async function isOrgAdmin(userId: string, organizationId: string): Promise<boolean> {
  const role = await orgRoleOf(userId, organizationId);
  return role === "owner" || role === "admin";
}
