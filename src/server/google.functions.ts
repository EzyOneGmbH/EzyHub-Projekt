import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "./google-tokens.server";
import { redactSecrets } from "./google-oauth.server";
import { canonryUrl } from "@/lib/canonry-url";
import { zeitraum, ga4DateRange } from "@/lib/date-range";
import { gscRows, GSC_END_LAG_DAYS } from "./gsc.server";
import { ga4Coverage, ga4RunReportUrl } from "./ga4.server";

async function assertOrgAdmin(userId: string, clientId: string) {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, organization_id, gsc_property")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) throw new Error("Client not found");
  const { data: m } = await supabaseAdmin
    .from("app_users")
    .select("role")
    .eq("user_id", userId)
    .eq("organization_id", client.organization_id)
    .maybeSingle();
  if (!m || !["owner", "admin", "member"].includes(m.role)) throw new Error("Forbidden");
  return client;
}

/**
 * Import top GSC queries for a client and append them to Canonry keywords.
 */
export const gscKeywordImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        days: z.number().int().min(1).max(90).default(28),
        startDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        endDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        rowLimit: z.number().int().min(1).max(25000).default(1000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const client = await assertOrgAdmin(context.userId, data.clientId);
      const { data: clientFull } = await supabaseAdmin
        .from("clients")
        .select("canonry_project")
        .eq("id", client.id)
        .maybeSingle();
      const canonryProject = clientFull?.canonry_project ?? null;
      if (!client.gsc_property) {
        return { ok: false, error: "Kein GSC-Property für diesen Client gesetzt." };
      }

      const { accessToken } = await getGoogleAccessToken(client.id);

      // Zeitraum-Vereinheitlichung (13.09.2026): genau N inklusive Tage bis
      // heute-3 (GSC-Puffer) bzw. exakter Range; Zeilen paginiert.
      const zr = zeitraum({
        days: data.days,
        startDate: data.startDate,
        endDate: data.endDate,
        endLagDays: GSC_END_LAG_DAYS,
        maxDays: 90,
      });
      const { rows, coverage } = await gscRows({
        site: client.gsc_property,
        accessToken,
        startDate: zr.startDate,
        endDate: zr.endDate,
        dimensions: ["query"],
        rowLimit: data.rowLimit, // nativ nach Klicks (API-Vertrag)
      });
      const keywords = rows.map((r) => ({
        query: r.keys[0],
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: r.ctr,
        position: r.position,
      }));

      // Push to Canonry — graceful if not configured
      let canonryStatus: { ok: boolean; count?: number; error?: string } = {
        ok: false,
        error: "Canonry not configured",
      };
      const canonryBase = process.env.CANONRY_BASE_URL;
      const canonryKey = process.env.CANONRY_API_KEY;
      if (!canonryProject) {
        canonryStatus = {
          ok: false,
          error: "Kein Canonry-Projekt-Slug für diesen Client gesetzt.",
        };
      } else if (canonryBase && canonryKey && keywords.length > 0) {
        try {
          const cRes = await fetch(
            canonryUrl(canonryBase, `/projects/${encodeURIComponent(canonryProject)}/keywords`),
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
          } else {
            canonryStatus = { ok: true, count: keywords.length };
          }
        } catch (e) {
          canonryStatus = { ok: false, error: redactSecrets(e) };
        }
      }

      return {
        ok: true,
        imported: keywords.length,
        range: { from: zr.startDate, to: zr.endDate },
        coverage,
        sample: keywords.slice(0, 10),
        canonry: canonryStatus,
      };
    } catch (e) {
      return { ok: false, error: redactSecrets(e) };
    }
  });

/**
 * Get a small GA4 summary (sessions, users, engagedSessions for last N days).
 */
export const ga4Summary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        days: z.number().int().min(1).max(90).default(28),
        startDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        endDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const { data: client } = await supabaseAdmin
        .from("clients")
        .select("id, organization_id, ga4_property")
        .eq("id", data.clientId)
        .maybeSingle();
      if (!client) return { ok: false, error: "Client not found" };
      const { data: m } = await supabaseAdmin
        .from("app_users")
        .select("role")
        .eq("user_id", context.userId)
        .eq("organization_id", client.organization_id)
        .maybeSingle();
      if (!m) return { ok: false, error: "Forbidden" };
      if (!client.ga4_property) return { ok: false, error: "Kein GA4-Property gesetzt." };

      const { accessToken } = await getGoogleAccessToken(client.id);

      const url = ga4RunReportUrl(client.ga4_property);

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          // 13.09.2026: explizite, inklusive Daten ("NdaysAgo".."today" waren N+1 Tage).
          dateRanges: [
            ga4DateRange(
              zeitraum({
                days: data.days,
                startDate: data.startDate,
                endDate: data.endDate,
                maxDays: 90,
              }),
            ),
          ],
          metrics: [
            { name: "sessions" },
            { name: "totalUsers" },
            { name: "engagedSessions" },
            { name: "screenPageViews" },
          ],
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        return { ok: false, error: redactSecrets(`GA4 HTTP ${res.status}: ${t}`) };
      }
      const json = (await res.json()) as {
        rows?: Array<{ metricValues: Array<{ value: string }> }>;
      };
      const row = json.rows?.[0]?.metricValues ?? [];
      return {
        ok: true,
        days: data.days,
        metrics: {
          sessions: Number(row[0]?.value ?? 0),
          totalUsers: Number(row[1]?.value ?? 0),
          engagedSessions: Number(row[2]?.value ?? 0),
          screenPageViews: Number(row[3]?.value ?? 0),
        },
        // GA4-Coverage (21.09.2026): Kuerzung/Sampling laut responseMetaData.
        coverage: ga4Coverage(json),
      };
    } catch (e) {
      return { ok: false, error: redactSecrets(e) };
    }
  });

/**
 * Tells the UI whether a client has a Google connection (no token data leaves the server).
 */
export const getGoogleConnectionStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { data: conn } = await supabaseAdmin
      .from("oauth_connections")
      .select("id, account_email, scopes, expires_at, updated_at")
      .eq("client_id", data.clientId)
      .eq("provider", "google")
      .maybeSingle();
    return {
      connected: !!conn,
      email: conn?.account_email ?? null,
      scopes: conn?.scopes ?? [],
      updatedAt: conn?.updated_at ?? null,
    };
  });

/**
 * Disconnect Google for a client (admin only). Wipes tokens.
 */
export const disconnectGoogle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("organization_id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!client) return { ok: false, error: "Client not found" };
    const { data: m } = await supabaseAdmin
      .from("app_users")
      .select("role")
      .eq("user_id", context.userId)
      .eq("organization_id", client.organization_id)
      .maybeSingle();
    if (!m || !["owner", "admin"].includes(m.role)) return { ok: false, error: "Forbidden" };
    await supabaseAdmin
      .from("oauth_connections")
      .delete()
      .eq("client_id", data.clientId)
      .eq("provider", "google");
    return { ok: true };
  });
