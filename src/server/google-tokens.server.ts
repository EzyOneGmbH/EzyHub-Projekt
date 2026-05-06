import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { refreshAccessToken, redactSecrets } from "./google-oauth.server";

/**
 * Returns a fresh access_token for a client's Google connection.
 * Refreshes via stored refresh_token if expired. Server-only.
 */
export async function getGoogleAccessToken(clientId: string): Promise<{
  accessToken: string;
  connectionId: string;
  email: string | null;
}> {
  const { data: conn, error } = await supabaseAdmin
    .from("oauth_connections")
    .select("id, access_token, refresh_token, expires_at, account_email")
    .eq("client_id", clientId)
    .eq("provider", "google")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`DB error: ${error.message}`);
  if (!conn) throw new Error("Google account not connected for this client");
  if (!conn.refresh_token) throw new Error("No refresh token stored — please reconnect Google");

  const stillValid =
    conn.access_token && conn.expires_at && new Date(conn.expires_at).getTime() - 60_000 > Date.now();

  if (stillValid) {
    return { accessToken: conn.access_token!, connectionId: conn.id, email: conn.account_email };
  }

  try {
    const refreshed = await refreshAccessToken(conn.refresh_token);
    const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
    await supabaseAdmin
      .from("oauth_connections")
      .update({ access_token: refreshed.access_token, expires_at: expiresAt })
      .eq("id", conn.id);
    return { accessToken: refreshed.access_token, connectionId: conn.id, email: conn.account_email };
  } catch (e) {
    throw new Error(redactSecrets(e));
  }
}
