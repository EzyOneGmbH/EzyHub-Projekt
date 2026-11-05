import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { cacheLesen, cacheSchreiben } from "@/server/uebersicht-cache.server";
import { bisTag, rankVerlauf, tagZuerich, waehleLaeufe, type LaufKopf } from "@/lib/rankVerlauf";

// Verlauf Top 3 / Top 10 je Messtag (05.11.2026). Seit 2.7.4 auch für Kunden
// (Volkan): Zugriff wie /api/admin/ezyrank-kacheln — angemeldeter Benutzer,
// nur Kunden, die er laut RLS sehen darf. Nur lesen:
// audit_runs rankings (keywords) + gsc_queries (topNonbrandQueries), gleiche
// Zählung wie die Kacheln im EzyRank-Dashboard. Ergebnis 70 min im Cache.

const TAGE = 400;
const BLOCK = 20;
const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

async function koepfe(clientId: string, typ: string, ab: string): Promise<LaufKopf[]> {
  const out: LaufKopf[] = [];
  for (let von = 0; von < 5000; von += 1000) {
    const { data, error } = await (supabaseAdmin as any)
      .from("audit_runs")
      .select("id, created_at")
      .eq("client_id", clientId)
      .eq("audit_type", typ)
      .eq("status", "succeeded")
      .gte("created_at", ab)
      .order("created_at")
      .range(von, von + 999);
    if (error) throw new Error(`audit_runs: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function felder(ids: string[], pfad: string, alias: string) {
  const m = new Map<string, any>();
  for (let i = 0; i < ids.length; i += BLOCK) {
    const { data, error } = await (supabaseAdmin as any)
      .from("audit_runs")
      .select(`id, ${alias}:${pfad}`)
      .in("id", ids.slice(i, i + BLOCK));
    if (error) throw new Error(`audit_runs: ${error.message}`);
    for (const r of data ?? []) m.set(String(r.id), Array.isArray(r[alias]) ? r[alias] : null);
  }
  return m;
}

export const Route = createFileRoute("/api/admin/rank-verlauf")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const clientId = new URL(request.url).searchParams.get("clientId") || "";
        if (!isUuid(clientId))
          return Response.json({ ok: false, error: "clientId fehlt" }, { status: 400 });
        // Angemeldet + Kunde für den Benutzer sichtbar (RLS)
        const sb = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!,
          { global: { headers: { Authorization: request.headers.get("authorization") ?? "" } } },
        );
        const {
          data: { user },
        } = await sb.auth.getUser();
        if (!user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        const { data: sichtbar } = await sb.from("clients").select("id").eq("id", clientId);
        if (!sichtbar?.length)
          return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });

        // Immer bis gestern (Zürcher Zeit); Schlüssel wechselt um Mitternacht.
        const gestern = tagZuerich(new Date(Date.now() - 864e5).toISOString());
        const schluessel = `rankverlauf|${clientId}|${gestern}`;
        const hit = await cacheLesen<any>("seo", schluessel);
        if (hit) return Response.json({ ok: true, ...hit, cache: true });
        try {
          const ab = new Date(Date.now() - TAGE * 864e5).toISOString();
          const [rk, gk] = await Promise.all([
            koepfe(clientId, "rankings", ab),
            koepfe(clientId, "gsc_queries", ab),
          ]);
          const auswahl = waehleLaeufe(rk, gk);
          const gscIds = [...new Set(auswahl.map((a) => a.gscId).filter(Boolean))] as string[];
          const [kw, gq] = await Promise.all([
            felder(
              auswahl.map((a) => a.rankingId),
              "result->keywords",
              "keywords",
            ),
            felder(gscIds, "result->topNonbrandQueries", "queries"),
          ]);
          const punkte = bisTag(rankVerlauf(auswahl, kw, gq), gestern);
          const payload = { punkte, bis: gestern };
          await cacheSchreiben("seo", schluessel, clientId, payload);
          return Response.json({ ok: true, ...payload });
        } catch (e) {
          return Response.json({ ok: false, error: String((e as Error)?.message || e) });
        }
      },
    },
  },
});
