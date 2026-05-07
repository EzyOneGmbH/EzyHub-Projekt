import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Returns true if the given provider is enabled for the client.
 * Default policy: missing row => disabled.
 */
export async function isProviderEnabled(clientId: string, provider: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("client_integrations")
    .select("enabled")
    .eq("client_id", clientId)
    .eq("provider", provider)
    .maybeSingle();
  return !!data?.enabled;
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
