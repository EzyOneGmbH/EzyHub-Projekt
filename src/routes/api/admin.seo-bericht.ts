import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { redactSecrets } from "@/server/google-oauth.server";
import { requireTeamRole } from "@/server/team-guard.server";
import { makeBerichtToken, reportTokenHash } from "@/server/report-token.server";
import { BERICHT_VORLAGEN, buildSeoBericht, type BerichtVorlage } from "@/lib/seoBericht";

// SEO-Berichte aus Vorlagen + teilbare Links (15.10.2026, Volkan Punkt 10) — NUR
// Team. Berichte liegen als audit_runs «seo_bericht» (NICHT content_items: die
// Berichtsseite des Kundenportals bleibt unveraendert). Freigabe-Link = Token v3
// (Bericht-ID signiert), registriert in public_report_links (Ablauf, Widerruf).
// GET ?clientId → Liste | POST {action:"create",clientId,vorlage} | POST {action:"share",clientId,berichtId,days}

const Create = z.object({
  action: z.literal("create"),
  clientId: z.string().uuid(),
  vorlage: z.enum(Object.keys(BERICHT_VORLAGEN) as [BerichtVorlage, ...BerichtVorlage[]]),
});
const Share = z.object({
  action: z.literal("share"),
  clientId: z.string().uuid(),
  berichtId: z.string().uuid(),
  days: z.number().int().min(1).max(90).default(30),
});

async function pruefen(request: Request, clientId: string, rolle: "member" | "admin" = "member") {
  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: request.headers.get("authorization") ?? "" } } },
  );
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user)
    return { fehler: Response.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  const team = await requireTeamRole(request, rolle);
  if (team instanceof Response) return { fehler: team };
  const { data: sichtbar } = await sb.from("clients").select("id").eq("id", clientId);
  if (!sichtbar?.length)
    return { fehler: Response.json({ ok: false, error: "Forbidden" }, { status: 403 }) };
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, name, organization_id")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return { fehler: Response.json({ ok: false, error: "Kunde nicht gefunden" }) };
  return { user, client };
}

async function letzter(clientId: string, typ: string) {
  const { data } = await supabaseAdmin
    .from("audit_runs")
    .select("result, created_at")
    .eq("client_id", clientId)
    .eq("audit_type", typ)
    .eq("status", "succeeded")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { result: any } | null)?.result ?? null;
}

export const Route = createFileRoute("/api/admin/seo-bericht")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const clientId = new URL(request.url).searchParams.get("clientId") || "";
          if (!z.string().uuid().safeParse(clientId).success)
            return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });
          const p = await pruefen(request, clientId);
          if ("fehler" in p) return p.fehler;
          const { data } = await supabaseAdmin
            .from("audit_runs")
            .select("id, created_at, result")
            .eq("client_id", clientId)
            .eq("audit_type", "seo_bericht")
            .eq("status", "succeeded")
            .order("created_at", { ascending: false })
            .limit(10);
          return Response.json({
            ok: true,
            vorlagen: BERICHT_VORLAGEN,
            berichte: (data || []).map((r: any) => ({
              id: r.id,
              at: r.created_at,
              titel: r.result?.title || "Bericht",
              vorlage: r.result?.vorlage || null,
              markdown: r.result?.markdown || "",
            })),
          });
        } catch (e) {
          return Response.json({ ok: false, error: redactSecrets(e) });
        }
      },
      POST: async ({ request }) => {
        try {
          const body = await request.json().catch(() => ({}));
          if (body?.action === "share") {
            const s = Share.safeParse(body);
            if (!s.success)
              return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });
            const p = await pruefen(request, s.data.clientId, "admin");
            if ("fehler" in p) return p.fehler;
            const secret = process.env.ADMIN_AUTOMATION_SECRET;
            if (!secret)
              return Response.json({ ok: false, error: "Server not configured" }, { status: 503 });
            const { data: bericht } = await supabaseAdmin
              .from("audit_runs")
              .select("id")
              .eq("id", s.data.berichtId)
              .eq("client_id", s.data.clientId)
              .eq("audit_type", "seo_bericht")
              .maybeSingle();
            if (!bericht)
              return Response.json({ ok: false, error: "Bericht nicht gefunden" }, { status: 404 });
            const token = makeBerichtToken(
              s.data.berichtId,
              s.data.clientId,
              p.client.organization_id,
              s.data.days,
              secret,
            );
            const { error } = await (supabaseAdmin as any).from("public_report_links").insert({
              organization_id: p.client.organization_id,
              client_id: s.data.clientId,
              token_hash: reportTokenHash(token),
              created_by: p.user.id,
              expires_at: new Date(Date.now() + s.data.days * 864e5).toISOString(),
            });
            if (error)
              return Response.json({ ok: false, error: "Link konnte nicht registriert werden" });
            return Response.json({ ok: true, url: `/r/${token}`, days: s.data.days });
          }
          const c = Create.safeParse(body);
          if (!c.success)
            return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });
          const p = await pruefen(request, c.data.clientId);
          if ("fehler" in p) return p.fehler;
          const id = c.data.clientId;
          const [rank, gscQ, gscSum, traf, ahrefs, conv, clusters] = await Promise.all([
            letzter(id, "rankings"),
            letzter(id, "gsc_queries"),
            letzter(id, "gsc_summary"),
            letzter(id, "ga4_traffic"),
            letzter(id, "ahrefs"),
            letzter(id, "ga4_conversions"),
            letzter(id, "keyword_clusters"),
          ]);
          const datum = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" });
          const { title, markdown } = buildSeoBericht(c.data.vorlage, {
            kunde: p.client.name,
            datum,
            rank,
            gscQ,
            gscSum,
            traf,
            ahrefs,
            conv,
            clusters,
          });
          const jetzt = new Date().toISOString();
          const { data: neu } = await supabaseAdmin
            .from("audit_runs")
            .insert({
              client_id: id,
              organization_id: p.client.organization_id,
              triggered_by: p.user.id,
              audit_type: "seo_bericht",
              status: "succeeded",
              input: { vorlage: c.data.vorlage },
              result: { title, vorlage: c.data.vorlage, markdown } as never,
              started_at: jetzt,
              finished_at: jetzt,
            })
            .select("id")
            .maybeSingle();
          return Response.json({
            ok: true,
            bericht: { id: neu?.id, at: jetzt, titel: title, vorlage: c.data.vorlage, markdown },
          });
        } catch (e) {
          return Response.json({ ok: false, error: redactSecrets(e) });
        }
      },
    },
  },
});
