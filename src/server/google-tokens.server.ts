import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { refreshAccessToken, redactSecrets } from "./google-oauth.server";

/**
 * Returns a fresh access_token for a client's Google connection.
 * Refreshes via stored refresh_token if expired. Server-only.
 */
type GoogleConn = {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  account_email: string | null;
  scopes?: string[] | null;
};

const CONN_COLS = "id, access_token, refresh_token, expires_at, account_email, scopes";

export async function getGoogleAccessToken(clientId: string): Promise<{
  accessToken: string;
  connectionId: string;
  email: string | null;
}> {
  const { data: conn, error } = await supabaseAdmin
    .from("oauth_connections")
    .select(CONN_COLS)
    .eq("client_id", clientId)
    .eq("provider", "google")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`DB error: ${error.message}`);
  if (!conn) throw new Error("Google account not connected for this client");
  return tokenFromConnection(conn as GoogleConn);
}

/**
 * Wie getGoogleAccessToken, verlangt aber einen bestimmten Scope (z. B.
 * analytics.edit fuer Key Events). Fehlt er im Grant des Kunden, wird ein
 * juengerer Grant DESSELBEN Google-Accounts (account_email) mit diesem Scope
 * genommen — die Rechte am GA4-Property haengen am Account, nicht am Grant.
 * Typisch: Kunde wurde vor dem Scope-Wechsel (26.08.2026) verbunden, der
 * Agentur-Account ist bei einem anderen Kunden bereits mit analytics.edit da.
 * (23.09.2026)
 */
export async function getGoogleAccessTokenForScope(
  clientId: string,
  scope: string,
): Promise<{
  accessToken: string;
  connectionId: string;
  email: string | null;
  viaClientId: string;
}> {
  type OwnConn = GoogleConn & { client_id: string };
  const { data: ownRaw, error } = await supabaseAdmin
    .from("oauth_connections")
    .select(CONN_COLS + ", client_id")
    .eq("client_id", clientId)
    .eq("provider", "google")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`DB error: ${error.message}`);
  const own = ownRaw as unknown as OwnConn | null;
  if (!own) throw new Error("Google account not connected for this client");
  const has = (c: { scopes?: string[] | null }) => (c.scopes ?? []).includes(scope);
  let pick: OwnConn | null = has(own) ? own : null;
  if (!pick && own.account_email) {
    const { data: alt } = await supabaseAdmin
      .from("oauth_connections")
      .select(CONN_COLS + ", client_id")
      .eq("provider", "google")
      .eq("account_email", own.account_email)
      .contains("scopes", [scope])
      .not("refresh_token", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    pick = (alt as unknown as OwnConn | null) ?? null;
  }
  if (!pick)
    throw new Error(
      `Google-Verbindung hat den Scope ${scope.replace(/^.*\//, "")} nicht — ` +
        "bitte Google fuer diesen Kunden einmal NEU verbinden (Onboarding → Google).",
    );
  const t = await tokenFromConnection(pick);
  return { ...t, viaClientId: pick.client_id };
}

async function tokenFromConnection(conn: GoogleConn): Promise<{
  accessToken: string;
  connectionId: string;
  email: string | null;
}> {
  if (!conn.refresh_token) throw new Error("No refresh token stored — please reconnect Google");

  const stillValid =
    conn.access_token &&
    conn.expires_at &&
    new Date(conn.expires_at).getTime() - 60_000 > Date.now();

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
    return {
      accessToken: refreshed.access_token,
      connectionId: conn.id,
      email: conn.account_email,
    };
  } catch (e) {
    const msg = redactSecrets(e);
    // invalid_grant = the refresh token is dead (revoked, password change, or the
    // 7-day expiry that applies while the OAuth consent screen is in "Testing").
    if (/invalid_grant/i.test(msg)) {
      throw new Error(
        "Google-Verbindung abgelaufen oder widerrufen — bitte Google für diesen Kunden NEU verbinden " +
          "(Onboarding → Google → Verbinden). Damit es nicht alle 7 Tage erneut passiert: OAuth-Consent-Screen " +
          "in der Google Cloud Console auf 'In Produktion' veröffentlichen.",
      );
    }
    throw new Error(msg);
  }
}
