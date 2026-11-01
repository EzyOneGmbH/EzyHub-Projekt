import { createFileRoute } from "@tanstack/react-router";
import { ladeAktionen, ladeKunde } from "@/server/content-actions.server";

// Offene Content-Massnahmen eines Kunden (01.11.2026) — dieselbe Artikelliste,
// dieselben Regeln/Schwellen (View content_decision, 28-Tage-Fenster) und
// dieselben Texte wie das Massnahmen-Modal im EzyRank-Blog-Register.
// Nur lesend. Schutz wie /api/admin/seo-report (ADMIN_AUTOMATION_SECRET).
// GET ?client=<client_id>
// Antwort: { client, period, actions[] } — actions nach priority_score absteigend.

export const Route = createFileRoute("/api/admin/content-actions")({
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

        const id = new URL(request.url).searchParams.get("client") || "";
        try {
          const kunde = await ladeKunde(id);
          if (!kunde)
            return Response.json({ ok: false, error: "Kunde unbekannt" }, { status: 404 });
          const { actions, period } = await ladeAktionen(kunde.id);
          return Response.json(
            {
              client: { id: kunde.id, name: kunde.name, domain: kunde.domain },
              period,
              actions,
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch (e) {
          return Response.json(
            { ok: false, error: String((e as Error)?.message || e).slice(0, 200) },
            { status: 500 },
          );
        }
      },
    },
  },
});
