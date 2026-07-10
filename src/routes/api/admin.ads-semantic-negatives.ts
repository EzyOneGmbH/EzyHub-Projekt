import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { queueSemanticNegatives } from "@/server/google-ads-semantic.server";

// Phase 2 (Erweiterungs-Brief): Semantische Negative-Vorschlaege des Agenten
// entgegennehmen, DETERMINISTISCH nachpruefen (Konfliktcheck, no_touch, Dedupe
// gegen bestehende Negatives + offene Approvals, Limit 15/Run) und als
// approval-needed queuen. IMMER approval-needed - nie auto-execute, unabhaengig
// vom autonomy_level (LLM-Urteile gehoeren in die Freigabe-Queue).
// Server-to-server, ADMIN_AUTOMATION_SECRET.

const Body = z.object({
  clientId: z.string().uuid(),
  runId: z.string().min(1),
  proposals: z
    .array(
      z.object({
        term: z.string().min(1).max(120),
        campaign: z.string().min(1),
        adGroup: z.string().optional().default(""),
        kategorie: z.string().min(1).max(40),
        begruendung: z.string().min(1).max(400),
        matchType: z.enum(["EXACT", "PHRASE"]).default("EXACT"),
        costChf: z.number().nonnegative().default(0),
        clicks: z.number().nonnegative().default(0),
      }),
    )
    .max(50), // Agent soll selbst auf 15 begrenzen; hartes Server-Limit greift zusaetzlich
});

export const Route = createFileRoute("/api/admin/ads-semantic-negatives")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret)
          return Response.json({ ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" }, { status: 503 });
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Invalid input", details: parsed.error.issues.slice(0, 3) }, { status: 400 });

        const r = await queueSemanticNegatives(parsed.data);
        return Response.json(r, { status: r.ok ? 200 : 500 });
      },
    },
  },
});
