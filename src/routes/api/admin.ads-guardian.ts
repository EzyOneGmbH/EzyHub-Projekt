import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runGuardianForClient } from "@/server/google-ads-guardian.server";

// Taeglicher Waechter-Lauf (Phase 1): POST {clientId} fuer einen Kunden oder
// ohne clientId fuer alle Kunden mit Google-Ads-Konto. Rein lesend gegenueber
// Google Ads - erzeugt KEINE Actions und KEINE Approvals, schreibt nur das
// ads_guardian_log. Aufrufer: n8n (taeglich 07:30 Europe/Zurich).
// Server-to-server, ADMIN_AUTOMATION_SECRET.

export const Route = createFileRoute("/api/admin/ads-guardian")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret)
          return Response.json(
            { ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" },
            { status: 503 },
          );
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

        const body = (await request.json().catch(() => ({}))) as { clientId?: string };
        let q = supabaseAdmin
          .from("clients")
          .select("id, name, google_ads_customer")
          .not("google_ads_customer", "is", null);
        if (body.clientId) q = q.eq("id", body.clientId);
        const { data: clients, error } = await q;
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        if (!clients?.length)
          return Response.json(
            { ok: false, error: "kein Kunde mit google_ads_customer gefunden" },
            { status: 404 },
          );

        const results = [];
        for (const c of clients) {
          try {
            results.push(await runGuardianForClient(c));
          } catch (e) {
            results.push({
              clientId: c.id,
              clientName: c.name,
              checkedAt: new Date().toISOString(),
              status: "critical",
              findings: [],
              skipped: `Guardian-Fehler: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`,
            });
          }
        }
        const worst = results.some((r) => r.status === "critical")
          ? "critical"
          : results.some((r) => r.status === "warn")
            ? "warn"
            : "ok";
        return Response.json({ ok: true, status: worst, count: results.length, results });
      },
    },
  },
});
