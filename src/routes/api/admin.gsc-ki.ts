import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "@/server/google-tokens.server";
import { requireTeamRole } from "@/server/team-guard.server";
import { gscRows, GSC_END_LAG_DAYS } from "@/server/gsc.server";
import { zeitraum, zeitraumAusParams } from "@/lib/date-range";

// Search Console «Generative KI» in EzyAI → Insights (Volkan 26.10.2026).
// Die Search-Console-API hat (Stand 26.10.) KEINEN Typ fuer den KI-Bericht
// (aiOverview/aiMode/generativeAi/ai/GENERATIVE_AI/… → 400 «Invalid value at
// 'type'»). Deshalb zwei Wege:
//  1) CSV-Import: Export aus der Search Console (ZIP/CSV) wird im Browser
//     gelesen (src/lib/gsc-ki-import.ts) und hier gespeichert (gsc_ki_imports).
//  2) Automatik: GET prueft (12 h gecacht) Kandidaten-Typen gegen die API.
//     Kennt Google einen davon, kommen die Daten live aus der API — ohne Import.
//
// GET  ?client=<uuid>[&start&end|&days]  → { ok, quelle:"api"|"import"|null, … }
// POST { client, import:{…}, dateiname }  (Team, ab member) → { ok, id }
// Auth GET: eingeloggter User (RLS) ODER Bearer ADMIN_AUTOMATION_SECRET.

const KANDIDATEN = ["generativeAi", "aiOverview", "aiOverviews", "aiMode", "generative_ai", "ai"];
let apiCheck: { at: number; typ: string | null } | null = null;
const CHECK_MS = 12 * 3_600_000;

async function requireAccess(request: Request): Promise<{ userClient: any | null } | Response> {
  const admin = process.env.ADMIN_AUTOMATION_SECRET;
  const auth = request.headers.get("authorization") || "";
  if (admin && auth === `Bearer ${admin}`) return { userClient: null };
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anon)
    return Response.json({ ok: false, error: "Server not configured" }, { status: 503 });
  const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data } = await userClient.auth.getUser();
  if (!data.user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return { userClient };
}

