import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "@/server/google-tokens.server";
import { redactSecrets } from "@/server/google-oauth.server";

// Content-Performance-Sync (agentenunabhängig). Läuft server-seitig mit dem
// service_role-Client (Lovable Cloud hält den Key intern; n8n/extern kommt NICHT
// an die DB). Wiederverwendung der bestehenden populate-Bausteine:
//   getGoogleAccessToken(client) -> per-Kunde GSC/GA4-Token (kein OAuth-Setup nötig)
// Zwei Phasen je Kunde:
//   1) discover : WP-REST /wp/v2/posts -> upsert content_items (alle publizierten
//                 Blogartikel, auch die direkt auf der Kundenseite erstellten)
//   2) metrics  : GSC (page + top-query) + GA4 (pagePath) in WENIGEN Calls je
//                 Kunde -> upsert content_metrics (captured_on = heute-3) und
//                 primary_keyword-Backfill aus der GSC-Top-Query
// Secret-gated (ADMIN_AUTOMATION_SECRET), keine willkürliche SQL, keine Deletes.

const Body = z.object({
  client: z.string().optional(), // Name (ilike) oder uuid
  all: z.boolean().optional(),
  jobs: z.array(z.enum(["discover", "metrics"])).optional(),
  perPage: z.number().int().min(1).max(100).default(100), // WP-Posts pro Seite
  maxPages: z.number().int().min(1).max(20).default(10), // WP-Pagination-Cap
});

