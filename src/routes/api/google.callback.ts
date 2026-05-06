import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  decodeIdTokenEmail,
  exchangeCode,
  getGoogleConfig,
  redactSecrets,
  verifyState,
} from "@/server/google-oauth.server";

function htmlResponse(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function closingPage(ok: boolean, message: string) {
  const safe = message.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]!));
  return `<!doctype html><html><body style="font-family:system-ui;background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="max-width:480px;text-align:center;padding:24px">
<h1>${ok ? "Google verbunden ✓" : "Verbindung fehlgeschlagen"}</h1>
<p style="opacity:.7">${safe}</p>
<p><a href="javascript:window.close()" style="color:#7dd3fc">Fenster schließen</a></p>
<script>setTimeout(()=>{try{window.close()}catch(e){}},2500)</script>
</div></body></html>`;
}

export const Route = createFileRoute("/api/google/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { sessionSecret } = getGoogleConfig();
          const url = new URL(request.url);
          const code = url.searchParams.get("code");
          const stateParam = url.searchParams.get("state");
          const errorParam = url.searchParams.get("error");

          if (errorParam) {
            return htmlResponse(closingPage(false, `Google: ${errorParam}`), 400);
          }
          if (!code || !stateParam) {
            return htmlResponse(closingPage(false, "Fehlender code/state."), 400);
          }
          const state = verifyState(stateParam, sessionSecret);
          if (!state) {
            return htmlResponse(closingPage(false, "Ungültiger oder abgelaufener State."), 400);
          }

          const tokens = await exchangeCode(code);
          const email = decodeIdTokenEmail(tokens.id_token);
          const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
          const scopes = tokens.scope?.split(" ") ?? [];

          // Upsert: one google connection per (org, client)
          const { data: existing } = await supabaseAdmin
            .from("oauth_connections")
            .select("id, refresh_token")
            .eq("organization_id", state.org)
            .eq("client_id", state.client)
            .eq("provider", "google")
            .maybeSingle();

          if (existing) {
            await supabaseAdmin
              .from("oauth_connections")
              .update({
                user_id: state.user,
                account_email: email,
                scopes,
                access_token: tokens.access_token,
                // keep prior refresh_token if Google didn't return a new one
                refresh_token: tokens.refresh_token ?? existing.refresh_token,
                expires_at: expiresAt,
              })
              .eq("id", existing.id);
          } else {
            await supabaseAdmin.from("oauth_connections").insert({
              organization_id: state.org,
              client_id: state.client,
              user_id: state.user,
              provider: "google",
              account_email: email,
              scopes,
              access_token: tokens.access_token,
              refresh_token: tokens.refresh_token ?? null,
              expires_at: expiresAt,
            });
          }

          return htmlResponse(closingPage(true, email ? `Verbunden als ${email}` : "Verbunden."));
        } catch (e) {
          return htmlResponse(closingPage(false, redactSecrets(e)), 500);
        }
      },
    },
  },
});
