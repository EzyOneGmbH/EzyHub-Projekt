import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { canRunAudits } from "@/server/integrations.server";

// Backlink-/Autoritäts-Übersicht — 2026-08-06 von Ahrefs auf DataForSEO abgelöst.
// Ahrefs war die letzte Live-Quelle im Overview-Panel (die KI-Sichtbarkeit lief
// schon seit 19.07. über DataForSEO). Route-Pfad bleibt /api/ahrefs/overview,
// damit das Panel unverändert fetchen kann; die Daten kommen jetzt aus:
//   - backlinks/summary/live      -> rank (DR-Ersatz) + Backlinks/Referring Domains
//   - backlinks/history/live      -> Referring-Domains-Verlauf (90 Tage)
//   - dataforseo_labs domain_rank_overview -> organischer Traffic/Keywords (Schätzung)
// Metrik-Bruch bewusst: DFS-Rank/Link-Index ≠ Ahrefs -> Quelle im Ergebnis
// gelabelt (source:"dataforseo"), Panel zeigt es an.

const QuerySchema = z.object({
  clientId: z.string().uuid(),
});

const DFS_BASE = "https://api.dataforseo.com/v3";

function dfsAuth(): string | null {
  const login = process.env.DATAFORSEO_LOGIN, pass = process.env.DATAFORSEO_PASSWORD;
  if (!login || !pass) return null;
  return "Basic " + Buffer.from(`${login}:${pass}`).toString("base64");
}

type SectionResult<T> = { ok: true; data: T } | { ok: false; error: string };

// Generischer DataForSEO-Live-Call (Basic-Auth, Task-Array-Body). Gibt das erste
// result-Objekt zurück; Fehler (inkl. task-level status_code) werden gefangen.
async function dfsCall<T = any>(
  path: string,
  task: Record<string, unknown>,
  auth: string,
  timeoutMs = 12000,
): Promise<SectionResult<T>> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${DFS_BASE}/${path}`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify([task]),
      signal: ctrl.signal,
    });
    const j: any = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const taskObj = j?.tasks?.[0];
    if (!taskObj || (taskObj.status_code && taskObj.status_code >= 40000)) {
      return { ok: false, error: `DFS ${taskObj?.status_code ?? "?"}: ${String(taskObj?.status_message ?? "kein Ergebnis").slice(0, 120)}` };
    }
    return { ok: true, data: (taskObj.result?.[0] ?? null) as T };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e).slice(0, 120) };
  } finally {
    clearTimeout(t);
  }
}

export const Route = createFileRoute("/api/ahrefs/overview")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = dfsAuth();
        if (!auth) {
          return Response.json({ error: "DATAFORSEO_LOGIN/PASSWORD not configured" }, { status: 503 });
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
        const domain = String(client.domain).replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
        const organizationId = client.organization_id;
        const dateFrom = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

        // Parallel: Summary (rank + Backlinks), History (Refdomains 90d), Labs (organisch CH).
        const [summary, history, labs] = await Promise.all([
          dfsCall("backlinks/summary/live", { target: domain, include_subdomains: true, backlinks_status_type: "live" }, auth),
          dfsCall("backlinks/history/live", { target: domain, date_from: dateFrom }, auth),
          dfsCall("dataforseo_labs/google/domain_rank_overview/live", { target: domain, location_code: 2756, language_code: "de" }, auth),
        ]);

        // In die bestehenden Panel-Schlüssel mappen (Panel zeigt rohes JSON).
        const s: any = summary.ok ? summary.data : null;
        const domain_rating = s
          ? { rank: s.rank ?? null, backlinks: s.backlinks ?? null, referring_domains: s.referring_domains ?? null, _hinweis: "DataForSEO-Rank (0–1000), ersetzt Ahrefs Domain Rating" }
          : null;
        const backlinks_stats = s
          ? {
              backlinks: s.backlinks ?? null,
              referring_domains: s.referring_domains ?? null,
              referring_main_domains: s.referring_main_domains ?? null,
              referring_domains_nofollow: s.referring_domains_nofollow ?? null,
              broken_backlinks: s.broken_backlinks ?? null,
              referring_pages: s.referring_pages ?? null,
            }
          : null;
        const histItems = history.ok ? ((history.data as any)?.items ?? []) : [];
        const refdomains_history = history.ok
          ? { items: (histItems as any[]).map((it) => ({ date: it.date, referring_domains: it.referring_domains, backlinks: it.backlinks })) }
          : null;
        const org = labs.ok ? ((labs.data as any)?.items?.[0]?.metrics?.organic ?? null) : null;
        const metrics = org
          ? { organic_traffic_etv: org.etv ?? null, organic_keywords: org.count ?? null, pos_1: org.pos_1 ?? null, pos_2_3: org.pos_2_3 ?? null, pos_4_10: org.pos_4_10 ?? null }
          : null;

        const result = {
          generated_at: new Date().toISOString(),
          domain,
          source: "dataforseo",
          rate_limited: false,
          domain_rating,
          backlinks_stats,
          refdomains_history,
          metrics,
          errors: {
            domain_rating: summary.ok ? null : summary.error,
            backlinks_stats: summary.ok ? null : summary.error,
            refdomains_history: history.ok ? null : history.error,
            metrics: labs.ok ? null : labs.error,
          },
        };

        if (clientId && organizationId) {
          const allFailed = !summary.ok && !history.ok && !labs.ok;
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

        return Response.json(result, {
          status: 200,
          headers: { "Cache-Control": "no-store" },
        });
      },
    },
  },
});
