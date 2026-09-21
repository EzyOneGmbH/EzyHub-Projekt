import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  backfillSchritt,
  backfillStarten,
  laufTaeglich,
  redaktiereFehler,
} from "@/server/first-party-sync.server";

// First-Party-KPIs, Phase 2b (22.09.2026, Volkan): Datenlauf-Endpunkt fuer
// pg_cron (Vault-Secret admin_automation_secret, Muster admin.client-flags).
//   daily          Tagesfenster aller freigeschalteten Kunden (04:40 UTC)
//   backfill       naechste Monatsbloecke rueckwaerts, so viele wie das
//                  Zeitbudget (240 s) erlaubt (alle 15 min)
//   backfill-start Ziel fuer einen Kunden setzen (16 Monate GSC / 14 GA4)
// Antworten enthalten nur Kennzahlen und redaktierte Fehlertexte — nie
// Tokens oder Schluessel.

const Body = z.object({
  action: z.enum(["daily", "backfill", "backfill-start"]),
  clientId: z.string().uuid().optional(),
  quelle: z.enum(["gsc", "ga4"]).optional(),
  source: z.string().max(40).optional(),
});

export const Route = createFileRoute("/api/admin/first-party-sync")({
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

        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });
        const { action, clientId, quelle, source } = parsed.data;
        const sb = supabaseAdmin as any;
        const t0 = Date.now();

        try {
          if (action === "backfill-start") {
            if (!clientId)
              return Response.json({ ok: false, error: "clientId fehlt" }, { status: 400 });
            const ziele = await backfillStarten(sb, clientId, quelle);
            return Response.json({ ok: true, action, source: source ?? null, clientId, ziele });
          }
          if (action === "daily") {
            const r = await laufTaeglich({ sb, nurClientId: clientId });
            const ok = r.ergebnisse.filter((e) => e.ok).length;
            return Response.json({
              ok: true,
              action,
              source: source ?? null,
              kunden: r.kunden,
              quellenOk: ok,
              quellenFehler: r.ergebnisse.length - ok,
              zeilen: r.ergebnisse.reduce((a, e) => a + e.zeilen, 0),
              abgebrochen: r.abgebrochen,
              ergebnisse: r.ergebnisse,
              dauerMs: Date.now() - t0,
            });
          }
          const r = await backfillSchritt({ sb });
          return Response.json({
            ok: true,
            action,
            source: source ?? null,
            verarbeitet: r.verarbeitet,
            fertig: r.fertig,
            offen: r.offen,
            abgebrochen: r.abgebrochen,
            zeilen: r.bloecke.reduce((a, b) => a + b.zeilen, 0),
            bloecke: r.bloecke,
            dauerMs: Date.now() - t0,
          });
        } catch (e) {
          return Response.json(
            { ok: false, action, error: redaktiereFehler(e), dauerMs: Date.now() - t0 },
            { status: 500 },
          );
        }
      },
    },
  },
});
