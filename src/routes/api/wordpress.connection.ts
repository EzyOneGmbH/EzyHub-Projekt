import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizeSiteUrl, verifyWpConnection, detectSeoPlugin } from "@/server/wordpress.server";
import { encryptSecret } from "@/server/secretbox.server";

// Per-client WordPress connection: GET status, POST connect (verify + store),
// DELETE disconnect. Credentials live in oauth_connections (provider="wordpress").

async function authClient(request: Request, clientId: string, requireAdmin = false) {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!;
  const sb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
  });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 as const };
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, organization_id")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return { error: "Client not found", status: 404 as const };
  const { data: m } = await supabaseAdmin
    .from("app_users")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", client.organization_id)
    .maybeSingle();
  if (!m) return { error: "Forbidden", status: 403 as const };
  if (requireAdmin && !["owner", "admin"].includes((m as any).role))
    return { error: "Forbidden", status: 403 as const };
  return { user, client };
}

const ConnectBody = z.object({
  clientId: z.string().uuid(),
  siteUrl: z.string().min(1),
  username: z.string().min(1),
  appPassword: z.string().min(1),
});
const IdBody = z.object({ clientId: z.string().uuid() });

export const Route = createFileRoute("/api/wordpress/connection")({
  server: {
    handlers: {
      // GET ?clientId=xxx → connection status (no secret returned)
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const clientId = url.searchParams.get("clientId") || "";
        if (!clientId) return Response.json({ error: "clientId required" }, { status: 400 });
        const auth = await authClient(request, clientId);
        if ("error" in auth) return Response.json({ error: auth.error }, { status: auth.status });

        const { data: conn } = await supabaseAdmin
          .from("oauth_connections")
          .select("account_email, scopes, updated_at")
          .eq("client_id", clientId)
          .eq("provider", "wordpress")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        return Response.json({
          connected: !!conn,
          siteUrl: Array.isArray(conn?.scopes) ? (conn!.scopes[0] ?? null) : null,
          username: conn?.account_email ?? null,
          updatedAt: conn?.updated_at ?? null,
        });
      },

      // POST → verify credentials against the WP REST API, then store on success.
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        const parsed = ConnectBody.safeParse(body);
        if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });
        const auth = await authClient(request, parsed.data.clientId, true);
        if ("error" in auth) return Response.json({ error: auth.error }, { status: auth.status });

        const siteUrl = normalizeSiteUrl(parsed.data.siteUrl);
        if (!siteUrl) return Response.json({ error: "Ungültige Site-URL" }, { status: 400 });
        const conn = { siteUrl, username: parsed.data.username.trim(), appPassword: parsed.data.appPassword.trim() };

        // Verify before persisting so we never store broken credentials.
        const verify = await verifyWpConnection(conn);
        if (!verify.ok) return Response.json({ ok: false, error: verify.error });
        const seoPlugin = await detectSeoPlugin(conn).catch(() => null);

        // Upsert: replace any existing wordpress connection for this client.
        await supabaseAdmin
          .from("oauth_connections")
          .delete()
          .eq("client_id", parsed.data.clientId)
          .eq("provider", "wordpress");
        await supabaseAdmin.from("oauth_connections").insert({
          organization_id: auth.client.organization_id,
          client_id: parsed.data.clientId,
          user_id: auth.user.id,
          provider: "wordpress",
          account_email: conn.username,
          scopes: [siteUrl, seoPlugin ? `seo:${seoPlugin}` : ""].filter(Boolean),
          // Security-Hardening 18.08.: nie mehr Klartext speichern.
          access_token: encryptSecret(conn.appPassword),
          refresh_token: null,
          expires_at: null,
        });

        return Response.json({ ok: true, siteUrl, user: verify.user, seoPlugin });
      },

      // DELETE → disconnect (admin only)
      DELETE: async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        const parsed = IdBody.safeParse(body);
        if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });
        const auth = await authClient(request, parsed.data.clientId, true);
        if ("error" in auth) return Response.json({ error: auth.error }, { status: auth.status });

        await supabaseAdmin
          .from("oauth_connections")
          .delete()
          .eq("client_id", parsed.data.clientId)
          .eq("provider", "wordpress");
        return Response.json({ ok: true });
      },
    },
  },
});
