import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireTeamRole } from "@/server/team-guard.server";
import { secretStatus } from "@/server/secretbox.server";

// Systemcheck (Admin-Ausbau 21.08.2026): prueft SERVERSEITIG, ob die von der
// App erwarteten Tabellen/Spalten wirklich existieren (Lovable wendet Repo-
// Migrationen NICHT automatisch an — fehlende Migrationen erschienen bisher
// als "leere Daten"), ob RLS sensible Tabellen wirklich zuhaelt, ob der
// Analyse-Worker lebt und wie es um die WP-Secret-Migration steht.
// Status je Check: vorhanden | fehlt | fehlerhaft | nicht_pruefbar.
// Nur owner/admin; Antwort enthaelt NIE Inhalte, nur Status + Kurzdetail.

const SB = supabaseAdmin as any;

type CheckStatus = "vorhanden" | "fehlt" | "fehlerhaft" | "nicht_pruefbar";
type Check = { id: string; name: string; status: CheckStatus; detail: string };

// Erwartetes Schema (Migrationen im Repo → supabase/migrations/).
const SCHEMA_PROBEN: Array<{ id: string; name: string; table: string; cols: string; mig: string }> =
  [
    {
      id: "prospect_audits_async",
      name: "Analyse-Jobspalten (prospect_audits)",
      table: "prospect_audits",
      cols: "id, attempts, max_attempts, next_retry_at, last_error, last_started_at, failed_at",
      mig: "20260821140000_prospect_audits_async.sql",
    },
    {
      id: "analyse_worker_heartbeat",
      name: "Worker-Heartbeat-Tabelle",
      table: "analyse_worker_heartbeat",
      cols: "id, last_run_at, jobs_processed, errors",
      mig: "20260821140000_prospect_audits_async.sql",
    },
    {
      id: "admin_jobs",
      name: "Admin-Jobs (asynchrone Datenlaeufe)",
      table: "admin_jobs",
      cols: "id, status, job_type, locked_until, attempts",
      mig: "20260821160000_admin_jobs.sql",
    },
    {
      id: "admin_audit_log",
      name: "Admin-Aenderungsprotokoll",
      table: "admin_audit_log",
      cols: "id, organization_id, action, table_name, created_at",
      mig: "20260817120000_admin_audit_log.sql",
    },
    {
      id: "public_report_links",
      name: "Report-Link-Registry (Widerruf/Audit)",
      table: "public_report_links",
      cols: "id, token_hash, organization_id, client_id, revoked_at, expires_at",
      mig: "20260818150000_public_report_links.sql",
    },
    {
      id: "ai_opportunity_states",
      name: "KI-Chancen-Workflow",
      table: "ai_opportunity_states",
      cols: "id",
      mig: "20260818…_ai_opportunities.sql",
    },
    {
      id: "ai_opportunity_assignee",
      name: "KI-Chancen: Team-Zuweisung",
      table: "ai_opportunity_states",
      cols: "assignee_user_id",
      mig: "20260821100000_ai_opportunity_workflow_v2.sql",
    },
    {
      id: "app_notifications_dedupe",
      name: "Benachrichtigungen: Dedupe-Schluessel",
      table: "app_notifications",
      cols: "dedupe_key",
      mig: "20260821100000_ai_opportunity_workflow_v2.sql",
    },
  ];

// Sensible Tabellen, die fuer anonyme Clients NIE lesbar sein duerfen.
const RLS_PROBEN = [
  "prospect_audits",
  "admin_jobs",
  "admin_audit_log",
  "public_report_links",
  "oauth_connections",
  "analyse_worker_heartbeat",
];

function schemaStatus(error: any): { status: CheckStatus; detail: string } {
  if (!error) return { status: "vorhanden", detail: "ok" };
  const msg = String(error.message || "");
  const code = String(error.code || "");
  if (code === "42P01" || /could not find the table|relation .* does not exist/i.test(msg))
    return { status: "fehlt", detail: "Tabelle fehlt — Migration nicht angewendet" };
  if (code === "42703" || /column|Could not find .* column/i.test(msg))
    return { status: "fehlt", detail: "Spalte(n) fehlen — Migration nicht angewendet" };
  return { status: "fehlerhaft", detail: msg.slice(0, 140) };
}

