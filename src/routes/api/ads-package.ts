import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireTeamRole } from "@/server/team-guard.server";
import { ADS_PAKETE, adsPaketVon, mitAdsPaket, type AdsPaketId } from "@/lib/adsPakete";

// EzyPerformance-Paket (Starter/Medium/Performance) eines Kunden setzen oder
// entfernen (28.09.2026). Nur Owner/Admin der aktiven Organisation; schreibt
// clients.metadata.ads_package per Merge — andere metadata-Felder bleiben.

const Body = z.object({
  clientId: z.string().uuid(),
  paket: z.enum(ADS_PAKETE.map((p) => p.id) as [AdsPaketId, ...AdsPaketId[]]).nullable(),
});

export const Route = createFileRoute("/api/ads-package")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const t = await requireTeamRole(request, "admin");
        if (t instanceof Response) return t;
        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });
        const { clientId, paket } = parsed.data;

        const sb = supabaseAdmin as any;
        const { data: client } = await sb
          .from("clients")
          .select("id, metadata")
          .eq("id", clientId)
          .eq("organization_id", t.organizationId)
          .maybeSingle();
        if (!client)
          return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });

        if (adsPaketVon(client.metadata) !== paket) {
          const { error } = await sb
            .from("clients")
            .update({ metadata: mitAdsPaket(client.metadata, paket) })
            .eq("id", client.id);
          if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        }
        return Response.json({ ok: true, paket });
      },
    },
  },
});
