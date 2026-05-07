import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "./google-tokens.server";
import { redactSecrets } from "./google-oauth.server";
import { canonryUrl } from "@/lib/canonry-url";

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
        rowLimit: z.number().int().min(1).max(500).default(50),
      })
      .parse(d)
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

      const end = new Date();
      const start = new Date(end);
      start.setDate(end.getDate() - data.days);
      const fmt = (d: Date) => d.toISOString().slice(0, 10);

      const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
        client.gsc_property
      )}/searchAnalytics/query`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate: fmt(start),
          endDate: fmt(end),
          dimensions: ["query"],
          rowLimit: data.rowLimit,
          orderBy: [{ field: "clicks", descending: true }],
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        return { ok: false, error: redactSecrets(`GSC HTTP ${res.status}: ${t}`) };
      }
      const json = (await res.json()) as { rows?: Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }> };
      const rows = json.rows ?? [];
      const keywords = rows.map((r) => ({
        query: r.keys[0],
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: r.ctr,
        position: r.position,
      }));

      // Push to Canonry — graceful if not configured
      let canonryStatus: { ok: boolean; count?: number; error?: string } = { ok: false, error: "Canonry not configured" };
      const canonryBase = process.env.CANONRY_BASE_URL;
      const canonryKey = process.env.CANONRY_API_KEY;
      if (!canonryProject) {
        canonryStatus = { ok: false, error: "Kein Canonry-Projekt-Slug für diesen Client gesetzt." };
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
            }
          );
          if (!cRes.ok) {
            const t = await cRes.text().catch(() => "");
            canonryStatus = { ok: false, error: redactSecrets(`Canonry HTTP ${cRes.status}: ${t}`) };
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
      })
      .parse(d)
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

      const propertyId = client.ga4_property.replace(/^properties\//, "");
      const url = `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dateRanges: [{ startDate: `${data.days}daysAgo`, endDate: "today" }],
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
