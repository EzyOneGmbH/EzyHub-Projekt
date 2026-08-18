import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  startAudit,
  tickAudit,
  suggestCompetitors,
  retryAudit,
  abbrechenAudit,
  tickeOffeneAudits,
  leadZuKunde,
  uebernahmeErlaubt,
} from "@/server/prospect-audit.server";

// EzyAI – Analyse (14.08.2026): API der Prospect-Audit-App.
// Auth: eingeloggtes Team (owner/admin/member) — Viewer (Kundenportal) sehen
// Leads bewusst NICHT. Schreibzugriffe laufen ueber den Service-Client;
// prospect_audits hat RLS ohne Policies (deny all fuer Direktzugriff).
//
// GET  ?list=1         → Verlauf der Organisation (kompakte Zeilen)
// GET  ?id=<uuid>      → kompletter Lauf (Status/Ergebnis, fuers Polling)
// POST {action:"competitors", domain, firmenname, branche?, ort?}
// POST {action:"start", domain, firmenname, branche?, ort?, wettbewerber[]}
// POST {action:"tick", id}   → EINE Etappe ausfuehren (Frontend treibt den Lauf)

async function requireTeam(
  request: Request,
): Promise<{ userId: string | null; organizationId: string; role: string } | Response> {
  // Server-zu-Server (agent-service/Tests): Bearer ADMIN_AUTOMATION_SECRET +
  // ?org=<uuid> — gleiches Muster wie /api/admin/site-health.
  const admin = process.env.ADMIN_AUTOMATION_SECRET;
  const auth0 = request.headers.get("authorization") || "";
  if (admin && auth0 === `Bearer ${admin}`) {
    const org = new URL(request.url).searchParams.get("org") || "";
    if (!/^[0-9a-f-]{36}$/i.test(org))
      return Response.json({ ok: false, error: "org (uuid) erforderlich" }, { status: 400 });
    return { userId: null, organizationId: org, role: "owner" };
  }
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anon)
    return Response.json({ ok: false, error: "Server not configured" }, { status: 503 });
  const sb = createClient(url, anon, {
    global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
  });
  const { data } = await sb.auth.getUser();
  if (!data.user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { data: m } = await (supabaseAdmin as any)
    .from("app_users")
    .select("role, organization_id")
    .eq("user_id", data.user.id)
    .order("role", { ascending: true })
    .limit(1)
    .maybeSingle();
  const role = (m?.role as string) || "viewer";
  if (role === "viewer" || !m?.organization_id)
    return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
  return { userId: data.user.id, organizationId: m.organization_id as string, role };
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

export const Route = createFileRoute("/api/agent/analyse")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = await requireTeam(request);
        if (u instanceof Response) return u;
        const sp = new URL(request.url).searchParams;
        const id = sp.get("id");
        if (id && UUID_RE.test(id)) {
          const { data } = await (supabaseAdmin as any)
            .from("prospect_audits")
            .select("*")
            .eq("id", id)
            .eq("organization_id", u.organizationId)
            .maybeSingle();
          if (!data) return Response.json({ ok: false, error: "Nicht gefunden" }, { status: 404 });
          return Response.json({ ok: true, audit: data });
        }
        const { data } = await (supabaseAdmin as any)
          .from("prospect_audits")
          .select("id, domain, firmenname, status, stage, progress, score, dims, created_at, data")
          .eq("organization_id", u.organizationId)
          .order("created_at", { ascending: false })
          .limit(60);
        const rows = (data ?? []).map((r: any) => ({
          id: r.id,
          domain: r.domain,
          firmenname: r.firmenname,
          status: r.status,
          stage: r.stage,
          progress: r.progress,
          score: r.score,
          dims: r.dims,
          created_at: r.created_at,
          missedVol: r.data?.missedVol ?? null,
        }));
        return Response.json({ ok: true, audits: rows });
      },

      POST: async ({ request }) => {
        const body: any = await request.json().catch(() => ({}));
        const action = String(body?.action || "");

        // Worker-Tick (18.08.): org-uebergreifend, NUR Server-zu-Server mit
        // ADMIN_AUTOMATION_SECRET (agent-service alle 60 s). Kein User-Kontext.
        if (action === "worker") {
          const admin = process.env.ADMIN_AUTOMATION_SECRET;
          if (!admin || (request.headers.get("authorization") || "") !== `Bearer ${admin}`)
            return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
          try {
            const r = await tickeOffeneAudits(
              Number(body.budgetMs) > 0 ? Number(body.budgetMs) : undefined,
            );
            return Response.json({ ok: true, ...r });
          } catch (e) {
            return Response.json(
              { ok: false, error: e instanceof Error ? e.message : String(e) },
              { status: 500 },
            );
          }
        }

        const u = await requireTeam(request);
        if (u instanceof Response) return u;
        try {
          if (action === "competitors") {
            const r = await suggestCompetitors({
              domain: String(body.domain || ""),
              firmenname: String(body.firmenname || ""),
              branche: String(body.branche || ""),
              ort: String(body.ort || ""),
            });
            return Response.json(r);
          }
          if (action === "start") {
            if (!String(body.domain || "").includes(".") || !String(body.firmenname || "").trim())
              return Response.json(
                { ok: false, error: "Domain und Firmenname erforderlich" },
                { status: 400 },
              );
            const { audit, bereitsLaufend } = await startAudit({
              organizationId: u.organizationId,
              userId: u.userId,
              domain: String(body.domain),
              firmenname: String(body.firmenname),
              branche: String(body.branche || ""),
              ort: String(body.ort || ""),
              wettbewerber: Array.isArray(body.wettbewerber) ? body.wettbewerber.map(String) : [],
            });
            return Response.json({ ok: true, audit, bereitsLaufend });
          }
          if (action === "retry" || action === "abbrechen" || action === "uebernehmen") {
            const id = String(body.id || "");
            if (!UUID_RE.test(id))
              return Response.json({ ok: false, error: "id erforderlich" }, { status: 400 });
            const { data: own } = await (supabaseAdmin as any)
              .from("prospect_audits")
              .select("id")
              .eq("id", id)
              .eq("organization_id", u.organizationId)
              .maybeSingle();
            if (!own) return Response.json({ ok: false, error: "Nicht gefunden" }, { status: 404 });
            if (action === "retry") return Response.json({ ok: true, audit: await retryAudit(id) });
            if (action === "abbrechen")
              return Response.json({ ok: true, audit: await abbrechenAudit(id) });
            // Lead → Kunde: NUR Owner/Admin (serverseitig), idempotent.
            if (!uebernahmeErlaubt(u.role))
              return Response.json(
                { ok: false, error: "Nur Owner/Admin dürfen Leads übernehmen" },
                { status: 403 },
              );
            const r = await leadZuKunde(id, u.organizationId, u.userId);
            return Response.json({ ok: true, ...r });
          }
          if (action === "tick") {
            const id = String(body.id || "");
            if (!UUID_RE.test(id))
              return Response.json({ ok: false, error: "id erforderlich" }, { status: 400 });
            // Org-Scope pruefen, bevor der Tick arbeitet.
            const { data: own } = await (supabaseAdmin as any)
              .from("prospect_audits")
              .select("id")
              .eq("id", id)
              .eq("organization_id", u.organizationId)
              .maybeSingle();
            if (!own) return Response.json({ ok: false, error: "Nicht gefunden" }, { status: 404 });
            const row = await tickAudit(id);
            return Response.json({ ok: true, audit: row });
          }
          return Response.json({ ok: false, error: "Unbekannte action" }, { status: 400 });
        } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 500 },
          );
        }
      },
    },
  },
});
