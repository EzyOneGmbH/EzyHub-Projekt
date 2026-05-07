import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { isProviderEnabled, canRunAudits } from "@/server/integrations.server";

const QuerySchema = z.object({
  clientId: z.string().uuid(),
});

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

type SectionResult<T> =
  | { ok: true; data: T }
  | { ok: false; status?: number; error: string; rate_limited?: boolean };

async function ahrefsFetch<T>(
  path: string,
  params: Record<string, string>,
  apiKey: string,
  secrets: Array<string | undefined>,
  timeoutMs = 8000,
): Promise<SectionResult<T>> {
  const url = new URL(`https://api.ahrefs.com/v3/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const rate_limited = res.status === 429;
      return {
        ok: false,
        status: res.status,
        rate_limited,
        error: redact(
          rate_limited ? `Ahrefs rate limit reached (HTTP 429)` : `HTTP ${res.status}: ${text}`,
          secrets,
        ),
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

export const Route = createFileRoute("/api/ahrefs/overview")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.AHREFS_API_KEY;
        const secrets = [apiKey];
        if (!apiKey) {
          return Response.json({ error: "AHREFS_API_KEY not configured" }, { status: 503 });
        }

        const supabaseUrl = process.env.SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const anonKey = process.env.SUPABASE_ANON_KEY;
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
        if (!(await isProviderEnabled(client.id, "ahrefs"))) {
          return Response.json({ error: "Ahrefs für diesen Kunden deaktiviert." }, { status: 403 });
        }
        const domain = client.domain;
        const organizationId = client.organization_id;

        const today = new Date().toISOString().slice(0, 10);

        // Parallel fetch core metrics. Each handles its own errors.
        const [domainRating, backlinksStats, refdomains, metrics] = await Promise.all([
          ahrefsFetch<unknown>(
            "site-explorer/domain-rating",
            { target: domain, date: today },
            apiKey,
            secrets,
          ),
          ahrefsFetch<unknown>(
            "site-explorer/backlinks-stats",
            { target: domain, date: today, mode: "domain" },
            apiKey,
            secrets,
          ),
          ahrefsFetch<unknown>(
            "site-explorer/refdomains-history",
            {
              target: domain,
              date_from: new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10),
              history_grouping: "weekly",
              mode: "domain",
            },
            apiKey,
            secrets,
          ),
          ahrefsFetch<unknown>(
            "site-explorer/metrics",
            { target: domain, date: today, mode: "domain" },
            apiKey,
            secrets,
          ),
        ]);

        const rate_limited = [domainRating, backlinksStats, refdomains, metrics].some(
          (r) => !r.ok && r.rate_limited,
        );

        const result = {
          generated_at: new Date().toISOString(),
          domain,
          rate_limited,
          domain_rating: domainRating.ok ? domainRating.data : null,
          backlinks_stats: backlinksStats.ok ? backlinksStats.data : null,
          refdomains_history: refdomains.ok ? refdomains.data : null,
          metrics: metrics.ok ? metrics.data : null,
          errors: {
            domain_rating: domainRating.ok ? null : domainRating.error,
            backlinks_stats: backlinksStats.ok ? null : backlinksStats.error,
            refdomains_history: refdomains.ok ? null : refdomains.error,
            metrics: metrics.ok ? null : metrics.error,
          },
        };

        // Persist into audit_runs when we have a client + org context.
        if (clientId && organizationId) {
          const allFailed = !domainRating.ok && !backlinksStats.ok && !refdomains.ok && !metrics.ok;
          await admin.from("audit_runs").insert({
            client_id: clientId,
            organization_id: organizationId,
            triggered_by: user.id,
            audit_type: "ahrefs",
            status: allFailed ? "failed" : "succeeded",
            input: { domain },
            result: result as unknown as Record<string, unknown>,
            error: allFailed
              ? rate_limited
                ? "Ahrefs rate limit"
                : "All Ahrefs sections failed"
              : null,
            started_at: new Date().toISOString(),
            finished_at: new Date().toISOString(),
          });
        }

        return Response.json(result, {
          status: 200,
          headers: { "Cache-Control": "no-store" },
        });
      },
    },
  },
});
