import { createFileRoute } from "@tanstack/react-router";
import { gratisTakt } from "@/server/gratis-takt.server";
import { redactSecrets } from "@/server/google-oauth.server";

// Stündlicher Gratis-Takt EzyRank (11.10.2026) — nur für pg_cron (alle 5 min,
// Vault-Secret admin_automation_secret). Antwort enthält nur Zähler.
export const Route = createFileRoute("/api/admin/gratis-takt")({
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
          const origin = new URL(request.url).origin;
          return Response.json({ ok: true, ...(await gratisTakt(origin, secret)) });
        } catch (e) {
          return Response.json({ ok: false, error: redactSecrets(e).slice(0, 200) });
        }
      },
    },
  },
});
