import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "@/server/google-tokens.server";
import { redactSecrets } from "@/server/google-oauth.server";

// Lists the Google Ads customer accounts the connected Google account can
// access, so the UI can offer a dropdown. Uses the Google Ads API
// customerClients endpoint via the MCC or direct customer account.

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

export const Route = createFileRoute("/api/google/ads-customers")({
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

          const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
          if (!devToken) {
            return Response.json({
              ok: false,
              error:
                "Google Ads Developer Token nicht konfiguriert. Bitte GOOGLE_ADS_DEVELOPER_TOKEN setzen.",
            });
          }

          const { accessToken } = await getGoogleAccessToken(client.id);

          // Step 1: List accessible customers (returns customer resource names).
          const listRes = await fetch(
            "https://googleads.googleapis.com/v18/customers:listAccessibleCustomers",
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "developer-token": devToken,
              },
            },
          );
          if (!listRes.ok) {
            const t = await listRes.text().catch(() => "");
            if (API_DISABLED.test(t))
              return Response.json({
                ok: false,
                error:
                  "Google Ads API nicht aktiviert. In der Google Cloud Console 'Google Ads API' aktivieren ('APIs & Services → Library').",
              });
            return Response.json({
              ok: false,
              error: redactSecrets(`Ads listAccessibleCustomers HTTP ${listRes.status}: ${t}`),
            });
          }
          const listJson = (await listRes.json()) as { resourceNames?: string[] };
          const resourceNames = listJson.resourceNames ?? [];
          if (!resourceNames.length) {
            return Response.json({ ok: true, customers: [] });
          }

          // Step 2: For each customer, fetch descriptive name via search query.
          const customers: Array<{ id: string; name: string }> = [];
          for (const rn of resourceNames.slice(0, 50)) {
            const customerId = rn.replace("customers/", "");
            try {
              const searchRes = await fetch(
                `https://googleads.googleapis.com/v18/customers/${customerId}/googleAds:searchStream`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "developer-token": devToken,
                    "Content-Type": "application/json",
                    "login-customer-id": customerId,
                  },
                  body: JSON.stringify({
                    query:
                      "SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1",
                  }),
                },
              );
              if (searchRes.ok) {
                const sj = (await searchRes.json()) as Array<{
                  results?: Array<{
                    customer?: { id?: string; descriptiveName?: string };
                  }>;
                }>;
                const cust = sj?.[0]?.results?.[0]?.customer;
                customers.push({
                  id: cust?.id ?? customerId,
                  name: cust?.descriptiveName ?? customerId,
                });
              } else {
                customers.push({ id: customerId, name: customerId });
              }
            } catch {
              customers.push({ id: customerId, name: customerId });
            }
          }
          customers.sort((a, b) => a.name.localeCompare(b.name));
          return Response.json({ ok: true, customers });
        } catch (e) {
          return Response.json({ ok: false, error: redactSecrets(e) });
        }
      },
    },
  },
});
