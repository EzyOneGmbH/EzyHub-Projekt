import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { redactSecrets } from "@/server/google-oauth.server";
import { requireTeamRole } from "@/server/team-guard.server";

// Local SEO auf Abruf (15.10.2026, Volkan Punkt 11) — NUR Team. Leitet an den
// agent-service (/local-seo): eigenes Google-Business-Profil per Domain, Maps-
// Raster um den Standort, Bewertungen eigenes Profil + lokale Konkurrenz.
// Ergebnis als audit_runs «local_seo» (GET = letzter Lauf).
// Kosten-Bremse: 3×3 bis 3 Keywords, 5×5 nur 1 Keyword.

const Post = z
  .object({
    clientId: z.string().uuid(),
    keywords: z.array(z.string().trim().min(2).max(120)).min(1).max(3),
    grid: z.union([z.literal(3), z.literal(5)]).default(3),
    stepKm: z.number().min(0.5).max(5).default(1),
  })
  .refine((d) => d.grid === 3 || d.keywords.length === 1, {
    message: "5×5-Raster nur mit 1 Keyword",
  });

const normDomain = (s: string) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/^sc-domain:/, "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");

async function pruefen(request: Request, clientId: string) {
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
  const team = await requireTeamRole(request, "member");
  if (team instanceof Response) return { fehler: team };
  const { data: sichtbar } = await sb.from("clients").select("id").eq("id", clientId);
  if (!sichtbar?.length)
    return { fehler: Response.json({ ok: false, error: "Forbidden" }, { status: 403 }) };
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, name, domain, gsc_property, organization_id")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return { fehler: Response.json({ ok: false, error: "Kunde nicht gefunden" }) };
  return { user, client };
}

export const Route = createFileRoute("/api/admin/local-seo")({
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
            .select("result, created_at")
            .eq("client_id", clientId)
            .eq("audit_type", "local_seo")
            .eq("status", "succeeded")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          return Response.json({
            ok: true,
            lauf: data ? { ...(data as any).result, at: (data as any).created_at } : null,
          });
        } catch (e) {
          return Response.json({ ok: false, error: redactSecrets(e) });
        }
      },
      POST: async ({ request }) => {
        try {
          const parsed = Post.safeParse(await request.json().catch(() => ({})));
          if (!parsed.success)
            return Response.json(
              { ok: false, error: parsed.error.issues[0]?.message || "Invalid input" },
              { status: 400 },
            );
          const p = await pruefen(request, parsed.data.clientId);
          if ("fehler" in p) return p.fehler;
          const domain =
            normDomain(p.client.gsc_property || "") || normDomain(p.client.domain || "");
          if (!domain)
            return Response.json({ ok: false, error: "Keine Domain beim Kunden hinterlegt" });
          const base = process.env.AGENT_BASE_URL?.replace(/\/+$/, "");
          const secret = process.env.AGENT_SHARED_SECRET;
          if (!base || !secret)
            return Response.json({ ok: false, error: "agent-service nicht konfiguriert" });
          const r = await fetch(`${base}/local-seo`, {
            method: "POST",
            headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              clientName: p.client.name,
              domain,
              keywords: parsed.data.keywords,
              grid: parsed.data.grid,
              stepKm: parsed.data.stepKm,
            }),
            signal: AbortSignal.timeout(280_000),
          });
          const j: any = await r.json().catch(() => ({}));
          if (!r.ok || !j?.ok)
            return Response.json({
              ok: false,
              error: j?.error || `agent-service HTTP ${r.status}`,
            });
          const result = {
            gbp: j.gbp,
            raster: j.raster,
            bewertungen: j.bewertungen,
            parameter: {
              keywords: parsed.data.keywords,
              grid: parsed.data.grid,
              stepKm: parsed.data.stepKm,
            },
          };
          const jetzt = new Date().toISOString();
          await supabaseAdmin.from("audit_runs").insert({
            client_id: p.client.id,
            organization_id: p.client.organization_id,
            triggered_by: p.user.id,
            audit_type: "local_seo",
            status: "succeeded",
            input: result.parameter,
            result: result as never,
            started_at: jetzt,
            finished_at: jetzt,
          });
          return Response.json({ ok: true, lauf: { ...result, at: jetzt } });
        } catch (e) {
          return Response.json({ ok: false, error: redactSecrets(e) });
        }
      },
    },
  },
});
