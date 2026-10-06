import { createFileRoute } from "@tanstack/react-router";
import { redactSecrets } from "@/server/google-oauth.server";
import { gleichZeitkonstant } from "@/server/ingest-auth.server";
import { synchronisiereAlleAdsKunden, syncPresets } from "@/server/google-ads-sync.server";

// Google-Ads Auto-Sync (Volkan 06.10.2026): pg_cron «ezy-google-ads-sync» ruft
// alle 4 Stunden POST { source: "pg_cron", presets?: number[] } auf.
// Auth: Bearer ADMIN_AUTOMATION_SECRET (Vault-Secret admin_automation_secret).
// Speichert je Kunde und Preset einen Snapshot (siehe google-ads-sync.server).

const BUDGET_MS = 240_000; // pg_net-Timeout im Cron: 295 s

export const Route = createFileRoute("/api/admin/ads-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        const auth = request.headers.get("authorization") || "";
        if (!secret || !gleichZeitkonstant(auth, `Bearer ${secret}`))
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        try {
          const presets = syncPresets(body?.presets);
          const ergebnis = await synchronisiereAlleAdsKunden({ presets, budgetMs: BUDGET_MS });
          return Response.json({
            ok: true,
            source: String(body?.source || "manuell"),
            ...ergebnis,
          });
        } catch (e) {
          return Response.json({ ok: false, error: redactSecrets(e) }, { status: 500 });
        }
      },
    },
  },
});
