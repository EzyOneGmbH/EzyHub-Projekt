import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { evaluateReadiness, type ReadinessSnapshot } from "@/ezy/data/appRequirements";

// Admin «Einsatzbereitschaft» (17.08.2026): berechnet SERVERSEITIG je Kunde,
// ob eine App wirklich einsatzbereit ist — App-Zugriff, Services, Integration,
// letzter erfolgreicher Datenlauf, Portalzugang. Die Anforderungen leben
// zentral in appRequirements.ts (gleiche Logik wie Validierung + Tests).
//
// Auth: NUR owner/admin (serverseitig geprueft); organization_id + client_id
// werden in jeder Abfrage erzwungen. Es verlassen KEINE Tokens/Configs den
// Server — der Snapshot enthaelt ausschliesslich Booleans/Zeitstempel/IDs.
//
// GET  ?client=<uuid>                  → { snapshot, readiness }
// POST {action:"datenlauf", client}    → stoesst /api/admin/populate fuer den
//                                        einen Kunden an (Self-Call mit
//                                        ADMIN_AUTOMATION_SECRET, await bis
//                                        ~240 s — Gateway-Limit beachtet).

async function requireOwnerAdmin(
  request: Request,
): Promise<{ userId: string; organizationId: string } | Response> {
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
  if ((role !== "owner" && role !== "admin") || !m?.organization_id)
    return Response.json({ ok: false, error: "Nur Owner/Admin" }, { status: 403 });
  return { userId: data.user.id, organizationId: m.organization_id as string };
}

const UUID_RE = /^[0-9a-f-]{36}$/i;
const SB = supabaseAdmin as any;

// audit_types, deren letzter succeeded-Lauf fuer die Bewertung relevant ist
// (Obermenge der in appRequirements verwendeten Typen).
const RUN_TYPES = [
  "populate_meta",
  "rankings",
  "gsc_summary",
  "canonry_ai_visibility",
  "llm_responses",
  "ai_citations",
  "google_ads",
];

async function buildSnapshot(
  organizationId: string,
  clientId: string,
): Promise<{ snapshot: ReadinessSnapshot; client: any } | null> {
  const { data: client } = await SB.from("clients")
    .select(
      "id, name, domain, gsc_property, ga4_property, canonry_project, google_ads_customer, metadata",
    )
    .eq("id", clientId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!client) return null;

  const [caa, integ, oauth, viewer, runs] = await Promise.all([
    SB.from("client_app_access")
      .select("app, enabled, features")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId),
    SB.from("client_integrations")
      .select("provider, enabled")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId),
    SB.from("oauth_connections")
      .select("provider, client_id")
      .eq("organization_id", organizationId)
      .or(`client_id.eq.${clientId},client_id.is.null`),
    SB.from("client_access")
      .select("user_id, app_users!inner(role)")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .eq("app_users.role", "viewer"),
    SB.from("audit_runs")
      .select("audit_type, finished_at, created_at")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .eq("status", "succeeded")
      .in("audit_type", RUN_TYPES)
      .order("created_at", { ascending: false })
      .limit(300),
  ]);

  const appEnabled: Record<string, boolean> = {};
  let localGridOn = false;
  for (const r of caa.data ?? []) {
    appEnabled[r.app] = r.enabled !== false;
    if (r.app === "seo") {
      const f = Array.isArray(r.features) ? r.features : null;
      localGridOn = !f || f.includes("localgrid"); // keine Liste = alle Features
    }
  }
  const services: Record<string, boolean> = {};
  for (const r of integ.data ?? []) services[r.provider] = r.enabled === true;

  const lastRuns: Record<string, string | null> = {};
  for (const r of runs.data ?? []) {
    if (!lastRuns[r.audit_type]) lastRuns[r.audit_type] = r.finished_at || r.created_at;
  }

  const meta = client.metadata || {};
  const standorte = meta.targetLocations || meta.target_locations || meta.locations || [];

  const snapshot: ReadinessSnapshot = {
    appEnabled: appEnabled as any,
    services,
    oauth: {
      google: (oauth.data ?? []).some((o: any) => o.provider === "google"),
      wordpress: (oauth.data ?? []).some(
        (o: any) => o.provider === "wordpress" && o.client_id === clientId,
      ),
    },
    felder: {
      gsc_property: client.gsc_property,
      ga4_property: client.ga4_property,
      canonry_project: client.canonry_project,
      google_ads_customer: client.google_ads_customer,
    },
    lastRuns,
    portalUsers: new Set((viewer.data ?? []).map((v: any) => v.user_id)).size,
    localGridOn,
    standortVorhanden: Array.isArray(standorte) && standorte.length > 0,
  };
  return { snapshot, client };
}

export const Route = createFileRoute("/api/admin/client-readiness")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = await requireOwnerAdmin(request);
        if (u instanceof Response) return u;
        const clientId = new URL(request.url).searchParams.get("client") || "";
        if (!UUID_RE.test(clientId))
          return Response.json({ ok: false, error: "client (uuid) erforderlich" }, { status: 400 });
        const res = await buildSnapshot(u.organizationId, clientId);
        if (!res)
          return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });
        return Response.json({
          ok: true,
          snapshot: res.snapshot,
          readiness: evaluateReadiness(res.snapshot),
        });
      },

      POST: async ({ request }) => {
        const u = await requireOwnerAdmin(request);
        if (u instanceof Response) return u;
        const body: any = await request.json().catch(() => ({}));
        const clientId = String(body?.client || "");
        if (!UUID_RE.test(clientId))
          return Response.json({ ok: false, error: "client (uuid) erforderlich" }, { status: 400 });
        // Org-Scope erzwingen, bevor irgendetwas laeuft.
        const { data: own } = await SB.from("clients")
          .select("id")
          .eq("id", clientId)
          .eq("organization_id", u.organizationId)
          .maybeSingle();
        if (!own)
          return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });

        if (body.action === "datenlauf") {
          const secret = process.env.ADMIN_AUTOMATION_SECRET;
          if (!secret)
            return Response.json(
              { ok: false, error: "Automation nicht konfiguriert" },
              { status: 503 },
            );
          // Self-Call auf die bestehende populate-Route (ein Kunde) — dieselbe
          // Logik wie der 12h-Lauf, kein zweiter Code-Pfad.
          const base = new URL(request.url).origin;
          try {
            const r = await fetch(`${base}/api/admin/populate`, {
              method: "POST",
              headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
              body: JSON.stringify({ client: clientId }),
              signal: AbortSignal.timeout(240_000),
            });
            const j = await r.json().catch(() => ({}));
            return Response.json({ ok: r.ok, lauf: j?.summary ?? j ?? null });
          } catch (e) {
            return Response.json(
              { ok: false, error: `Datenlauf: ${e instanceof Error ? e.message : String(e)}` },
              { status: 502 },
            );
          }
        }
        return Response.json({ ok: false, error: "Unbekannte action" }, { status: 400 });
      },
    },
  },
});
