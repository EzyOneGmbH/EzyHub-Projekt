import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { normalizeCanonryBase } from "@/lib/canonry-url";
import { isProviderEnabled, canRunAudits } from "@/server/integrations.server";

const QuerySchema = z.object({
  clientId: z.string().uuid(),
});

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

export const Route = createFileRoute("/api/live/canonry/overview")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const parsed = QuerySchema.safeParse({
          clientId: url.searchParams.get("clientId") ?? "",
        });
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

        if (!supabaseUrl || !anonKey) {
          return Response.json({ error: "Server not configured" }, { status: 503 });
        }
        if (!baseUrl || !apiKey) {
          return Response.json({ error: "Canonry not configured" }, { status: 503 });
        }

        // Auth: validate user via the request's bearer token
        const authHeader = request.headers.get("authorization") ?? "";
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        const {
          data: { user },
        } = await userClient.auth.getUser();
        if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

        // RLS-scoped lookup ensures org membership
        const { data: client, error: clientErr } = await userClient
          .from("clients")
          .select("id, domain, organization_id, canonry_project")
          .eq("id", clientId)
          .maybeSingle();
        if (clientErr || !client) {
          return Response.json({ error: "Client not found or access denied" }, { status: 404 });
        }
        if (!client.canonry_project) {
          return Response.json(
            { error: "Kein canonry_project für diesen Kunden gepflegt." },
            { status: 400 },
          );
        }
        if (!(await canRunAudits(user.id, client.organization_id))) {
          return Response.json(
            { error: "Keine Berechtigung für Audit-Läufe (viewer/read-only)." },
            { status: 403 },
          );
        }
        if (!(await isProviderEnabled(client.id, "canonry"))) {
          return Response.json(
            { error: "Canonry für diesen Kunden deaktiviert." },
            { status: 403 },
          );
        }

        const base = normalizeCanonryBase(baseUrl);
        const p = encodeURIComponent(client.canonry_project);
        const qs = client.domain ? `?domain=${encodeURIComponent(client.domain)}` : "";

        const projectRes = await fetchSection<unknown>(`${base}/projects/${p}`, apiKey, secrets);
        if (!projectRes.ok && projectRes.status === 404) {
          return Response.json(
            { error: "Project not found", project: client.canonry_project },
            { status: 404 },
          );
        }

        const [history, timeline, health, runs, keywords, insights, schedule] = await Promise.all([
          fetchSection(`${base}/projects/${p}/history${qs}`, apiKey, secrets),
          fetchSection(`${base}/projects/${p}/timeline${qs}`, apiKey, secrets),
          fetchSection(`${base}/projects/${p}/health/latest${qs}`, apiKey, secrets),
          fetchSection(`${base}/projects/${p}/runs/latest${qs}`, apiKey, secrets),
          fetchSection(`${base}/projects/${p}/keywords${qs}`, apiKey, secrets),
          fetchSection(`${base}/projects/${p}/insights${qs}`, apiKey, secrets),
          fetchSection(`${base}/projects/${p}/schedule`, apiKey, secrets),
        ]);

        const tolerate404 = <T>(r: SectionResult<T>): T | null =>
          r.ok ? r.data : r.status === 404 ? null : null;
        const errorOf = <T>(r: SectionResult<T>): string | null =>
          r.ok || r.status === 404 ? null : r.error;

        return Response.json(
          {
            generated_at: new Date().toISOString(),
            project: projectRes.ok ? projectRes.data : null,
            domain: client.domain ?? null,
            history: history.ok ? history.data : null,
            timeline: timeline.ok ? timeline.data : null,
            health: health.ok ? health.data : null,
            runs: tolerate404(runs),
            keywords: keywords.ok ? keywords.data : null,
            insights: insights.ok ? insights.data : null,
            schedule: tolerate404(schedule),
            errors: {
              project: projectRes.ok ? null : projectRes.error,
              history: errorOf(history),
              timeline: errorOf(timeline),
              health: errorOf(health),
              runs: errorOf(runs),
              keywords: errorOf(keywords),
              insights: errorOf(insights),
              schedule: errorOf(schedule),
            },
          },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
