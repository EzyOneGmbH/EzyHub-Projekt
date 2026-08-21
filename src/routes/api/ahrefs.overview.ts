import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { canRunAudits } from "@/server/integrations.server";
import { dfsAuth, fetchBacklinkOverview, normalizeDomain } from "@/server/backlink-overview.server";

// Backlink-/Autoritäts-Übersicht — 2026-08-06 von Ahrefs auf DataForSEO abgelöst.
// Ahrefs war die letzte Live-Quelle im Overview-Panel (die KI-Sichtbarkeit lief
// schon seit 19.07. über DataForSEO). Route-Pfad bleibt /api/ahrefs/overview,
// damit das Panel unverändert fetchen kann. Die DataForSEO-Logik liegt seit
// 07.08. in src/server/backlink-overview.server.ts (geteilt mit
// /api/admin/backlink-backfill, das alle Kunden im Durchlauf befüllt).
// Metrik-Bruch bewusst: DFS-Rank/Link-Index ≠ Ahrefs -> Quelle im Ergebnis
// gelabelt (source:"dataforseo"), Panel zeigt es an.

const QuerySchema = z.object({
  clientId: z.string().uuid(),
});

export const Route = createFileRoute("/api/ahrefs/overview")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = dfsAuth();
        if (!auth) {
          return Response.json(
            { error: "DATAFORSEO_LOGIN/PASSWORD not configured" },
            { status: 503 },
          );
        }

        const supabaseUrl = process.env.SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
        if (!supabaseUrl || !serviceKey || !anonKey) {
          return Response.json({ error: "Server not configured" }, { status: 503 });
        }

        const authHeader = request.headers.get("authorization") ?? "";
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        const {
          data: { user },
        } = await userClient.auth.getUser();
        if (!user) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        let body: unknown = {};
        try {
          body = await request.json();
        } catch {
          /* empty */
        }
        const parsed = QuerySchema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { error: "Invalid input", issues: parsed.error.issues },
            { status: 400 },
          );
        }

        const admin = createClient(supabaseUrl, serviceKey);

        const clientId = parsed.data.clientId;
        const { data: client, error: clientErr } = await userClient
          .from("clients")
          .select("id, domain, organization_id")
          .eq("id", clientId)
          .maybeSingle();
        if (clientErr || !client) {
          return Response.json({ error: "Client not found or access denied" }, { status: 404 });
        }
        if (!client.domain) {
          return Response.json(
            { error: "Kein domain für diesen Kunden gepflegt." },
            { status: 400 },
          );
        }
        if (!(await canRunAudits(user.id, client.organization_id))) {
          return Response.json(
            { error: "Keine Berechtigung für Audit-Läufe (viewer/read-only)." },
            { status: 403 },
          );
        }
        // Kein Ahrefs-Provider-Gate mehr — DataForSEO ist plattformweit (pay-per-call).
        const domain = normalizeDomain(client.domain);
        const organizationId = client.organization_id;

        const { all_failed: allFailed, ...result } = await fetchBacklinkOverview(domain, auth);

        if (clientId && organizationId) {
          await admin.from("audit_runs").insert({
            client_id: clientId,
            organization_id: organizationId,
            triggered_by: user.id,
            audit_type: "ahrefs", // Feld-Kontinuität (Dashboard/Filter); Quelle steht in result.source
            status: allFailed ? "failed" : "succeeded",
            input: { domain },
            result: result as unknown as Record<string, unknown>,
            error: allFailed ? "Alle DataForSEO-Sektionen fehlgeschlagen" : null,
            started_at: new Date().toISOString(),
            finished_at: new Date().toISOString(),
          });
        }

        // ok-Feld (Regressions-Fix 2026-08-21, additiv): Messstatus auch bei
        // HTTP 200 maschinenlesbar — all_failed hiess bisher "200 ohne Signal",
        // useMeasurement/runTool meldeten dann faelschlich Erfolg. Bestehende
        // Konsumenten (ahrefs-panel, GoogleClientPanel) lesen nur Datenfelder.
        return Response.json(
          allFailed
            ? { ok: false, error: "Alle DataForSEO-Sektionen fehlgeschlagen", ...result }
            : { ok: true, ...result },
          {
            status: 200,
            headers: { "Cache-Control": "no-store" },
          },
        );
      },
    },
  },
});
