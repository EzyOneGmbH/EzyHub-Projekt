import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { heuteYmdZuerich } from "@/lib/date-range";
import {
  berechneZeitraumStand,
  echteZeitraumQuellen,
  ladeZeitraumKunde,
} from "@/server/ezyrank-zeitraum.server";

// EzyRank-Dashboard: Rankings, GSC je Keyword und Brand-Split für den
// gewählten Zeitraum (22.10.2026) — gleiche Logik wie /api/admin/seo-report.
// Nur lesen. Zugriff: angemeldeter Benutzer, der den Kunden laut RLS sehen
// darf (Team und Kundenportal); fremde Kunden → 404.

const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Body = z.object({
  clientId: z.string().uuid(),
  startDate: Ymd,
  endDate: Ymd,
  compareEnd: Ymd.nullable().optional(),
});
const MAX_TAGE = 400;

export const Route = createFileRoute("/api/admin/ezyrank-zeitraum")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = process.env.SUPABASE_URL!;
        const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!;
        const nutzer = createClient(url, anon, {
          global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
        });
        const {
          data: { user },
        } = await nutzer.auth.getUser();
        if (!user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });
        const { clientId, startDate, endDate, compareEnd } = parsed.data;
        const heute = heuteYmdZuerich();
        const bis = endDate > heute ? heute : endDate;
        const tage = (Date.parse(bis) - Date.parse(startDate)) / 864e5 + 1;
        if (tage < 1 || tage > MAX_TAGE)
          return Response.json({ ok: false, error: "Ungültiger Zeitraum" }, { status: 400 });

        // Sichtbarkeit des Kunden über RLS des Benutzers (can_access_client)
        const { data: sichtbar } = await nutzer
          .from("clients")
          .select("id")
          .eq("id", clientId)
          .maybeSingle();
        if (!sichtbar)
          return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });

        try {
          const kunde = await ladeZeitraumKunde(clientId);
          if (!kunde)
            return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });
          const stand = await berechneZeitraumStand(
            kunde,
            { von: startDate, bis, vergleichBis: compareEnd ?? null, heute },
            echteZeitraumQuellen(kunde),
          );
          return Response.json(stand);
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