/** Kennt die API inzwischen einen KI-Typ? (12 h gecacht, je Isolate) */
async function kiTypDerApi(site: string, token: string, start: string, end: string) {
  if (apiCheck && Date.now() - apiCheck.at < CHECK_MS) return apiCheck.typ;
  let gefunden: string | null = null;
  for (const typ of KANDIDATEN) {
    const r = await fetch(
      `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: start, endDate: end, type: typ, rowLimit: 1 }),
        signal: AbortSignal.timeout(10_000),
      },
    ).catch(() => null);
    if (r?.ok) {
      gefunden = typ;
      break;
    }
  }
  apiCheck = { at: Date.now(), typ: gefunden };
  return gefunden;
}

const Zeile = z.object({
  key: z.string().min(1).max(2048),
  imp: z.number().int().min(0),
  impPrev: z.number().int().min(0).nullable(),
});
const Datum = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();
const PostBody = z.object({
  client: z.string().uuid(),
  dateiname: z.string().max(300).optional(),
  import: z.object({
    tabellen: z.object({
      page: z.array(Zeile).max(5000).optional(),
      country: z.array(Zeile).max(500).optional(),
      device: z.array(Zeile).max(20).optional(),
      date: z.array(Zeile).max(1000).optional(),
    }),
    startDate: Datum,
    endDate: Datum,
    compareStart: Datum,
    compareEnd: Datum,
    totalImp: z.number().int().min(0),
    totalImpPrev: z.number().int().min(0).nullable(),
  }),
});

export const Route = createFileRoute("/api/admin/gsc-ki")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const acc = await requireAccess(request);
        if (acc instanceof Response) return acc;
        const u = new URL(request.url);
        const clientId = u.searchParams.get("client") || "";
        if (!/^[0-9a-f-]{36}$/i.test(clientId))
          return Response.json({ ok: false, error: "client (uuid) erforderlich" }, { status: 400 });
        const sb = acc.userClient ?? (supabaseAdmin as any);
        const { data: client } = await sb
          .from("clients")
          .select("id, gsc_property")
          .eq("id", clientId)
          .maybeSingle();
        if (!client)
          return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });

        // 1) Automatik: API, sobald Google den KI-Typ anbietet
        let zr;
        try {
          const zr0 = zeitraumAusParams(u.searchParams, { defaultDays: 28, maxDays: 490 });
          zr =
            zr0.quelle === "custom"
              ? zr0
              : zeitraum({ days: zr0.days, endLagDays: GSC_END_LAG_DAYS, maxDays: 490 });
        } catch {
          zr = zeitraum({ days: 28, endLagDays: GSC_END_LAG_DAYS, maxDays: 490 });
        }
        let apiFehler: string | null = null;
        if (client.gsc_property) {
          try {
            const token = (await getGoogleAccessToken(clientId)).accessToken;
            const site = String(client.gsc_property);
            const typ = await kiTypDerApi(site, token, zr.startDate, zr.endDate);
            if (typ) {
              const basis = {
                site,
                accessToken: token,
                startDate: zr.startDate,
                endDate: zr.endDate,
                filter: { type: typ } as any,
                timeoutMs: 30_000,
              };
              const tab = async (dim: string, limit: number) =>
                (await gscRows({ ...basis, dimensions: [dim], rowLimit: limit })).rows.map(
                  (r: any) => ({
                    key: String(r.keys?.[0] ?? ""),
                    imp: Number(r.impressions || 0),
                    impPrev: null,
                  }),
                );
              const [page, country, device, date] = await Promise.all([
                tab("page", 1000),
                tab("country", 250),
                tab("device", 10),
                tab("date", 500),
              ]);
              date.sort((a, b) => a.key.localeCompare(b.key));
              return Response.json(
                {
                  ok: true,
                  quelle: "api",
                  apiTyp: typ,
                  import: {
                    tabellen: { page, country, device, date },
                    startDate: zr.startDate,
                    endDate: zr.endDate,
                    compareStart: null,
                    compareEnd: null,
                    totalImp: date.reduce((s, z0) => s + z0.imp, 0),
                    totalImpPrev: null,
                  },
                  property: site,
                },
                { headers: { "Cache-Control": "no-store" } },
              );
            }
          } catch (e) {
            apiFehler = e instanceof Error ? e.message.slice(0, 200) : String(e);
          }
        }

        // 2) Neuester CSV-Import
        const { data: imp, error } = await (supabaseAdmin as any)
          .from("gsc_ki_imports")
          .select(
            "id, start_date, end_date, compare_start, compare_end, tabellen, total_imp, total_imp_prev, dateiname, created_at",
          )
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error)
          return Response.json({
            ok: true,
            quelle: null,
            property: client.gsc_property || null,
            tabelleFehlt: /gsc_ki_imports|schema cache|42P01/i.test(
              `${error.message} ${error.code}`,
            ),
            error: error.message,
          });
        return Response.json(
          {
            ok: true,
            quelle: imp ? "import" : null,
            property: client.gsc_property || null,
            apiFehler,
            import: imp
              ? {
                  id: imp.id,
                  tabellen: imp.tabellen || {},
                  startDate: imp.start_date,
                  endDate: imp.end_date,
                  compareStart: imp.compare_start,
                  compareEnd: imp.compare_end,
                  totalImp: Number(imp.total_imp || 0),
                  totalImpPrev: imp.total_imp_prev == null ? null : Number(imp.total_imp_prev),
                  dateiname: imp.dateiname,
                  importiertAm: imp.created_at,
                }
              : null,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },

      POST: async ({ request }) => {
        const ctx = await requireTeamRole(request, "member");
        if (ctx instanceof Response) return ctx;
        const parsed = PostBody.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return Response.json(
            { ok: false, error: `Ungültiger Import: ${parsed.error.issues[0]?.message || ""}` },
            { status: 400 },
          );
        const { client: clientId, import: imp, dateiname } = parsed.data;
        const sb = supabaseAdmin as any;
        const { data: own } = await sb
          .from("clients")
          .select("id")
          .eq("id", clientId)
          .eq("organization_id", ctx.organizationId)
          .maybeSingle();
        if (!own)
          return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });
        const leer = !Object.values(imp.tabellen).some((t) => t && t.length);
        if (leer)
          return Response.json(
            { ok: false, error: "Keine Tabelle mit Impressionen erkannt" },
            { status: 400 },
          );
        const { data, error } = await sb
          .from("gsc_ki_imports")
          .insert({
            organization_id: ctx.organizationId,
            client_id: clientId,
            start_date: imp.startDate,
            end_date: imp.endDate,
            compare_start: imp.compareStart,
            compare_end: imp.compareEnd,
            tabellen: imp.tabellen,
            total_imp: imp.totalImp,
            total_imp_prev: imp.totalImpPrev,
            dateiname: dateiname || null,
            uploaded_by: ctx.userId,
          })
          .select("id")
          .maybeSingle();
        if (error)
          return Response.json(
            {
              ok: false,
              error: /gsc_ki_imports|schema cache|42P01/i.test(`${error.message} ${error.code}`)
                ? "Tabelle gsc_ki_imports fehlt — Migration 20261026120000 im Supabase-SQL-Editor ausführen"
                : error.message,
            },
            { status: 500 },
          );
        return Response.json({ ok: true, id: data?.id });
      },
    },
  },
});
