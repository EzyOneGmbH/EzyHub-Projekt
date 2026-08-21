import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { secretStatus } from "@/server/secretbox.server";
import { requireTeamRole } from "@/server/team-guard.server";

// Security-Runde 2 (21.08.2026): Zustand der WordPress-Secrets fuer die
// Admin-Ansicht — AUSSCHLIESSLICH Zaehler (aktuell/veraltet/klartext/
// fehlerhaft), niemals Secret-Inhalte, IDs oder Fehlerdetails. Nur owner/admin;
// gezaehlt wird ausschliesslich der Bestand der EIGENEN Organisation.
export const Route = createFileRoute("/api/admin/secret-status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const ctx = await requireTeamRole(request, "admin");
        if (ctx instanceof Response) return ctx;

        // Verbindungen der eigenen Organisation: oauth_connections traegt
        // client_id — Org-Grenze via clients.organization_id.
        const sb = supabaseAdmin as any;
        const { data: clients } = await sb
          .from("clients")
          .select("id")
          .eq("organization_id", ctx.organizationId);
        const ids = (clients || []).map((c: any) => c.id);
        let rows: any[] = [];
        if (ids.length) {
          const { data } = await sb
            .from("oauth_connections")
            .select("access_token, client_id")
            .eq("provider", "wordpress")
            .in("client_id", ids);
          rows = data || [];
        }

        const zaehler = { aktuell: 0, veraltet: 0, klartext: 0, fehlerhaft: 0 };
        for (const r of rows) {
          const stored = String(r.access_token ?? "");
          if (!stored) continue;
          zaehler[secretStatus(stored)]++;
        }
        return Response.json(
          {
            ok: true,
            gesamt: rows.length,
            ...zaehler,
            strictModus: String(process.env.WP_SECRETS_STRICT || "") === "1",
            dedizierterSchluessel: Boolean(process.env.WP_SECRET_KEY_V1),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
