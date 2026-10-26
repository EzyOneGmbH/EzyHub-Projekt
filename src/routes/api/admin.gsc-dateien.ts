import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "@/server/google-tokens.server";
import { gscRows, gscTotals, GSC_END_LAG_DAYS } from "@/server/gsc.server";
import { zeitraum, zeitraumAusParams } from "@/lib/date-range";

// Datei-Klicks aus der Google-Suche (Volkan 07.10.2026, excent): GA4 misst
// Downloads erst ab Einschalten der Erweiterten Messung — rueckwirkend liefert
// nur die Search Console, wie oft Dateien (PDF, Excel, Word, PowerPoint, ZIP)
// DIREKT aus der Google-Suche angeklickt wurden (bis 16 Monate).
//
// GET ?client=<uuid>[&start&end | &days=N]  (Default: 16 Monate, max. 490 Tage)
// → { ok, range, totals, dateien:[{url, clicks, impressions, ctr, position,
//     queries:[{query, clicks, impressions}]}] }
// Auth: eingeloggter User (RLS) ODER Bearer ADMIN_AUTOMATION_SECRET. Nur lesend.

const DATEI_RE = "\\.(pdf|xlsx?|docx?|pptx?|zip|csv)(\\?|#|$)";

async function requireAccess(request: Request): Promise<{ userClient: any | null } | Response> {
  const admin = process.env.ADMIN_AUTOMATION_SECRET;
  const auth = request.headers.get("authorization") || "";
  if (admin && auth === `Bearer ${admin}`) return { userClient: null };
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anon)
    return Response.json({ ok: false, error: "Server not configured" }, { status: 503 });
  const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data } = await userClient.auth.getUser();
  if (!data.user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return { userClient };
}

export const Route = createFileRoute("/api/admin/gsc-dateien")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const acc = await requireAccess(request);
        if (acc instanceof Response) return acc;
        const u = new URL(request.url);
        const clientId = u.searchParams.get("client") || "";
        if (!/^[0-9a-f-]{36}$/i.test(clientId))
          return Response.json({ ok: false, error: "client (uuid) erforderlich" }, { status: 400 });
        let zr;
        try {
          const zr0 = zeitraumAusParams(u.searchParams, { defaultDays: 486, maxDays: 490 });
          zr =
            zr0.quelle === "custom"
              ? zr0
              : zeitraum({ days: zr0.days, endLagDays: GSC_END_LAG_DAYS, maxDays: 490 });
        } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 400 },
          );
        }
        const sb = acc.userClient ?? (supabaseAdmin as any);
        const { data: client } = await sb
          .from("clients")
          .select("id, gsc_property")
          .eq("id", clientId)
          .maybeSingle();
        if (!client)
          return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });
        if (!client.gsc_property)
          return Response.json(
            { ok: false, error: "Keine Search Console verbunden" },
            { status: 400 },
          );
        try {
          const token = (await getGoogleAccessToken(clientId)).accessToken;
          const basis = {
            site: String(client.gsc_property),
            accessToken: token,
            startDate: zr.startDate,
            endDate: zr.endDate,
            timeoutMs: 30_000,
          };
          const nurDateien = {
            dimensionFilterGroups: [
              {
                filters: [
                  {
                    dimension: "page" as const,
                    operator: "includingRegex" as const,
                    expression: DATEI_RE,
                  },
                ],
              },
            ],
          };
          const [gesamt, seiten, seitenQueries] = await Promise.all([
            gscTotals(basis),
            gscRows({ ...basis, filter: nurDateien, dimensions: ["page"], rowLimit: 1000 }),
            gscRows({
              ...basis,
              filter: nurDateien,
              dimensions: ["page", "query"],
              rowLimit: 5000,
            }),
          ]);
          const qJe = new Map<
            string,
            Array<{ query: string; clicks: number; impressions: number }>
          >();
          for (const r of seitenQueries.rows as any[]) {
            const [page, query] = r.keys || [];
            const l = qJe.get(page) ?? [];
            l.push({
              query,
              clicks: Number(r.clicks || 0),
              impressions: Number(r.impressions || 0),
            });
            qJe.set(page, l);
          }
          const dateien = (seiten.rows as any[])
            .map((r) => ({
              url: String(r.keys?.[0] || ""),
              clicks: Number(r.clicks || 0),
              impressions: Number(r.impressions || 0),
              ctr: Number(r.ctr || 0),
              position: Math.round(Number(r.position || 0) * 10) / 10,
              queries: (qJe.get(String(r.keys?.[0] || "")) ?? [])
                .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
                .slice(0, 8),
            }))
            .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
          return Response.json(
            {
              ok: true,
              range: { from: zr.startDate, to: zr.endDate, days: zr.days },
              websiteGesamt: { clicks: gesamt.clicks, impressions: gesamt.impressions },
              dateienGesamt: {
                clicks: dateien.reduce((s, d) => s + d.clicks, 0),
                impressions: dateien.reduce((s, d) => s + d.impressions, 0),
              },
              coverage: seiten.coverage,
              dateien,
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : String(e) },
            { status: 502 },
          );
        }
      },
    },
  },
});
