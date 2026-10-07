import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { redactSecrets } from "@/server/google-oauth.server";
import { isProviderEnabled } from "@/server/integrations.server";
import { fetchAdsKanaele } from "@/server/google-ads-kanaele.server";
import { zeitraum, ZeitraumFehler } from "@/lib/date-range";

// Conversions-Kanal-Tabelle (07.10.2026): Google-Ads-Zahlen fuer «Paid Search»
// und «Cross-network», nur bei Kunden mit EzyPerformance (client_app_access
// app «ads»; keine Zeile = aktiv) + hinterlegtem Ads-Konto + Google aktiv.
// Sonst aktiv:false → die Tabelle bleibt bei GA4. Nur lesend.

const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Body = z.object({ clientId: z.string().uuid(), startDate: Ymd, endDate: Ymd });

export const Route = createFileRoute("/api/google/ads-kanaele")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const sb = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!,
            { global: { headers: { Authorization: request.headers.get("authorization") ?? "" } } },
          );
          const {
            data: { user },
          } = await sb.auth.getUser();
          if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
          const parsed = Body.safeParse(await request.json().catch(() => ({})));
          if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });
          const { clientId, startDate, endDate } = parsed.data;
          let z;
          try {
            z = zeitraum({ startDate, endDate, maxDays: 366 });
          } catch (e) {
            if (e instanceof ZeitraumFehler)
              return Response.json({ ok: false, error: e.message }, { status: 400 });
            throw e;
          }
          // Sichtbarkeit ueber RLS des Nutzers.
          const { data: sichtbar } = await sb.from("clients").select("id").eq("id", clientId);
          if (!sichtbar?.length)
            return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
          const { data: client } = await supabaseAdmin
            .from("clients")
            .select("id, google_ads_customer")
            .eq("id", clientId)
            .maybeSingle();
          if (!client?.google_ads_customer)
            return Response.json({ ok: true, aktiv: false, grund: "kein Ads-Konto" });
          const { data: zugriff } = await (supabaseAdmin as any)
            .from("client_app_access")
            .select("enabled")
            .eq("client_id", clientId)
            .eq("app", "ads")
            .maybeSingle();
          if (zugriff && zugriff.enabled === false)
            return Response.json({ ok: true, aktiv: false, grund: "EzyPerformance nicht aktiv" });
          if (!(await isProviderEnabled(clientId, "google")))
            return Response.json({
              ok: true,
              aktiv: false,
              grund: "Google-Integration deaktiviert",
            });
          const r = await fetchAdsKanaele(clientId, client.google_ads_customer, z);
          if (!r.ok) return Response.json({ ok: true, aktiv: false, grund: r.error });
          return Response.json({
            ok: true,
            aktiv: true,
            range: { from: z.startDate, to: z.endDate },
            ...r.kanaele,
          });
        } catch (e) {
          return Response.json({ ok: false, error: redactSecrets(e) });
        }
      },
    },
  },
});