export const Route = createFileRoute("/api/admin/system-check")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const ctx = await requireTeamRole(request, "admin");
        if (ctx instanceof Response) return ctx;

        const checks: Check[] = [];

        // 1) Schema-Proben (Service-Role): Probe-Select auf exakt die Spalten.
        for (const p of SCHEMA_PROBEN) {
          const { error } = await SB.from(p.table).select(p.cols).limit(1);
          const st = schemaStatus(error);
          checks.push({
            id: p.id,
            name: p.name,
            status: st.status,
            detail: st.status === "vorhanden" ? "ok" : `${st.detail} (${p.mig})`,
          });
        }

        // Audit-Trigger: via REST nicht direkt pruefbar — funktionaler Beleg
        // ueber vorhandene Protokoll-Eintraege der Organisation.
        try {
          const { count, error } = await SB.from("admin_audit_log")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", ctx.organizationId);
          checks.push(
            error
              ? { id: "audit_trigger", name: "Audit-Trigger", ...schemaStatus(error), detail: "" }
              : (count ?? 0) > 0
                ? {
                    id: "audit_trigger",
                    name: "Audit-Trigger (admin_audit_trigger)",
                    status: "vorhanden",
                    detail: `funktional belegt (${count} Protokoll-Eintraege)`,
                  }
                : {
                    id: "audit_trigger",
                    name: "Audit-Trigger (admin_audit_trigger)",
                    status: "nicht_pruefbar",
                    detail:
                      "Keine Protokoll-Eintraege — Trigger via REST nicht direkt pruefbar; nach der naechsten Admin-Aenderung erneut pruefen",
                  },
          );
        } catch {
          checks.push({
            id: "audit_trigger",
            name: "Audit-Trigger",
            status: "nicht_pruefbar",
            detail: "Zaehlung fehlgeschlagen",
          });
        }

        // 2) RLS-Proben: ANONYMER Client (ohne Login) darf NICHTS lesen.
        const url = process.env.SUPABASE_URL;
        const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
        if (url && anonKey) {
          const anon = createClient(url, anonKey);
          for (const t of RLS_PROBEN) {
            try {
              const { data, error } = await (anon as any).from(t).select("id").limit(1);
              if (Array.isArray(data) && data.length > 0)
                checks.push({
                  id: `rls_${t}`,
                  name: `RLS: ${t}`,
                  status: "fehlerhaft",
                  detail: "ANONYM LESBAR — RLS-Policy fehlt oder ist offen!",
                });
              else if (error && String(error.code) === "42P01")
                checks.push({
                  id: `rls_${t}`,
                  name: `RLS: ${t}`,
                  status: "fehlt",
                  detail: "Tabelle fehlt",
                });
              else
                checks.push({
                  id: `rls_${t}`,
                  name: `RLS: ${t}`,
                  status: "vorhanden",
                  detail: "anonym nicht lesbar",
                });
            } catch {
              checks.push({
                id: `rls_${t}`,
                name: `RLS: ${t}`,
                status: "nicht_pruefbar",
                detail: "Probe fehlgeschlagen",
              });
            }
          }
        } else {
          checks.push({
            id: "rls",
            name: "RLS-Proben",
            status: "nicht_pruefbar",
            detail: "SUPABASE_URL/ANON_KEY fehlt",
          });
        }

        // 3) Worker-Heartbeat (gleiche Schwellen wie /api/agent/analyse?worker=1).
        let worker: any = { zustand: "nicht_pruefbar" };
        try {
          const { data: hb } = await SB.from("analyse_worker_heartbeat")
            .select("*")
            .eq("id", 1)
            .maybeSingle();
          const alterMs = hb?.last_run_at ? Date.now() - new Date(hb.last_run_at).getTime() : null;
          worker = {
            zustand:
              alterMs == null || alterMs > 10 * 60_000
                ? "ausgefallen"
                : alterMs > 3 * 60_000
                  ? "verzoegert"
                  : "aktiv",
            lastRunAt: hb?.last_run_at ?? null,
            jobsProcessed: hb?.jobs_processed ?? null,
            errors: hb?.errors ?? null,
          };
        } catch {
          /* bleibt nicht_pruefbar */
        }

        // 4) WP-Secret-Migrationsstatus (nur Zaehler, Org-gebunden).
        const secrets = { aktuell: 0, veraltet: 0, klartext: 0, fehlerhaft: 0, gesamt: 0 };
        try {
          const { data: clients } = await SB.from("clients")
            .select("id")
            .eq("organization_id", ctx.organizationId);
          const ids = (clients || []).map((c: any) => c.id);
          if (ids.length) {
            const { data: rows } = await SB.from("oauth_connections")
              .select("access_token")
              .eq("provider", "wordpress")
              .in("client_id", ids);
            for (const r of rows || []) {
              const stored = String(r.access_token ?? "");
              if (!stored) continue;
              secrets.gesamt++;
              secrets[secretStatus(stored)]++;
            }
          }
        } catch {
          /* Zaehler bleiben 0 */
        }

        return Response.json(
          {
            ok: true,
            stand: new Date().toISOString(),
            checks,
            worker,
            secrets: {
              ...secrets,
              strictModus: String(process.env.WP_SECRETS_STRICT || "") === "1",
              dedizierterSchluessel: Boolean(process.env.WP_SECRET_KEY_V1),
            },
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
