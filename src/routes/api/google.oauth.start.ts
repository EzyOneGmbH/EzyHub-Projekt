import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createClient } from "@supabase/supabase-js";
import { buildAuthUrl, getGoogleConfig, signState, redactSecrets } from "@/server/google-oauth.server";
import { randomBytes } from "node:crypto";

const QuerySchema = z.object({
  client_id: z.string().uuid(),
});

async function getUserFromAuthHeader(authHeader: string | null) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.replace("Bearer ", "");
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  const sb = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await sb.auth.getClaims(token);
  return data?.claims ?? null;
}

export const Route = createFileRoute("/api/google/oauth/start")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { sessionSecret } = getGoogleConfig();
          const url = new URL(request.url);
          const parsed = QuerySchema.safeParse({ client_id: url.searchParams.get("client_id") ?? "" });
          if (!parsed.success) {
            return new Response(JSON.stringify({ error: "Invalid client_id" }), { status: 400 });
          }

          const claims = await getUserFromAuthHeader(request.headers.get("authorization"));
          if (!claims?.sub) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
          }

          // Look up the client + verify caller is owner/admin in its org
          const { data: client, error: cErr } = await supabaseAdmin
            .from("clients")
            .select("id, organization_id")
            .eq("id", parsed.data.client_id)
            .maybeSingle();
          if (cErr || !client) {
            return new Response(JSON.stringify({ error: "Client not found" }), { status: 404 });
          }
          const { data: membership } = await supabaseAdmin
            .from("app_users")
            .select("role")
            .eq("user_id", claims.sub)
            .eq("organization_id", client.organization_id)
            .maybeSingle();
          if (!membership || !["owner", "admin"].includes(membership.role)) {
            return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
          }

          const state = signState(
            {
              org: client.organization_id,
              client: client.id,
              user: claims.sub,
              nonce: randomBytes(16).toString("hex"),
              ts: Date.now(),
            },
            sessionSecret
          );

          return new Response(JSON.stringify({ url: buildAuthUrl(state) }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          return new Response(JSON.stringify({ error: redactSecrets(e) }), { status: 500 });
        }
      },
    },
  },
});
