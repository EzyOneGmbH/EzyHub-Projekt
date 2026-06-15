import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "@/server/google-tokens.server";
import { redactSecrets } from "@/server/google-oauth.server";
import { normalizeCanonryBase } from "@/lib/canonry-url";

function slugify(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// Machine-triggerable data population (no user session). Protected by a shared
// secret (ADMIN_AUTOMATION_SECRET) — inert until that env var is set. Runs only
// predefined data jobs (Ahrefs / Core Web Vitals / GSC / GA4) and writes
// audit_runs for existing clients. No arbitrary SQL, no destructive ops.

const Body = z.object({
  client: z.string().optional(), // client name (ilike) or uuid
  all: z.boolean().optional(), // populate every client
  jobs: z.array(z.enum(["ahrefs", "pagespeed", "gsc", "ga4", "geo"])).optional(),
  days: z.number().int().min(1).max(90).default(28),
  runGeo: z.boolean().optional(), // geo job: also trigger a Canonry sweep (costs)
  geoSlug: z.string().optional(), // geo job: force a specific Canonry project slug
  debug: z.boolean().optional(), // return diagnostics instead of running jobs
});

const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ""));
const num = (v: unknown) => (typeof v === "number" ? v : null);
const nowIso = () => new Date().toISOString();

async function ownerOf(orgId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("app_users")
    .select("user_id, role")
    .eq("organization_id", orgId)
    .limit(20);
  const o = (data || []).find((r: any) => ["owner", "admin"].includes(r.role)) || (data || [])[0];
  return (o as any)?.user_id || null;
}
async function insertRun(row: Record<string, unknown>) {
  await supabaseAdmin.from("audit_runs").insert(row as never);
}

async function jobPagespeed(c: any, uid: string, _days: number) {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return { skipped: "GOOGLE_API_KEY fehlt" };
  if (!c.domain) return { skipped: "keine Domain" };
  const target = `https://${String(c.domain).replace(/^https?:\/\//, "")}`;
  const u = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  u.searchParams.set("url", target);
  u.searchParams.set("key", key);
  u.searchParams.set("strategy", "mobile");
  u.searchParams.append("category", "performance");
  const r = await fetch(u, { signal: AbortSignal.timeout(60_000) });
  const json: any = await r.json().catch(() => ({}));
  if (!r.ok) return { error: redactSecrets(json?.error?.message || `PSI HTTP ${r.status}`) };
  const field = json?.loadingExperience?.metrics ?? {};
  const lab = json?.lighthouseResult?.audits ?? {};
  const metrics = {
    lcp: num(field?.LARGEST_CONTENTFUL_PAINT_MS?.percentile),
    inp: num(field?.INTERACTION_TO_NEXT_PAINT?.percentile),
    cls:
      typeof field?.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile === "number"
        ? field.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100
        : null,
    lcpLab: num(lab?.["largest-contentful-paint"]?.numericValue),
    clsLab: num(lab?.["cumulative-layout-shift"]?.numericValue),
    performanceScore:
      typeof json?.lighthouseResult?.categories?.performance?.score === "number"
        ? Math.round(json.lighthouseResult.categories.performance.score * 100)
        : null,
    strategy: "mobile",
    url: target,
  };
  await insertRun({
    client_id: c.id, organization_id: c.organization_id, triggered_by: uid,
    audit_type: "pagespeed", status: "succeeded", input: { url: target, strategy: "mobile" },
    result: { metrics }, started_at: nowIso(), finished_at: nowIso(),
  });
  return { score: metrics.performanceScore, lcp: metrics.lcp ?? metrics.lcpLab };
}

