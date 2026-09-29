import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { redactSecrets } from "@/server/google-oauth.server";
import { adsFenster } from "@/server/google-ads.server";
import { ZeitraumFehler } from "@/lib/date-range";
import { requireTeamRole } from "@/server/team-guard.server";
import { fetchAiAdsZeile, fetchAiOrganicZeile } from "@/server/aivis-overview.server";

// Agentur-Performance-Tabelle EzyAI (29.09.2026, analog /api/google/seo-overview):
// mode "organic" = KI-Besucher/-Conversions + KI-Sichtbarkeit, mode "ads" =
// ChatGPT Ads + GA4 (chatgpt / cpc) — mehrere Kunden fuer Zeitraum + Vergleich.
// Nur lesend, keine Persistenz.

const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Body = z.object({
  mode: z.enum(["organic", "ads"]),
  clientIds: z.array(z.string().uuid()).min(1).max(40),
  startDate: Ymd,
  endDate: Ymd,
  compareStart: Ymd.optional(),
  compareEnd: Ymd.optional(),
});

const PARALLEL = 4;

export const Route = createFileRoute("/api/admin/aivis-overview")({
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
          // Nur Mitarbeiter (owner/admin/member) — Kundenportal (viewer) 403.
          const team = await requireTeamRole(request, "member");
          if (team instanceof Response) return team;

          const parsed = Body.safeParse(await request.json().catch(() => ({})));
          if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });
          const { mode, clientIds, startDate, endDate, compareStart, compareEnd } = parsed.data;
          let fenster;
          try {
            fenster = adsFenster(
              { startDate, endDate },
              compareStart && compareEnd ? { start: compareStart, end: compareEnd } : null,
            );
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
            .select("id, ga4_property")
            .in(
              "id",
              clientIds.filter((id) => erlaubt.has(id)),
            );

          const rows: any[] = [];
          const liste = clients ?? [];
          for (let i = 0; i < liste.length; i += PARALLEL) {
            const block = await Promise.all(
              liste.slice(i, i + PARALLEL).map(async (c) => {
                try {
                  return mode === "ads"
                    ? await fetchAiAdsZeile(c, fenster)
                    : await fetchAiOrganicZeile(c, fenster);
                } catch (e) {
                  return {
                    clientId: c.id,
                    cur: null,
                    prev: null,
                    hinweise: [],
                    error: redactSecrets(e).slice(0, 200),
                  };
                }
              }),
            );
            rows.push(...block);
          }

          return Response.json({
            ok: true,
            mode,
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
