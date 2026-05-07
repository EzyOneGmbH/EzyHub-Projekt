import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "@/server/google-tokens.server";
import { redactSecrets } from "@/server/google-oauth.server";
import { isProviderEnabled } from "@/server/integrations.server";

const Body = z.object({
  clientId: z.string().uuid(),
  days: z.number().int().min(1).max(90).default(28),
});

export const Route = createFileRoute("/api/google/ga4-summary")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const supabaseUrl = process.env.SUPABASE_URL!;
          const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!;
          const sb = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: request.headers.get("authorization") ?? "" } } });
          const { data: { user } } = await sb.auth.getUser();
          if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

          const body = await request.json().catch(() => ({}));
          const parsed = Body.safeParse(body);
          if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });

          const { data: client } = await supabaseAdmin
            .from("clients").select("id, organization_id, ga4_property")
            .eq("id", parsed.data.clientId).maybeSingle();
          if (!client) return Response.json({ ok: false, error: "Client not found" });
          const { data: m } = await supabaseAdmin
            .from("app_users").select("role")
            .eq("user_id", user.id).eq("organization_id", client.organization_id).maybeSingle();
          if (!m) return Response.json({ ok: false, error: "Forbidden" });
          if (!client.ga4_property) return Response.json({ ok: false, error: "Kein GA4-Property gesetzt." });
          if (!(await isProviderEnabled(client.id, "google"))) return Response.json({ ok: false, error: "Google-Integration für diesen Kunden deaktiviert." }, { status: 403 });

          const { accessToken } = await getGoogleAccessToken(client.id);
          const propertyId = client.ga4_property.replace(/^properties\//, "");
          const url = `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`;
          const res = await fetch(url, {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              dateRanges: [{ startDate: `${parsed.data.days}daysAgo`, endDate: "today" }],
              metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "engagedSessions" }, { name: "screenPageViews" }],
            }),
          });
          if (!res.ok) {
            const t = await res.text().catch(() => "");
            return Response.json({ ok: false, error: redactSecrets(`GA4 HTTP ${res.status}: ${t}`) });
          }
          const json = await res.json() as { rows?: Array<{ metricValues: Array<{ value: string }> }> };
          const row = json.rows?.[0]?.metricValues ?? [];
          return Response.json({
            ok: true,
            days: parsed.data.days,
            metrics: {
              sessions: Number(row[0]?.value ?? 0),
              totalUsers: Number(row[1]?.value ?? 0),
              engagedSessions: Number(row[2]?.value ?? 0),
              screenPageViews: Number(row[3]?.value ?? 0),
            },
          });
        } catch (e) {
          return Response.json({ ok: false, error: redactSecrets(e) });
        }
      },
    },
  },
});