async function ahrefsCall(path: string, params: Record<string, string>, key: string) {
  const u = new URL(`https://api.ahrefs.com/v3/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) return { ok: false as const, error: `HTTP ${r.status}` };
  return { ok: true as const, data: await r.json().catch(() => null) };
}
async function jobAhrefs(c: any, uid: string) {
  const key = process.env.AHREFS_API_KEY;
  if (!key) return { skipped: "AHREFS_API_KEY fehlt" };
  const domain = String(c.domain || "").replace(/^https?:\/\//, "");
  if (!domain) return { skipped: "keine Domain" };
  // Ahrefs has no data for "today" (rejects it as "bad date") -> use yesterday.
  // mode "subdomains" so a bare domain also captures its www/host data.
  const date = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const from = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const [dr, bl, rd, mt] = await Promise.all([
    ahrefsCall("site-explorer/domain-rating", { target: domain, date }, key),
    ahrefsCall("site-explorer/backlinks-stats", { target: domain, date, mode: "subdomains" }, key),
    ahrefsCall("site-explorer/refdomains-history", { target: domain, date_from: from, history_grouping: "weekly", mode: "subdomains" }, key),
    ahrefsCall("site-explorer/metrics", { target: domain, date, mode: "subdomains" }, key),
  ]);
  const result = {
    generated_at: nowIso(), domain,
    domain_rating: dr.ok ? dr.data : null,
    backlinks_stats: bl.ok ? bl.data : null,
    refdomains_history: rd.ok ? rd.data : null,
    metrics: mt.ok ? mt.data : null,
    errors: {
      domain_rating: dr.ok ? null : dr.error, backlinks_stats: bl.ok ? null : bl.error,
      refdomains_history: rd.ok ? null : rd.error, metrics: mt.ok ? null : mt.error,
    },
  };
  await insertRun({
    client_id: c.id, organization_id: c.organization_id, triggered_by: uid,
    audit_type: "ahrefs", status: "succeeded", input: { domain }, result,
    started_at: nowIso(), finished_at: nowIso(),
  });
  return { ok: true };
}

async function jobGsc(c: any, uid: string, days: number) {
  if (!c.gsc_property) return { skipped: "kein gsc_property" };
  const { accessToken } = await getGoogleAccessToken(c.id);
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - days);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(c.gsc_property)}/searchAnalytics/query`;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ startDate: fmt(start), endDate: fmt(end), dimensions: ["query"], rowLimit: 50, orderBy: [{ field: "clicks", descending: true }] }),
  });
  if (!r.ok) return { error: redactSecrets(`GSC HTTP ${r.status}: ${await r.text().catch(() => "")}`) };
  const json: any = await r.json();
  const keywords = (json.rows ?? []).map((x: any) => ({ query: x.keys[0], clicks: x.clicks, impressions: x.impressions, ctr: x.ctr, position: x.position }));
  const t = keywords.reduce((a: any, k: any) => { a.clicks += k.clicks || 0; a.impressions += k.impressions || 0; a.posSum += (k.position || 0) * (k.impressions || 0); return a; }, { clicks: 0, impressions: 0, posSum: 0 });
  const result = {
    days,
    metrics: { clicks: t.clicks, impressions: t.impressions, ctr: t.impressions > 0 ? t.clicks / t.impressions : 0, position: t.impressions > 0 ? t.posSum / t.impressions : 0 },
    topQueries: keywords.slice(0, 25),
  };
  await insertRun({
    client_id: c.id, organization_id: c.organization_id, triggered_by: uid,
    audit_type: "gsc_summary", status: "succeeded", input: { days }, result,
    started_at: nowIso(), finished_at: nowIso(),
  });
  return { imported: keywords.length };
}

