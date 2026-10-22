import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { heuteYmdZuerich } from "@/lib/date-range";
import { berechneRankStand, rankLader } from "@/server/ezyrank-zeitraum.server";
import { cacheLesen, cacheSchreiben } from "@/server/uebersicht-cache.server";

// Agentur-Übersicht EzyRank (22.10.2026): Top 3 / Top 10 je Kunde aus derselben
// Funktion wie SEO-Dashboard und SEO-Report (berechneRankStand: letzte
// DataForSEO-Messung bis Zeitraum-Ende). Nur lesen; Ergebnis im Übersichts-
// Zwischenspeicher (neuer Rankings-Lauf verwirft ihn per Trigger).
// Zugriff: angemeldeter Benutzer, nur Kunden, die er laut RLS sehen darf.

const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Body = z.object({
  clientIds: z.array(z.string().uuid()).min(1).max(200),
  startDate: Ymd,
  endDate: Ymd,
});
const PARALLEL = 4;

type Kachel = { top3: number | null; top10: number | null; measured_on: string | null };

export const Route = createFileRoute("/api/admin/ezyrank-kacheln")({
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
        const heute = heuteYmdZuerich();
        const von = parsed.data.startDate;
        const bis = parsed.data.endDate > heute ? heute : parsed.data.endDate;
        if (von > bis)
          return Response.json({ ok: false, error: "Ungültiger Zeitraum" }, { status: 400 });

        // Nur sichtbare Kunden (RLS des Benutzers)
        const { data: sichtbar } = await nutzer
          .from("clients")
          .select("id")
          .in("id", parsed.data.clientIds);
        const ids = (sichtbar ?? []).map((c: any) => String(c.id));

        const kacheln: Record<string, Kachel> = {};
        let i = 0;
        const arbeiter = async () => {
          while (i < ids.length) {
            const id = ids[i++];
            const schluessel = `rank|${id}|${von}|${bis}`;
            const hit = await cacheLesen<Kachel>("seo", schluessel);
            if (hit) {
              kacheln[id] = hit;
              continue;
            }
            try {
              const r = await berechneRankStand({ von, bis, vergleichBis: null }, rankLader(id));
              const k: Kachel = {
                top3: r.distribution.current?.top3 ?? null,
                top10: r.distribution.current?.top10 ?? null,
                measured_on: r.measured_on,
              };
              kacheln[id] = k;
              if (!r.errors.length) await cacheSchreiben("seo", schluessel, id, k);
            } catch {
              kacheln[id] = { top3: null, top10: null, measured_on: null };
            }
          }
        };
        await Promise.all(Array.from({ length: PARALLEL }, arbeiter));
        return Response.json({ ok: true, period: { from: von, to: bis }, kacheln });
      },
    },
  },
});
