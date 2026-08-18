import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "@/server/google-tokens.server";
import { redactSecrets } from "@/server/google-oauth.server";

// Lists the Search Console properties the connected Google account can access,
// so the UI can offer a dropdown instead of a hand-typed property string.

const Body = z.object({ clientId: z.string().uuid() });
const API_DISABLED = /has not been used|is disabled|accessNotConfigured|SERVICE_DISABLED/i;

async function authedUser(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!;
  const sb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
  });
  const { data } = await sb.auth.getUser();
  return data.user;
}

export const Route = createFileRoute("/api/google/gsc-sites")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const user = await authedUser(request);
          if (!user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
          const parsed = Body.safeParse(await request.json().catch(() => ({})));
          if (!parsed.success)
            return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });

          const { data: client } = await supabaseAdmin
            .from("clients")
            .select("id, organization_id")
            .eq("id", parsed.data.clientId)
            .maybeSingle();
          if (!client)
            return Response.json({ ok: false, error: "Client not found" }, { status: 404 });
          const { data: m } = await supabaseAdmin
            .from("app_users")
            .select("role")
            .eq("user_id", user.id)
            .eq("organization_id", client.organization_id)
            .maybeSingle();
          if (!m) return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });

          const { accessToken } = await getGoogleAccessToken(client.id);
          const r = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!r.ok) {
            const t = await r.text().catch(() => "");
            if (API_DISABLED.test(t))
              return Response.json({
                ok: false,
                error:
                  "Search Console API nicht aktiviert ('APIs & Services → Library' aktivieren).",
              });
            return Response.json({
              ok: false,
              error: redactSecrets(`GSC sites.list HTTP ${r.status}: ${t}`),
            });
          }
          const j = (await r.json()) as {
            siteEntry?: Array<{ siteUrl: string; permissionLevel?: string }>;
          };
          const sites = (j.siteEntry ?? [])
            .map((s) => ({ url: s.siteUrl, permission: s.permissionLevel ?? "" }))
            .sort((a, b) => a.url.localeCompare(b.url));
          return Response.json({ ok: true, sites });
        } catch (e) {
          return Response.json({ ok: false, error: redactSecrets(e) });
        }
      },
    },
  },
});