async function jobGa4(c: any, uid: string, days: number) {
  if (!c.ga4_property) return { skipped: "kein ga4_property" };
  const { accessToken } = await getGoogleAccessToken(c.id);
  const propertyId = String(c.ga4_property).replace(/^properties\//, "");
  const base = `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`;
  const dateRanges = [{ startDate: `${days}daysAgo`, endDate: "today" }];
  const call = async (b: unknown) => {
    const r = await fetch(base, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(b) });
    if (!r.ok) throw new Error(`GA4 HTTP ${r.status}: ${await r.text().catch(() => "")}`);
    return (await r.json()) as any;
  };
  const CORE = ["sessions", "totalUsers", "newUsers", "engagedSessions", "screenPageViews", "bounceRate", "averageSessionDuration"];
  const core = await call({ dateRanges, metrics: CORE.map((name) => ({ name })) });
  const cv = core.rows?.[0]?.metricValues ?? [];
  const metrics: Record<string, number> = {};
  CORE.forEach((n, i) => (metrics[n] = Number(cv[i]?.value ?? 0)));
  try {
    const opt = await call({ dateRanges, metrics: [{ name: "conversions" }, { name: "totalRevenue" }] });
    const ov = opt.rows?.[0]?.metricValues ?? [];
    metrics.conversions = Number(ov[0]?.value ?? 0);
    metrics.totalRevenue = Number(ov[1]?.value ?? 0);
  } catch {
    metrics.conversions = 0;
    metrics.totalRevenue = 0;
  }
  let series: any[] = [];
  try {
    const tr = await call({ dateRanges, dimensions: [{ name: "date" }], metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "screenPageViews" }], orderBys: [{ dimension: { dimensionName: "date" } }] });
    series = (tr.rows ?? []).map((x: any) => ({ date: x.dimensionValues?.[0]?.value ?? "", sessions: Number(x.metricValues?.[0]?.value ?? 0), totalUsers: Number(x.metricValues?.[1]?.value ?? 0), pageViews: Number(x.metricValues?.[2]?.value ?? 0) }));
  } catch {
    /* trend optional */
  }
  await insertRun({
    client_id: c.id, organization_id: c.organization_id, triggered_by: uid,
    audit_type: "ga4_summary", status: "succeeded", input: { days }, result: { days, metrics, series },
    started_at: nowIso(), finished_at: nowIso(),
  });
  return { sessions: metrics.sessions };
}

