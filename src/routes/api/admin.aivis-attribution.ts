import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { zeitraumAusParams } from "@/lib/date-range";
import { fetchAttribution } from "@/server/aivis-attribution.server";

// KI-Attribution live fuer einen Zeitraum (23.09.2026): macht den Datumsfilter
// im Conversions-Tab von EzyAI wirksam. Bisher zeigte der Tab den naechtlichen
// 30-Tage-Snapshot (ai_visibility_attribution), egal was oben gewaehlt war.
//
// GET ?client=<uuid>&start=YYYY-MM-DD&end=YYYY-MM-DD  (oder &days=N; Default 30,
//     max 366) -> { ok, range, attribution: [{ engine, sessions, conv, events[],
//     visitors[] }] } — dieselbe Form wie d.attribution im Dashboard.
//
// Auth: eingeloggter User (Kundensicht ueber RLS, also auch Kundenlogins) ODER
// Bearer ADMIN_AUTOMATION_SECRET. Reines Lesen, kein Schreiben.

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

export const Route = createFileRoute("/api/admin/aivis-attribution")({
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
          zr = zeitraumAusParams(u.searchParams, { defaultDays: 30, maxDays: 366 });
        } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 400 },
          );
        }
        const sb = acc.userClient ?? (supabaseAdmin as any);
        const { data: client } = await sb
          .from("clients")
          .select("id, name, ga4_property")
          .eq("id", clientId)
          .maybeSingle();
        if (!client)
          return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });
        const res = await fetchAttribution(client, zr);
        if ("error" in res) return Response.json({ ok: false, error: res.error }, { status: 502 });
        if ("skipped" in res)
          return Response.json({
            ok: true,
            ga4: false,
            range: { from: zr.startDate, to: zr.endDate, days: zr.days },
            attribution: [],
          });
        return Response.json(
          {
            ok: true,
            ga4: true,
            range: { from: zr.startDate, to: zr.endDate, days: zr.days },
            // ?debug=1: GA4-Fehlertext des Detailreports (nur Diagnose)
            ...(u.searchParams.get("debug")
              ? {
                  ...(res.detailError ? { detailError: res.detailError } : {}),
                  ...(res.detailDebug ? { detailDebug: res.detailDebug } : {}),
                }
              : {}),
            attribution: res.engines
              .map((e) => ({
                engine: e.engine,
                sessions: e.sessions,
                conv: e.conversions,
                events: e.events,
                visitors: e.visitors,
              }))
              .sort((a, b) => b.sessions - a.sessions),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
