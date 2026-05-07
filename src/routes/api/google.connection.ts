import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const Body = z.object({ clientId: z.string().uuid() });

async function getUser(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!;
  const sb = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: request.headers.get("authorization") ?? "" } } });
  const { data } = await sb.auth.getUser();
  return data.user;
}

export const Route = createFileRoute("/api/google/connection")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await getUser(request);
        if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const body = await request.json().catch(() => ({}));
        const parsed = Body.safeParse(body);
        if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });

        const { data: client } = await supabaseAdmin
          .from("clients").select("organization_id").eq("id", parsed.data.clientId).maybeSingle();
        if (!client) return Response.json({ error: "Client not found" }, { status: 404 });
        const { data: m } = await supabaseAdmin
          .from("app_users").select("role")
          .eq("user_id", user.id).eq("organization_id", client.organization_id).maybeSingle();
        if (!m) return Response.json({ error: "Forbidden" }, { status: 403 });

        const { data: conn } = await supabaseAdmin
          .from("oauth_connections")
          .select("id, account_email, scopes, expires_at, updated_at")
          .eq("client_id", parsed.data.clientId).eq("provider", "google")
          .order("updated_at", { ascending: false }).limit(1).maybeSingle();
        return Response.json({
          connected: !!conn,
          email: conn?.account_email ?? null,
          scopes: conn?.scopes ?? [],
          updatedAt: conn?.updated_at ?? null,
        });
      },
      DELETE: async ({ request }) => {
        const user = await getUser(request);
        if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const body = await request.json().catch(() => ({}));
        const parsed = Body.safeParse(body);
        if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });

        const { data: client } = await supabaseAdmin
          .from("clients").select("organization_id").eq("id", parsed.data.clientId).maybeSingle();
        if (!client) return Response.json({ error: "Client not found" }, { status: 404 });
        const { data: m } = await supabaseAdmin
          .from("app_users").select("role")
          .eq("user_id", user.id).eq("organization_id", client.organization_id).maybeSingle();
        if (!m || !["owner", "admin"].includes(m.role)) return Response.json({ error: "Forbidden" }, { status: 403 });

        await supabaseAdmin.from("oauth_connections")
          .delete().eq("client_id", parsed.data.clientId).eq("provider", "google");
        return Response.json({ ok: true });
      },
    },
  },
});
