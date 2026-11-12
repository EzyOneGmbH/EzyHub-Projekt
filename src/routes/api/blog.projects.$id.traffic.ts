import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireBlogProject } from "@/server/blog-autopilot.server";
import { getGoogleAccessToken } from "@/server/google-tokens.server";
import { GSC_END_LAG_DAYS, gscRows, gscTotals } from "@/server/gsc.server";

// GET /api/blog/projects/:id/traffic?tage=7|28|90 (Blog-Dashboard
// «Suchverkehr»): Tageswerte aus der Search Console des Kunden, die Summen
// des Zeitraums und des Zeitraums davor sowie die stärksten Suchanfragen.
// Ohne Google-Verbindung: { verbunden: false }, kein Fehler.

const ERLAUBT = [7, 28, 90];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const vor = (n: number) => iso(new Date(Date.now() - n * 86_400_000));

export const Route = createFileRoute("/api/blog/projects/$id/traffic")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const r = await requireBlogProject(request, params.id);
        if (r instanceof Response) return r;
        const gewuenscht = Number(new URL(request.url).searchParams.get("tage"));
        const tage = ERLAUBT.includes(gewuenscht) ? gewuenscht : 28;

        const { data: client } = await (supabaseAdmin as any)
          .from("clients")
          .select("gsc_property")
          .eq("id", r.project.client_id)
          .maybeSingle();
        if (!client?.gsc_property) return Response.json({ ok: true, verbunden: false });
        let accessToken: string;
        try {
          ({ accessToken } = await getGoogleAccessToken(r.project.client_id));
        } catch {
          return Response.json({ ok: true, verbunden: false });
        }

        const basis = { site: client.gsc_property as string, accessToken, timeoutMs: 20_000 };
        const jetzt = {
          startDate: vor(GSC_END_LAG_DAYS + tage - 1),
          endDate: vor(GSC_END_LAG_DAYS),
        };
        const davor = {
          startDate: vor(GSC_END_LAG_DAYS + 2 * tage - 1),
          endDate: vor(GSC_END_LAG_DAYS + tage),
        };
        try {
          const [verlauf, summe, vorher, anfragen] = await Promise.all([
            gscRows({ ...basis, ...jetzt, dimensions: ["date"], rowLimit: 120 }),
            gscTotals({ ...basis, ...jetzt }),
            gscTotals({ ...basis, ...davor }),
            gscRows({ ...basis, ...jetzt, dimensions: ["query"], rowLimit: 10 }),
          ]);
          const kurz = (t: any) => ({
            clicks: t.clicks,
            impressions: t.impressions,
            ctr: t.ctr,
            position: t.position,
          });
          return Response.json({
            ok: true,
            verbunden: true,
            tage,
            von: jetzt.startDate,
            bis: jetzt.endDate,
            verlauf: verlauf.rows
              .map((z) => ({ date: z.keys[0], clicks: z.clicks, impressions: z.impressions }))
              .sort((a, b) => a.date.localeCompare(b.date)),
            summe: kurz(summe),
            vorher: kurz(vorher),
            anfragen: anfragen.rows.slice(0, 10).map((z) => ({
              query: z.keys[0],
              clicks: z.clicks,
              impressions: z.impressions,
              ctr: z.ctr,
              position: z.position,
            })),
          });
        } catch {
          // Keine Google-Fehlertexte nach aussen (können Property-Namen enthalten).
          return Response.json({ ok: true, verbunden: true, fehler: true });
        }
      },
    },
  },
});
