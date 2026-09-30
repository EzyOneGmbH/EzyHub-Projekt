import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireTeamRole } from "@/server/team-guard.server";
import {
  SISTRIX_LAENDER,
  mitSistrixLand,
  sistrixLandVon,
  type SistrixLandId,
} from "@/lib/sistrixLand";

// Sistrix-Land eines Kunden setzen (30.09.2026, analog /api/ads-package). Nur
// Owner/Admin der aktiven Organisation; schreibt clients.metadata.sistrix_country
// per Merge — andere metadata-Felder bleiben. Wirkt ab der naechsten
// Backlink-Messung (Visibility Index).

const Body = z.object({
  clientId: z.string().uuid(),
  land: z.enum(SISTRIX_LAENDER.map((l) => l.id) as [SistrixLandId, ...SistrixLandId[]]),
});

export const Route = createFileRoute("/api/sistrix-land")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const t = await requireTeamRole(request, "admin");
        if (t instanceof Response) return t;
        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });
        const { clientId, land } = parsed.data;

        const sb = supabaseAdmin as any;
        const { data: client } = await sb
          .from("clients")
          .select("id, metadata")
          .eq("id", clientId)
          .eq("organization_id", t.organizationId)
          .maybeSingle();
        if (!client)
          return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });

        if (sistrixLandVon(client.metadata) !== land) {
          const { error } = await sb
            .from("clients")
            .update({ metadata: mitSistrixLand(client.metadata, land) })
            .eq("id", client.id);
          if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        }
        return Response.json({ ok: true, land });
      },
    },
  },
});
