import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { evaluateReadiness, type ReadinessSnapshot } from "@/ezy/data/appRequirements";
import { startAdminJob, ladeAdminJob } from "@/server/admin-jobs.server";

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
// POST {action:"datenlauf", client}    → legt einen persistenten admin_jobs-
//                                        Eintrag an und antwortet SOFORT mit
//                                        jobId (Async-Umbau 21.08.); den Lauf
//                                        erledigt der minuetliche Worker.
// GET  ?job=<uuid>                     → Status/Fortschritt eines Admin-Jobs.

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

// Kundenuebersicht (21.08.): Readiness ueber ALLE Kunden der Organisation —
// Batch-Queries (eine je Tabelle) statt N x buildSnapshot; je Kunde der
// Gesamtstatus + die wichtigste fehlende Voraussetzung.
async function buildAlleReadiness(organizationId: string) {
  const [clients, caa, integ, oauth, viewer, runs] = await Promise.all([
    SB.from("clients")
      .select(
        "id, name, domain, gsc_property, ga4_property, canonry_project, google_ads_customer, metadata, status",
      )
      .eq("organization_id", organizationId),
    SB.from("client_app_access")
      .select("client_id, app, enabled, features")
      .eq("organization_id", organizationId),
    SB.from("client_integrations")
      .select("client_id, provider, enabled")
      .eq("organization_id", organizationId),
    SB.from("oauth_connections")
      .select("provider, client_id")
      .eq("organization_id", organizationId),
    SB.from("client_access")
      .select("client_id, user_id, app_users!inner(role)")
      .eq("organization_id", organizationId)
      .eq("app_users.role", "viewer"),
    SB.from("audit_runs")
      .select("client_id, audit_type, finished_at, created_at")
      .eq("organization_id", organizationId)
      .eq("status", "succeeded")
      .in("audit_type", RUN_TYPES)
      .order("created_at", { ascending: false })
      .limit(3000),
  ]);
  const je = <T>(rows: T[] | null | undefined, key: (r: any) => string) => {
    const m = new Map<string, any[]>();
    for (const r of rows ?? []) {
      const k = key(r) || "";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return m;
  };
  const caaJe = je(caa.data, (r) => r.client_id);
  const integJe = je(integ.data, (r) => r.client_id);
  const viewerJe = je(viewer.data, (r) => r.client_id);
  const runsJe = je(runs.data, (r) => r.client_id);
  const googleOrg = (oauth.data ?? []).some((o: any) => o.provider === "google");
  const wpJe = new Set(
    (oauth.data ?? []).filter((o: any) => o.provider === "wordpress").map((o: any) => o.client_id),
  );

  return (clients.data ?? []).map((client: any) => {
    const appEnabled: Record<string, boolean> = {};
    let localGridOn = false;
    for (const r of caaJe.get(client.id) ?? []) {
      appEnabled[r.app] = r.enabled !== false;
      if (r.app === "seo") {
        const f = Array.isArray(r.features) ? r.features : null;
        localGridOn = !f || f.includes("localgrid");
      }
    }
    const services: Record<string, boolean> = {};
    for (const r of integJe.get(client.id) ?? []) services[r.provider] = r.enabled === true;
    const lastRuns: Record<string, string | null> = {};
    for (const r of runsJe.get(client.id) ?? []) {
      if (!lastRuns[r.audit_type]) lastRuns[r.audit_type] = r.finished_at || r.created_at;
    }
    const meta = client.metadata || {};
    const standorte = meta.targetLocations || meta.target_locations || meta.locations || [];
    const snapshot: ReadinessSnapshot = {
      appEnabled: appEnabled as any,
      services,
      oauth: { google: googleOrg, wordpress: wpJe.has(client.id) },
      felder: {
        gsc_property: client.gsc_property,
        ga4_property: client.ga4_property,
        canonry_project: client.canonry_project,
        google_ads_customer: client.google_ads_customer,
      },
      lastRuns,
      portalUsers: new Set((viewerJe.get(client.id) ?? []).map((v: any) => v.user_id)).size,
      localGridOn,
      standortVorhanden: Array.isArray(standorte) && standorte.length > 0,
    };
    const readiness = evaluateReadiness(snapshot);
    const aktive = readiness.filter((r) => r.status !== "deaktiviert");
    const gesamt = !aktive.length
      ? "deaktiviert"
      : aktive.some((r) => r.status === "fehler")
        ? "fehler"
        : aktive.some((r) => r.status === "unvollstaendig")
          ? "unvollstaendig"
          : "bereit";
    // Wichtigste Luecke: erster offener kritischer Check einer aktiven App,
    // sonst erster offene empfohlene.
    let luecke: string | null = null;
    for (const sev of ["kritisch", "empfohlen"] as const) {
      for (const app of aktive) {
        const c = app.checks.find((ch) => !ch.ok && ch.severity === sev);
        if (c) {
          luecke = c.label;
          break;
        }
      }
      if (luecke) break;
    }
    return { id: client.id, name: client.name, domain: client.domain, status: gesamt, luecke };
  });
}

export const Route = createFileRoute("/api/admin/client-readiness")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = await requireOwnerAdmin(request);
        if (u instanceof Response) return u;
        // Kundenuebersicht (21.08.): Readiness ueber alle Kunden.
        if (new URL(request.url).searchParams.get("all") === "1") {
          const rows = await buildAlleReadiness(u.organizationId);
          return Response.json(
            { ok: true, kunden: rows },
            { headers: { "Cache-Control": "no-store" } },
          );
        }
        // Job-Polling (Async-Umbau 21.08.): Status eines Admin-Jobs.
        const jobId = new URL(request.url).searchParams.get("job") || "";
        if (jobId) {
          if (!UUID_RE.test(jobId))
            return Response.json({ ok: false, error: "job (uuid) erforderlich" }, { status: 400 });
          const job = await ladeAdminJob(u.organizationId, jobId);
          if (!job)
            return Response.json({ ok: false, error: "Job nicht gefunden" }, { status: 404 });
          return Response.json(
            {
              ok: true,
              job: {
                id: job.id,
                status: job.status,
                progress: job.progress,
                error: job.error,
                attempts: job.attempts,
                created_at: job.created_at,
                finished_at: job.finished_at,
              },
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        }
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
          // Async-Umbau 21.08.: KEIN blockierender Self-Call mehr — Job anlegen
          // und sofort antworten; Doppelstarts je Kunde+Lauftyp liefern den
          // bereits offenen Job zurueck.
          const { job, bereitsLaufend } = await startAdminJob({
            organizationId: u.organizationId,
            clientId,
            jobType: "datenlauf",
            userId: u.userId,
          });
          return Response.json({ ok: true, jobId: job.id, status: job.status, bereitsLaufend });
        }
        return Response.json({ ok: false, error: "Unbekannte action" }, { status: 400 });
      },
    },
  },
});