// GEO: ensure a Canonry project + set client.canonry_project (+ optional sweep).
async function jobGeo(c: any, opts: { runGeo?: boolean; geoSlug?: string }) {
  const base = process.env.CANONRY_BASE_URL;
  const key = process.env.CANONRY_API_KEY;
  if (!base || !key) return { skipped: "Canonry not configured" };
  const slug = opts.geoSlug || c.canonry_project || slugify(c.name || c.domain || "");
  if (!slug) return { skipped: "kein Slug" };
  const root = normalizeCanonryBase(base);
  const H = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const proj = `${root}/projects/${encodeURIComponent(slug)}`;
  // 1. create (idempotent)
  await fetch(proj, {
    method: "PUT",
    headers: H,
    body: JSON.stringify({
      displayName: c.name || slug,
      canonicalDomain: String(c.domain || `${slug}.example`).replace(/^https?:\/\//, ""),
      country: String(c.country || "CH").toUpperCase().slice(0, 2),
      language: c.language || "de",
    }),
  }).catch(() => {});
  // 2. persist slug on the client
  await supabaseAdmin.from("clients").update({ canonry_project: slug }).eq("id", c.id);
  // 3. ensure queries exist (generate if none)
  let queries = 0;
  try {
    const qr = await fetch(`${proj}/queries`, { headers: H });
    const qj: any = await qr.json().catch(() => []);
    queries = Array.isArray(qj) ? qj.length : qj?.queries?.length || 0;
  } catch {}
  if (queries === 0) {
    try {
      const g = await fetch(`${proj}/queries/generate`, { method: "POST", headers: H, body: JSON.stringify({ provider: "perplexity", count: 8 }) });
      const gj: any = await g.json().catch(() => ({}));
      const qs: string[] = gj?.queries || [];
      if (qs.length) {
        await fetch(`${proj}/queries`, { method: "POST", headers: H, body: JSON.stringify({ queries: qs }) });
        queries = qs.length;
      }
    } catch {}
  }
  // 4. optional sweep (costs)
  let run: string | null = null;
  if (opts.runGeo) {
    try {
      const rr = await fetch(`${proj}/runs`, { method: "POST", headers: H, body: JSON.stringify({ trigger: "manual", providers: ["perplexity", "openai"], noLocation: true }) });
      const rj: any = await rr.json().catch(() => ({}));
      run = rj?.id || rj?.status || (rr.ok ? "queued" : `HTTP ${rr.status}`);
    } catch (e) {
      run = redactSecrets(e);
    }
  }
  return { slug, queries, run };
}

export const Route = createFileRoute("/api/admin/populate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret) return Response.json({ ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" }, { status: 503 });
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });
        const { client: sel, all, jobs, days, runGeo, geoSlug } = parsed.data;
        const wanted = jobs && jobs.length ? jobs : (["ahrefs", "pagespeed", "gsc", "ga4"] as const);

        let query = supabaseAdmin
          .from("clients")
          .select("id, name, domain, organization_id, gsc_property, ga4_property, country, language, canonry_project");
        let clients: any[] = [];
        if (all) clients = (await query).data || [];
        else if (sel && isUuid(sel)) clients = (await query.eq("id", sel)).data || [];
        else if (sel) clients = (await query.ilike("name", `%${sel}%`)).data || [];
        else return Response.json({ ok: false, error: "client oder all erforderlich" }, { status: 400 });
        if (!clients.length) return Response.json({ ok: false, error: "Kein Kunde gefunden" }, { status: 404 });

        // --- Diagnostics: why is a dashboard empty? ---
        if (parsed.data.debug) {
          const cBase = process.env.CANONRY_BASE_URL;
          const cKey = process.env.CANONRY_API_KEY;
          const dbg: any[] = [];
          for (const c of clients) {
            const d: any = {
              client: c.name,
              domain: c.domain,
              canonry_project: c.canonry_project ?? null,
              gsc_property: c.gsc_property ?? null,
              ga4_property: c.ga4_property ?? null,
              canonryEnv: { baseSet: !!cBase, keySet: !!cKey },
            };
            if (cBase && cKey && c.canonry_project) {
              try {
                const root = normalizeCanonryBase(cBase);
                const r = await fetch(`${root}/projects/${encodeURIComponent(c.canonry_project)}`, {
                  headers: { Authorization: `Bearer ${cKey}`, Accept: "application/json" },
                  signal: AbortSignal.timeout(10_000),
                });
                d.canonryProjectFetch = { status: r.status, ok: r.ok };
                if (!r.ok) d.canonryProjectFetch.body = redactSecrets((await r.text().catch(() => "")).slice(0, 150));
              } catch (e) {
                d.canonryProjectFetch = { error: redactSecrets(e) };
              }
            }
            try {
              const { data: ar } = await supabaseAdmin
                .from("audit_runs")
                .select("audit_type, created_at")
                .eq("client_id", c.id)
                .order("created_at", { ascending: false })
                .limit(8);
              d.recentAuditRuns = (ar || []).map((x: any) => x.audit_type);
            } catch (e) {
              d.recentAuditRuns = redactSecrets(e);
            }
            dbg.push(d);
          }
          return Response.json({ ok: true, debug: dbg });
        }

        const results: any[] = [];
        for (const c of clients) {
          const uid = await ownerOf(c.organization_id);
          const jr: Record<string, unknown> = {};
          if (!uid) {
            results.push({ client: c.name, error: "Kein Org-User für triggered_by" });
            continue;
          }
          for (const j of wanted) {
            try {
              if (j === "ahrefs") jr.ahrefs = await jobAhrefs(c, uid);
              else if (j === "pagespeed") jr.pagespeed = await jobPagespeed(c, uid, days);
              else if (j === "gsc") jr.gsc = await jobGsc(c, uid, days);
              else if (j === "ga4") jr.ga4 = await jobGa4(c, uid, days);
              else if (j === "geo") jr.geo = await jobGeo(c, { runGeo, geoSlug });
            } catch (e) {
              jr[j] = { error: redactSecrets(e) };
            }
          }
          results.push({ client: c.name, domain: c.domain, jobs: jr });
        }
        return Response.json({ ok: true, count: clients.length, results });
      },
    },
  },
});
