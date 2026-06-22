import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { redactSecrets } from "@/server/google-oauth.server";
import { isProviderEnabled, canRunAudits } from "@/server/integrations.server";
import { fetchAdsSnapshot } from "@/server/google-ads.server";

// Google Ads performance data: account totals, daily series, campaign breakdown
// (with revenue + ROAS), conversion-action split and previous-period comparison.
// Persists audit_runs(audit_type="google_ads"). Requires GOOGLE_ADS_DEVELOPER_TOKEN.

const Body = z.object({
  clientId: z.string().uuid(),
  days: z.number().int().min(1).max(90).default(28),
  compareStart: z.string().optional(),
  compareEnd: z.string().optional(),
});

export const Route = createFileRoute("/api/google/ads-data")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const supabaseUrl = process.env.SUPABASE_URL!;
          const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!;
          const sb = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
          });
          const {
            data: { user },
          } = await sb.auth.getUser();
          if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

          const parsed = Body.safeParse(await request.json().catch(() => ({})));
          if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });

          const { data: client } = await supabaseAdmin
            .from("clients")
            .select("id, organization_id, google_ads_customer")
            .eq("id", parsed.data.clientId)
            .maybeSingle();
          if (!client) return Response.json({ ok: false, error: "Client not found" });
          const { data: m } = await supabaseAdmin
            .from("app_users")
            .select("role")
            .eq("user_id", user.id)
            .eq("organization_id", client.organization_id)
            .maybeSingle();
          if (!m) return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
          if (!(await canRunAudits(user.id, client.organization_id)))
            return Response.json(
              { ok: false, error: "Keine Berechtigung für Audit-Läufe (viewer/read-only)." },
              { status: 403 },
            );
          if (!(await isProviderEnabled(client.id, "google")))
            return Response.json(
              { ok: false, error: "Google-Integration für diesen Kunden deaktiviert." },
              { status: 403 },
            );

          const compareRange =
            parsed.data.compareStart && parsed.data.compareEnd
              ? { start: parsed.data.compareStart, end: parsed.data.compareEnd }
              : null;
          const snap = await fetchAdsSnapshot(
            client.id,
            client.google_ads_customer,
            parsed.data.days,
            compareRange,
          );
          if (!snap.ok || !snap.result)
            return Response.json({ ok: false, error: snap.skipped || "Ads-Abruf fehlgeschlagen" });

          const nowIso = () => new Date().toISOString();
          try {
            await supabaseAdmin.from("audit_runs").insert({
              client_id: client.id,
              organization_id: client.organization_id,
              triggered_by: user.id,
              audit_type: "google_ads",
              status: "succeeded",
              input: { days: parsed.data.days },
              result: snap.result as never,
              started_at: nowIso(),
              finished_at: nowIso(),
            });
          } catch {
            /* non-fatal */
          }

          return Response.json({ ok: true, ...snap.result });
        } catch (e) {
          return Response.json({ ok: false, error: redactSecrets(e) });
        }
      },
    },
  },
});
