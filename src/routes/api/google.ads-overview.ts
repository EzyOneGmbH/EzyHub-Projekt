import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { redactSecrets } from "@/server/google-oauth.server";
import { isProviderEnabled } from "@/server/integrations.server";
import { adsFenster } from "@/server/google-ads.server";
import { fetchAdsOverviewZeile, type OverviewZeile } from "@/server/google-ads-overview.server";
import { ZeitraumFehler } from "@/lib/date-range";

// Agentur-Performance-Tabelle (EzyPerformance, 25.09.2026): Kontokennzahlen
// mehrerer Kunden fuer Zeitraum + Vergleich. Nur lesend, keine Persistenz.

const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Body = z.object({
  clientIds: z.array(z.string().uuid()).min(1).max(40),
  startDate: Ymd,
  endDate: Ymd,
  compareStart: Ymd.optional(),
  compareEnd: Ymd.optional(),
});

const PARALLEL = 4;

export const Route = createFileRoute("/api/google/ads-overview")({
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
          const { clientIds, startDate, endDate, compareStart, compareEnd } = parsed.data;
          const range = { startDate, endDate };
          const compareRange =
            compareStart && compareEnd ? { start: compareStart, end: compareEnd } : null;
          let fenster;
          try {
            fenster = adsFenster(range, compareRange);
          } catch (e) {
            if (e instanceof ZeitraumFehler)
              return Response.json({ ok: false, error: e.message }, { status: 400 });
            throw e;
          }

          // Sichtbarkeit ueber RLS des Nutzers: nur Kunden, die er lesen darf.
          const { data: sichtbar } = await sb.from("clients").select("id").in("id", clientIds);
          const erlaubt = new Set((sichtbar ?? []).map((c: { id: string }) => c.id));
          const { data: clients } = await supabaseAdmin
            .from("clients")
            .select("id, google_ads_customer")
            .in(
              "id",
              clientIds.filter((id) => erlaubt.has(id)),
            );

          const rows: OverviewZeile[] = [];
          const liste = clients ?? [];
          for (let i = 0; i < liste.length; i += PARALLEL) {
            const block = await Promise.all(
              liste.slice(i, i + PARALLEL).map(async (c) => {
                if (!(await isProviderEnabled(c.id, "google")))
                  return {
                    clientId: c.id,
                    cur: null,
                    prev: null,
                    error: "Google-Integration deaktiviert",
                  };
                return fetchAdsOverviewZeile(c.id, c.google_ads_customer, range, compareRange);
              }),
            );
            rows.push(...block);
          }

          return Response.json({
            ok: true,
            range: { from: fenster.aktuell.startDate, to: fenster.aktuell.endDate },
            prevRange: { from: fenster.vorher.startDate, to: fenster.vorher.endDate },
            rows,
          });
        } catch (e) {
          return Response.json({ ok: false, error: redactSecrets(e) });
        }
      },
    },
  },
});
