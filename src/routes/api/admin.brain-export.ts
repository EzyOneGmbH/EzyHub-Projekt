import { createFileRoute } from "@tanstack/react-router";
import { brainSeitenFuerKunde } from "@/server/brain-export.server";

// EzyBrain-Spiegel (20.11.2026): liefert die Kennzahlen eines Kunden als fertige
// Markdown-Seiten (Keywords, Traffic, Conversions, KI-Sichtbarkeit, Content). Der
// agent-service holt sie hier ab und legt sie im Vault unter clients/<slug>/ ab.
// Secret-gated, read-only. Keine Zugangsdaten, keine Property-IDs, keine Personendaten.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/admin/brain-export")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret)
          return Response.json(
            { ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" },
            { status: 503 },
          );
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

        const clientId = new URL(request.url).searchParams.get("clientId") || "";
        if (!UUID.test(clientId))
          return Response.json({ ok: false, error: "clientId fehlt" }, { status: 400 });

        try {
          const r = await brainSeitenFuerKunde(clientId);
          if (!r)
            return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });
          return Response.json(
            {
              ok: true,
              clientId,
              name: r.name,
              generatedAt: new Date().toISOString(),
              seiten: r.seiten,
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch (e) {
          console.error("brain-export:", e instanceof Error ? e.message : e);
          return Response.json({ ok: false, error: "Export fehlgeschlagen" }, { status: 500 });
        }
      },
    },
  },
});