const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ""));
const nowIso = () => new Date().toISOString();
// Referenztag = heute-3 (letzter vollständiger GSC-Tag), YYYY-MM-DD.
function refDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 3);
  return d.toISOString().slice(0, 10);
}
// URL normalisieren für Map-Matching (ohne Protokoll/trailing slash, lowercase).
function normUrl(u: string): string {
  return String(u || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}
function pathOf(u: string): string {
  try {
    return new URL(u).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return "/";
  }
}
const cleanDomain = (d: string) =>
  String(d || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");

// ── 1) Discovery: publizierte WP-Posts -> content_items ─────────────────────
async function jobDiscover(c: any, perPage: number, maxPages: number) {
  const domain = cleanDomain(c.domain);
  if (!domain) return { skipped: "keine Domain" };
  const rows: any[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const u = `https://${domain}/wp-json/wp/v2/posts?status=publish&per_page=${perPage}&page=${page}&_fields=id,link,title,date`;
    let res: Response;
    try {
      res = await fetch(u, { signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      return { error: redactSecrets(e), imported: rows.length };
    }
    if (res.status === 400) break; // WP: Seite über letzter -> Ende der Pagination
    if (!res.ok) return { error: `WP HTTP ${res.status}`, imported: rows.length };
    const posts: any[] = await res.json().catch(() => []);
    if (!Array.isArray(posts) || posts.length === 0) break;
    for (const p of posts) {
      const link = String(p?.link || "");
      if (!link) continue;
      rows.push({
        client_id: c.id,
        title: p?.title?.rendered ? String(p.title.rendered) : "(ohne Titel)",
        target_url: link,
        published_at: String(p?.date || "").slice(0, 10) || null,
        status: "published",
        content_type: "blog",
        language: c.language || "de",
        source: "discovered",
      });
    }
    if (posts.length < perPage) break;
  }
  if (!rows.length) return { imported: 0 };
  // Idempotent: braucht den partial unique index (client_id, target_url) aus
  // 20260703140000_content_discovery.sql. WP-Datum ist maßgeblich für published_at.
  const { error } = await supabaseAdmin
    .from("content_items")
    .upsert(rows as never, { onConflict: "client_id,target_url", ignoreDuplicates: false });
  if (error) return { error: error.message, attempted: rows.length };
  return { imported: rows.length };
}

// ── 2) Metrics: GSC + GA4 (wenige Calls) -> content_metrics ─────────────────
async function jobMetrics(c: any) {
  // Nur Kunden mit publiziertem, entdecktem/manuellem Content.
  const { data: items } = await supabaseAdmin
    .from("content_items")
    .select("id, target_url, primary_keyword")
    .eq("client_id", c.id)
    .eq("status", "published")
    .not("target_url", "is", null);
  if (!items || !items.length) return { skipped: "keine Artikel" };

  const ref = refDate();
  let token: string | null = null;
  try {
    token = (await getGoogleAccessToken(c.id)).accessToken;
  } catch (e) {
    return { error: "Google-Token: " + redactSecrets(e) };
  }
  const gApi = async (url: string, body: unknown) => {
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 120)}`);
    return (await r.json()) as any;
  };

  // --- GSC: page-level Metriken (1 Call) ---
  const gscByUrl = new Map<string, any>();
  const topQueryByUrl = new Map<string, string>();
  if (c.gsc_property) {
    const gscUrl = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
      c.gsc_property,
    )}/searchAnalytics/query`;
    try {
      const pg = await gApi(gscUrl, {
        startDate: ref,
        endDate: ref,
        dimensions: ["page"],
        rowLimit: 1000,
      });
      for (const row of pg.rows ?? []) gscByUrl.set(normUrl(row.keys?.[0] ?? ""), row);
    } catch {
      /* Metriken bleiben leer -> graceful */
    }
    // Top-Query je Seite über 28 Tage (1 Call) -> primary_keyword-Backfill.
    try {
      const start = new Date();
      start.setDate(start.getDate() - 30);
      const pq = await gApi(gscUrl, {
        startDate: start.toISOString().slice(0, 10),
        endDate: ref,
        dimensions: ["page", "query"],
        rowLimit: 5000,
        orderBy: [{ field: "clicks", descending: true }],
      });
      for (const row of pq.rows ?? []) {
        const key = normUrl(row.keys?.[0] ?? "");
        if (!topQueryByUrl.has(key) && row.keys?.[1]) topQueryByUrl.set(key, String(row.keys[1]));
      }
    } catch {
      /* optional */
    }
  }

  // --- GA4: sessions/conversions je pagePath (1 Call) ---
  const ga4ByPath = new Map<string, { sessions: number; conversions: number }>();
  if (c.ga4_property) {
    const propertyId = String(c.ga4_property).replace(/^properties\//, "");
    const ga4Url = `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(
      propertyId,
    )}:runReport`;
    try {
      const rep = await gApi(ga4Url, {
        dateRanges: [{ startDate: ref, endDate: ref }],
        dimensions: [{ name: "pagePath" }],
        metrics: [{ name: "sessions" }, { name: "conversions" }],
        limit: 1000,
      });
      for (const row of rep.rows ?? []) {
        const p = String(row.dimensionValues?.[0]?.value ?? "").replace(/\/+$/, "") || "/";
        ga4ByPath.set(p.toLowerCase(), {
          sessions: Number(row.metricValues?.[0]?.value ?? 0),
          conversions: Number(row.metricValues?.[1]?.value ?? 0),
        });
      }
    } catch {
      /* optional */
    }
  }

  // --- Rows bauen + upserten ---
  const metricRows: any[] = [];
  const kwUpdates: Array<{ id: string; primary_keyword: string }> = [];
  for (const it of items) {
    const key = normUrl(it.target_url);
    const g = gscByUrl.get(key);
    const ga = ga4ByPath.get(pathOf(it.target_url).toLowerCase());
    metricRows.push({
      content_item_id: it.id,
      captured_on: ref,
      position: g ? g.position ?? null : null,
      impressions: g ? Math.round(g.impressions ?? 0) : 0,
      clicks: g ? Math.round(g.clicks ?? 0) : 0,
      ctr: g ? g.ctr ?? null : null,
      sessions: ga ? ga.sessions : 0,
      conversions: ga ? ga.conversions : 0,
      backlinks: null,
      ai_citations: null,
    });
    const tq = topQueryByUrl.get(key);
    if (tq && (!it.primary_keyword || it.primary_keyword === "")) {
      kwUpdates.push({ id: it.id, primary_keyword: tq });
    }
  }

  let upserted = 0;
  if (metricRows.length) {
    const { error } = await supabaseAdmin
      .from("content_metrics")
      .upsert(metricRows as never, { onConflict: "content_item_id,captured_on" });
    if (error) return { error: error.message };
    upserted = metricRows.length;
  }
  // primary_keyword-Backfill (nur leere).
  for (const k of kwUpdates) {
    await supabaseAdmin
      .from("content_items")
      .update({ primary_keyword: k.primary_keyword })
      .eq("id", k.id)
      .or("primary_keyword.is.null,primary_keyword.eq.");
  }
  return { articles: items.length, metrics: upserted, keywords: kwUpdates.length };
}

export const Route = createFileRoute("/api/admin/content-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret)
          return Response.json(
            { ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" },
            { status: 503 },
          );
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });
        const { client: sel, all, jobs, perPage, maxPages } = parsed.data;
        const wanted = jobs && jobs.length ? jobs : (["discover", "metrics"] as const);

        const query = supabaseAdmin
          .from("clients")
          .select("id, name, domain, organization_id, gsc_property, ga4_property, language");
        let clients: any[] = [];
        if (all) clients = (await query).data || [];
        else if (sel && isUuid(sel)) clients = (await query.eq("id", sel)).data || [];
        else if (sel) clients = (await query.ilike("name", `%${sel}%`)).data || [];
        else
          return Response.json({ ok: false, error: "client oder all erforderlich" }, { status: 400 });
        if (!clients.length)
          return Response.json({ ok: false, error: "Kein Kunde gefunden" }, { status: 404 });

        const results: any[] = [];
        for (const c of clients) {
          const jr: Record<string, unknown> = {};
          for (const j of wanted) {
            try {
              if (j === "discover") jr.discover = await jobDiscover(c, perPage, maxPages);
              else if (j === "metrics") jr.metrics = await jobMetrics(c);
            } catch (e) {
              jr[j] = { error: redactSecrets(e) };
            }
          }
          results.push({ client: c.name, domain: c.domain, jobs: jr });
        }
        return Response.json({ ok: true, count: clients.length, results, capturedOn: refDate() });
      },
    },
  },
});
