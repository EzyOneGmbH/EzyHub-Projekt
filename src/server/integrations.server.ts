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
