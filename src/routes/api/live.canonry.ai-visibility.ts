import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizeCanonryBase } from "@/lib/canonry-url";
import { isProviderEnabled, canRunAudits } from "@/server/integrations.server";

// AI Visibility (KI-Sichtbarkeit) — bundles the Canonry endpoints that back the
// Semrush-style AI Visibility dashboard and persists a snapshot per tenant.
// Server-only Canonry key (never reaches the client). Mirrors live.canonry.overview.ts.
// Read path for the dashboard is the persisted audit_runs row (RLS, works for viewers);
// this route is the members-gated refresh that re-pulls + persists.

const QuerySchema = z.object({ clientId: z.string().uuid() });

type SectionResult<T> = { ok: true; data: T } | { ok: false; status?: number; error: string };

function redact(input: unknown, secrets: Array<string | undefined>): string {
  let s =
    typeof input === "string" ? input : input instanceof Error ? input.message : String(input);
  for (const v of secrets) {
    if (!v || v.length < 4) continue;
    s = s.split(v).join("***REDACTED***");
  }
  s = s.replace(/Bearer\s+[A-Za-z0-9\-_.=]+/gi, "Bearer ***REDACTED***");
  return s.slice(0, 500);
}

async function fetchSection<T = unknown>(
  url: string,
  key: string,
  secrets: Array<string | undefined>,
  timeoutMs = 8000,
): Promise<SectionResult<T>> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        error: redact(`HTTP ${res.status}: ${text}`, secrets),
      };
    }
    const data = (await res.json().catch(() => null)) as T;
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: redact(e, secrets) };
  } finally {
    clearTimeout(t);
  }
}

export const Route = createFileRoute("/api/live/canonry/ai-visibility")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const parsed = QuerySchema.safeParse({ clientId: url.searchParams.get("clientId") ?? "" });
        if (!parsed.success) {
          return Response.json(
            { error: "clientId is required", issues: parsed.error.issues },
            { status: 400 },
          );
        }
        const { clientId } = parsed.data;

        const supabaseUrl = process.env.SUPABASE_URL;
        const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
        const baseUrl = process.env.CANONRY_BASE_URL;
        const apiKey = process.env.CANONRY_API_KEY;
        const secrets = [baseUrl, apiKey];

        if (!supabaseUrl || !anonKey)
          return Response.json({ error: "Server not configured" }, { status: 503 });
        if (!baseUrl || !apiKey)
          return Response.json({ error: "Canonry not configured" }, { status: 503 });

        const authHeader = request.headers.get("authorization") ?? "";
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        const {
          data: { user },
        } = await userClient.auth.getUser();
        if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

        // RLS-scoped lookup ensures org membership (no cross-tenant read).
        const { data: client, error: clientErr } = await userClient
          .from("clients")
          .select("id, domain, organization_id, canonry_project")
          .eq("id", clientId)
          .maybeSingle();
        if (clientErr || !client)
          return Response.json({ error: "Client not found or access denied" }, { status: 404 });
        if (!client.canonry_project)
          return Response.json(
            { error: "Kein canonry_project für diesen Kunden gepflegt." },
            { status: 400 },
          );
        if (!(await canRunAudits(user.id, client.organization_id)))
          return Response.json(
            { error: "Keine Berechtigung für Audit-Läufe (viewer/read-only)." },
            { status: 403 },
          );
        if (!(await isProviderEnabled(client.id, "canonry")))
          return Response.json(
            { error: "Canonry für diesen Kunden deaktiviert." },
            { status: 403 },
          );

        const base = normalizeCanonryBase(baseUrl);
        const p = encodeURIComponent(client.canonry_project);

        const [visibility, metrics, sources, contentSources, health, competitors] =
          await Promise.all([
            fetchSection(`${base}/projects/${p}/citations/visibility`, apiKey, secrets),
            fetchSection(`${base}/projects/${p}/analytics/metrics?window=all`, apiKey, secrets),
            fetchSection(
              `${base}/projects/${p}/analytics/sources?window=all&limit=50`,
              apiKey,
              secrets,
            ),
            fetchSection(`${base}/projects/${p}/content/sources`, apiKey, secrets),
            fetchSection(`${base}/projects/${p}/health/latest`, apiKey, secrets),
            fetchSection(`${base}/projects/${p}/competitors`, apiKey, secrets),
          ]);

        const errorOf = <T>(r: SectionResult<T>): string | null =>
          r.ok || r.status === 404 ? null : r.error;

        const result = {
          generated_at: new Date().toISOString(),
          project: client.canonry_project,
          domain: client.domain ?? null,
          visibility: visibility.ok ? visibility.data : null,
          metrics: metrics.ok ? metrics.data : null,
          sources: sources.ok ? sources.data : null,
          contentSources: contentSources.ok ? contentSources.data : null,
          health: health.ok ? health.data : null,
          competitors: competitors.ok ? competitors.data : null,
          errors: {
            visibility: errorOf(visibility),
            metrics: errorOf(metrics),
            sources: errorOf(sources),
            contentSources: errorOf(contentSources),
            health: errorOf(health),
            competitors: errorOf(competitors),
          },
        };

        // Persist a per-tenant snapshot so the dashboard (incl. viewers) can read it
        // without a live Canonry call. Non-fatal on failure.
        const allFailed =
          !visibility.ok && !metrics.ok && !sources.ok && !contentSources.ok && !health.ok;
        try {
          await supabaseAdmin.from("audit_runs").insert({
            client_id: client.id,
            organization_id: client.organization_id,
            triggered_by: user.id,
            audit_type: "canonry_ai_visibility",
            status: allFailed ? "failed" : "succeeded",
            input: { project: client.canonry_project },
            result: result as never,
            error: allFailed ? "All Canonry AI-visibility sections failed" : null,
            started_at: new Date().toISOString(),
            finished_at: new Date().toISOString(),
          });
        } catch {
          /* non-fatal */
        }

        return Response.json(result, {
          status: 200,
          headers: { "Cache-Control": "no-store" },
        });
      },
    },
  },
});
