import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "@/server/google-tokens.server";
import { redactSecrets } from "@/server/google-oauth.server";

// Lists the GA4 properties the connected Google account can access (via the
// Analytics Admin API accountSummaries), so the UI can offer a dropdown.

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

export const Route = createFileRoute("/api/google/ga4-properties")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const user = await authedUser(request);
          if (!user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
          const parsed = Body.safeParse(await request.json().catch(() => ({})));
          if (!parsed.success) return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });

          const { data: client } = await supabaseAdmin
            .from("clients")
            .select("id, organization_id")
            .eq("id", parsed.data.clientId)
            .maybeSingle();
          if (!client) return Response.json({ ok: false, error: "Client not found" }, { status: 404 });
          const { data: m } = await supabaseAdmin
            .from("app_users")
            .select("role")
            .eq("user_id", user.id)
            .eq("organization_id", client.organization_id)
            .maybeSingle();
          if (!m) return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });

          const { accessToken } = await getGoogleAccessToken(client.id);
          const r = await fetch(
            "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200",
            { headers: { Authorization: `Bearer ${accessToken}` } },
          );
          if (!r.ok) {
            const t = await r.text().catch(() => "");
            if (API_DISABLED.test(t))
              return Response.json({
                ok: false,
                error:
                  "Google Analytics Admin API nicht aktiviert. In der Google Cloud Console 'Google Analytics Admin API' aktivieren ('APIs & Services → Library').",
              });
            return Response.json({ ok: false, error: redactSecrets(`GA4 accountSummaries HTTP ${r.status}: ${t}`) });
          }
          const j = (await r.json()) as {
            accountSummaries?: Array<{
              displayName?: string;
              propertySummaries?: Array<{ property?: string; displayName?: string }>;
            }>;
          };
          const properties = (j.accountSummaries ?? []).flatMap((a) =>
            (a.propertySummaries ?? []).map((p) => ({
              id: String(p.property ?? "").replace(/^properties\//, ""),
              displayName: p.displayName ?? "",
              account: a.displayName ?? "",
            })),
          );
          properties.sort((a, b) => (a.account + a.displayName).localeCompare(b.account + b.displayName));
          return Response.json({ ok: true, properties });
        } catch (e) {
          return Response.json({ ok: false, error: redactSecrets(e) });
        }
      },
    },
  },
});
