import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { normalizeCanonryBase } from "@/lib/canonry-url";
import { isProviderEnabled } from "@/server/integrations.server";

const QuerySchema = z.object({
  project: z.string().min(1).max(255),
  domain: z.string().min(1).max(255).optional(),
  clientId: z.string().uuid().optional(),
});

type SectionResult<T> =
  | { ok: true; data: T }
  | { ok: false; status?: number; error: string };

function redact(input: unknown, secrets: Array<string | undefined>): string {
  let s = typeof input === "string" ? input : input instanceof Error ? input.message : String(input);
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
  timeoutMs = 8000
): Promise<SectionResult<T>> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: redact(`HTTP ${res.status}: ${text}`, secrets) };
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
          project: url.searchParams.get("project") ?? "",
          domain: url.searchParams.get("domain") ?? undefined,
        });
        if (!parsed.success) {
          return new Response(
            JSON.stringify({ error: "Invalid query", issues: parsed.error.issues }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        const { project, domain } = parsed.data;

        const baseUrl = process.env.CANONRY_BASE_URL;
        const apiKey = process.env.CANONRY_API_KEY;
        const secrets = [baseUrl, apiKey];

        if (!baseUrl || !apiKey) {
          return new Response(
            JSON.stringify({ error: "Canonry not configured" }),
            { status: 503, headers: { "Content-Type": "application/json" } }
          );
        }

        const base = normalizeCanonryBase(baseUrl);
        const p = encodeURIComponent(project);
        const qs = domain ? `?domain=${encodeURIComponent(domain)}` : "";

        // Probe the project itself first — fail fast on 404.
        const projectRes = await fetchSection<unknown>(`${base}/projects/${p}`, apiKey, secrets);
        if (!projectRes.ok && projectRes.status === 404) {
          return new Response(
            JSON.stringify({ error: "Project not found", project }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          );
        }

        const [history, timeline, health, runs, keywords, insights, schedule] =
          await Promise.all([
            fetchSection(`${base}/projects/${p}/history${qs}`, apiKey, secrets),
            fetchSection(`${base}/projects/${p}/timeline${qs}`, apiKey, secrets),
            fetchSection(`${base}/projects/${p}/health/latest${qs}`, apiKey, secrets),
            fetchSection(`${base}/projects/${p}/runs/latest${qs}`, apiKey, secrets),
            fetchSection(`${base}/projects/${p}/keywords${qs}`, apiKey, secrets),
            fetchSection(`${base}/projects/${p}/insights${qs}`, apiKey, secrets),
            fetchSection(`${base}/projects/${p}/schedule`, apiKey, secrets),
          ]);

        // Helpers: tolerate 404 on optional sections (runs, schedule).
        const tolerate404 = <T,>(r: SectionResult<T>): T | null => {
          if (r.ok) return r.data;
          if (r.status === 404) return null;
          return null;
        };
        const errorOf = <T,>(r: SectionResult<T>): string | null =>
          r.ok || r.status === 404 ? null : r.error;

        const body = {
          generated_at: new Date().toISOString(),
          project: projectRes.ok ? projectRes.data : null,
          domain: domain ?? null,
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
        };

        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
