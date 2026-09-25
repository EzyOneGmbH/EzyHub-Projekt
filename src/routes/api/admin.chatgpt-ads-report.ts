import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { zeitraumAusParams } from "@/lib/date-range";
import { buildAdsReport } from "@/server/chatgpt-ads-report.server";

// ChatGPT-Ads-Report (25.09.2026): GA4 (Quelle chatgpt / Medium cpc) und
// OpenAI Ads kombiniert je Kampagne und Region — Tab «Report» im Ads-Modus.
//
// GET ?client=<uuid>&start=YYYY-MM-DD&end=YYYY-MM-DD (oder &days=N) [&debug=1]
// Auth: eingeloggter User (Kundensicht via RLS, also auch Kundenlogins) ODER
// Bearer ADMIN_AUTOMATION_SECRET. Reines Lesen.

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

export const Route = createFileRoute("/api/admin/chatgpt-ads-report")({
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
        // Sichtbarkeit: RLS des Users entscheidet (can_access_client).
        const sb = acc.userClient ?? (supabaseAdmin as any);
        const { data: client } = await sb
          .from("clients")
          .select("id, name, ga4_property")
          .eq("id", clientId)
          .maybeSingle();
        if (!client)
          return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });
        try {
          const report = await buildAdsReport(client, zr, { debug: !!u.searchParams.get("debug") });
          return Response.json(report, { headers: { "Cache-Control": "no-store" } });
        } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 500 },
          );
        }
      },
    },
  },
});
