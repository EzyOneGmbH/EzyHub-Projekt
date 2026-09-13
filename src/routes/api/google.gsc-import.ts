import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "@/server/google-tokens.server";
import { redactSecrets } from "@/server/google-oauth.server";
import { canonryUrl } from "@/lib/canonry-url";
import { isProviderEnabled, canRunAudits } from "@/server/integrations.server";
import { zeitraum } from "@/lib/date-range";
import { gscTotals, gscRows, GscFehler, GSC_END_LAG_DAYS } from "@/server/gsc.server";

const Body = z.object({
  clientId: z.string().uuid(),
  days: z.number().int().min(1).max(90).default(28),
  // Exakter, inklusiver Zeitraum (13.09.2026): hat Vorrang vor days. Ohne
  // Range gilt «letzte N Tage» bis heute-3 (GSC-Datenpuffer, wie populate).
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  // Datumsfilter-Abfragen (2026-08-11): persist:false liest nur — kein
  // Canonry-Push, kein audit_runs-Insert (Agent-Snapshots bleiben unberührt).
  persist: z.boolean().default(true),
  // GSC erlaubt bis 25000 Zeilen je Abfrage; Default 1000 statt bisher 50.
  rowLimit: z.number().int().min(1).max(25000).default(1000),
});

async function authedUser(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!;
  const authHeader = request.headers.get("authorization") ?? "";
  const sb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data } = await sb.auth.getUser();
  return data.user;
}

async function requireMember(userId: string, clientId: string, requireAdmin = false) {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, organization_id, gsc_property, ga4_property, canonry_project")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return { error: "Client not found", status: 404 as const };
  const { data: m } = await supabaseAdmin
    .from("app_users")
    .select("role")
    .eq("user_id", userId)
    .eq("organization_id", client.organization_id)
    .maybeSingle();
  if (!m) return { error: "Forbidden", status: 403 as const };
  if (requireAdmin && !["owner", "admin"].includes(m.role))
    return { error: "Forbidden", status: 403 as const };
  return { client };
}

const API_DISABLED = /has not been used|is disabled|accessNotConfigured|SERVICE_DISABLED/i;

// Turn an opaque GSC 403 into an actionable message: distinguishes
// "API not enabled" vs "wrong property string" vs "no permission for site".
async function diagnoseGsc403(
  accessToken: string,
  configured: string,
  originalText: string,
): Promise<string> {
  if (API_DISABLED.test(originalText))
    return "Search Console API ist im Google-Cloud-Projekt nicht aktiviert. In der Google Cloud Console unter 'APIs & Services → Library' die 'Google Search Console API' aktivieren, ~1 Min warten und erneut importieren.";
  try {
    const r = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) {
      const tt = await r.text().catch(() => "");
      if (API_DISABLED.test(tt))
        return "Search Console API ist nicht aktiviert ('APIs & Services → Library' → 'Google Search Console API' aktivieren).";
      return redactSecrets(`GSC HTTP 403 (sites.list ${r.status}): ${tt}`);
    }
    const j = (await r.json()) as { siteEntry?: Array<{ siteUrl: string }> };
    const sites = (j.siteEntry ?? []).map((s) => s.siteUrl);
    if (!sites.length)
      return "Das verbundene Google-Konto hat keine Search-Console-Properties. Bitte mit dem Konto verbinden, das in der Search Console als Eigentümer/Nutzer verifiziert ist.";
    if (!sites.includes(configured))
      return `Property '${configured}' ist für dieses Konto nicht zugänglich. Verfügbare Properties (eine davon EXAKT eintragen): ${sites.join(" · ")}`;
    return `Property '${configured}' existiert, aber der Zugriff wurde verweigert — Berechtigung in der Search Console prüfen.`;
  } catch {
    return redactSecrets(`GSC HTTP 403: ${originalText}`);
  }
}

