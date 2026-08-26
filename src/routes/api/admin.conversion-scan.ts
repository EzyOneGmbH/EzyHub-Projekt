import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runConversionScan } from "@/server/conversion-scout.server";

// Conversion-Scout — Scan-Trigger (Pilot FIH, 26.08.2026).
//
// POST {client:<uuid>} → Redirect-Resolve + Crawl (Tiefe 2, max. 40 Seiten,
// entzerrt) + Kandidaten-Upsert. Schreibt NUR 'pending'-Kandidaten —
// deployt nichts (Iron Rule: Freigabe ausschliesslich manuell im UI).
//
// Auth: eingeloggter EzyHub-User (Kunden-Sichtbarkeit via RLS) ODER
// Bearer ADMIN_AUTOMATION_SECRET (spaeterer Cron ueber alle Kunden —
// im Pilot bewusst NICHT verdrahtet).

async function resolveCaller(request: Request): Promise<{ ok: true } | Response> {
  const bearer = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const secret = process.env.ADMIN_AUTOMATION_SECRET;
  if (secret && bearer === secret) return { ok: true };

  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anon)
    return Response.json({ ok: false, error: "Server not configured" }, { status: 503 });
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
  });
  const { data } = await userClient.auth.getUser();
  if (!data.user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return { ok: true };
}

export const Route = createFileRoute("/api/admin/conversion-scan")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await resolveCaller(request);
        if (auth instanceof Response) return auth;
        const body: any = await request.json().catch(() => ({}));
        const clientId = String(body?.client || "");
        if (!/^[0-9a-f-]{36}$/i.test(clientId))
          return Response.json({ ok: false, error: "client (uuid) erforderlich" }, { status: 400 });

        const { data: client } = await (supabaseAdmin as any)
          .from("clients")
          .select("id, name, domain, organization_id")
          .eq("id", clientId)
          .maybeSingle();
        if (!client?.domain)
          return Response.json(
            { ok: false, error: "Kunde nicht gefunden oder ohne Domain" },
            { status: 404 },
          );

        try {
          const result = await runConversionScan(client);
          return Response.json({ ok: true, ...result });
        } catch (e) {
          return Response.json(
            { ok: false, error: String((e as Error)?.message || e).slice(0, 300) },
            { status: 502 },
          );
        }
      },
    },
  },
});
