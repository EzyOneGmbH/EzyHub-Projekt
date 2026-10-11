import { createFileRoute } from "@tanstack/react-router";
import { waermeUebersichtVor } from "@/server/uebersicht-vorwaermen.server";
import { redactSecrets } from "@/server/google-oauth.server";

// Stündliches Vorwärmen der Agentur-Übersicht (11.10.2026) — nur für pg_cron
// (Vault-Secret admin_automation_secret, Muster admin.first-party-sync).
// Antwort enthält nur Zähler, nie Kundendaten oder Schlüssel.
export const Route = createFileRoute("/api/admin/uebersicht-warm")({
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
        try {
          const r = await waermeUebersichtVor();
          return Response.json({ ok: true, ...r });
        } catch (e) {
          return Response.json({ ok: false, error: redactSecrets(e).slice(0, 200) });
        }
      },
    },
  },
});