export const Route = createFileRoute("/api/google/gsc-import")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const user = await authedUser(request);
          if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
          const body = await request.json().catch(() => ({}));
          const parsed = Body.safeParse(body);
          if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });

          const r = await requireMember(user.id, parsed.data.clientId);
          if ("error" in r) return Response.json({ error: r.error }, { status: r.status });
          const client = r.client;
          if (!(await canRunAudits(user.id, client.organization_id)))
            return Response.json(
              { ok: false, error: "Keine Berechtigung für Audit-Läufe (viewer/read-only)." },
              { status: 403 },
            );
          if (!client.gsc_property)
            return Response.json({ ok: false, error: "Kein GSC-Property gesetzt." });
          if (!(await isProviderEnabled(client.id, "google")))
            return Response.json(
              { ok: false, error: "Google-Integration für diesen Kunden deaktiviert." },
              { status: 403 },
            );

          const { accessToken } = await getGoogleAccessToken(client.id);
          // Zeitraum-Vereinheitlichung (13.09.2026): exakt + inklusiv; days-
          // Modus = genau N Tage bis heute-3 (frueher N+1 Tage bis heute).
          let zr;
          try {
            zr = zeitraum({
              days: parsed.data.days,
              startDate: parsed.data.startDate,
              endDate: parsed.data.endDate,
              endLagDays: GSC_END_LAG_DAYS,
              maxDays: 90,
            });
          } catch (e) {
            return Response.json(
              { ok: false, error: e instanceof Error ? e.message : String(e) },
              { status: 400 },
            );
          }
          // Gesamttotale aus der Aggregat-Abfrage (ohne Dimension); Query-
          // Zeilen separat (paginiert) mit Coverage-Kennzeichnung.
          const basis = {
            site: client.gsc_property,
            accessToken,
            startDate: zr.startDate,
            endDate: zr.endDate,
          };
          let totals;
          let rowsRes;
          try {
            totals = await gscTotals(basis);
            rowsRes = await gscRows({
              ...basis,
              dimensions: ["query"],
              rowLimit: parsed.data.rowLimit,
              orderBy: [{ field: "clicks", descending: true }],
              totals,
            });
          } catch (e) {
            const error =
              e instanceof GscFehler && e.status === 403
                ? await diagnoseGsc403(accessToken, client.gsc_property, e.body)
                : redactSecrets(e);
            return Response.json({ ok: false, error });
          }
          const keywords = rowsRes.rows.map((r) => ({
            query: r.keys[0],
            clicks: r.clicks,
            impressions: r.impressions,
            ctr: r.ctr,
            position: r.position,
          }));

          let canonryStatus: { ok: boolean; count?: number; error?: string } = {
            ok: false,
            error: "Canonry not configured",
          };
          const canonryBase = process.env.CANONRY_BASE_URL;
          const canonryKey = process.env.CANONRY_API_KEY;
          if (!parsed.data.persist) {
            canonryStatus = { ok: false, error: "übersprungen (Nur-Lese-Abfrage)" };
          } else if (!(await isProviderEnabled(client.id, "canonry"))) {
            canonryStatus = { ok: false, error: "Canonry für diesen Kunden deaktiviert." };
          } else if (!client.canonry_project) {
            canonryStatus = { ok: false, error: "Kein Canonry-Projekt-Slug gesetzt." };
          } else if (canonryBase && canonryKey && keywords.length > 0) {
            try {
              const cRes = await fetch(
                canonryUrl(
                  canonryBase,
                  `/projects/${encodeURIComponent(client.canonry_project)}/keywords`,
                ),
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${canonryKey}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    source: "gsc",
                    property: client.gsc_property,
                    keywords: keywords.map((k) => ({ query: k.query, metrics: k })),
                  }),
                },
              );
              if (!cRes.ok) {
                const t = await cRes.text().catch(() => "");
                canonryStatus = {
                  ok: false,
                  error: redactSecrets(`Canonry HTTP ${cRes.status}: ${t}`),
                };
              } else canonryStatus = { ok: true, count: keywords.length };
            } catch (e) {
              canonryStatus = { ok: false, error: redactSecrets(e) };
            }
          }
          // Persist a GSC summary so the SEO dashboard can read totals + top queries.
          const gscSummary = {
            days: zr.days,
            range: { from: zr.startDate, to: zr.endDate },
            metrics: {
              clicks: totals.clicks,
              impressions: totals.impressions,
              ctr: totals.ctr,
              position: totals.position,
              quelle: totals.quelle,
            },
            coverage: rowsRes.coverage,
            topQueries: keywords.slice(0, 25),
          };
          try {
            if (parsed.data.persist)
              await supabaseAdmin.from("audit_runs").insert({
                client_id: client.id,
                organization_id: client.organization_id,
                triggered_by: user.id,
                audit_type: "gsc_summary",
                status: "succeeded",
                input: { days: zr.days, range: gscSummary.range },
                result: gscSummary as never,
                started_at: new Date().toISOString(),
                finished_at: new Date().toISOString(),
              });
          } catch {
            /* non-fatal */
          }

          return Response.json({
            ok: true,
            imported: keywords.length,
            sample: keywords.slice(0, 10),
            canonry: canonryStatus,
            gsc: gscSummary.metrics,
            // Datumsfilter (2026-08-11): volle Summary im run.result-Format,
            // damit das Dashboard gscKpisFromResult direkt anwenden kann.
            ...gscSummary,
          });
        } catch (e) {
          return Response.json({ ok: false, error: redactSecrets(e) });
        }
      },
    },
  },
});
