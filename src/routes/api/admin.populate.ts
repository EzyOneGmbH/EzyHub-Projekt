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
  jobs: z
    .array(
      z.enum([
        "ahrefs",
        "pagespeed",
        "gsc",
        "ga4",
        "ga4_traffic",
        "ga4_conversions",
        "ai_visibility",
        "geo",
      ]),
    )
    .optional(),
  days: z.number().int().min(1).max(90).default(28),
  runGeo: z.boolean().optional(), // geo job: also trigger a Canonry sweep (costs)
  geoSlug: z.string().optional(), // geo job: force a specific Canonry project slug
  // Skip a job when a succeeded run of its audit_type exists within this many hours.
  // 0 = always run. The 12h cron passes e.g. 6 so duplicate triggers don't double-spend.
  minIntervalHours: z.number().min(0).max(168).default(0),
  force: z.boolean().optional(), // ignore the freshness guard
  debug: z.boolean().optional(), // return diagnostics instead of running jobs
});

// audit_type written by each job (for the freshness guard).
const JOB_AUDIT_TYPE: Record<string, string> = {
  ahrefs: "ahrefs",
  pagespeed: "pagespeed",
  gsc: "gsc_summary",
  ga4: "ga4_summary",
  ga4_traffic: "ga4_traffic",
  ga4_conversions: "ga4_conversions",
  ai_visibility: "canonry_ai_visibility",
};

// AI-referral source hostnames (substring match on GA4 sessionSource).
const AI_SOURCE_PATTERNS = [
  "chatgpt",
  "openai",
  "perplexity",
  "gemini",
  "bard",
  "copilot",
  "claude",
  "anthropic",
  "you.com",
  "phind",
  "poe.com",
];
const isAiSource = (s: string) => AI_SOURCE_PATTERNS.some((p) => s.toLowerCase().includes(p));
// GA4 conversion-event buckets (first match wins).
const CONV_BUCKETS: Array<{ key: "phone" | "mail" | "maps" | "contact"; re: RegExp }> = [
  { key: "phone", re: /phone|call|tel|anruf/i },
  { key: "mail", re: /mail|email/i },
  { key: "maps", re: /map|route|direction|wegbeschreibung|standort/i },
  { key: "contact", re: /contact|kontakt|form|lead|submit|anfrage|offerte/i },
];
const CONV_BUCKET_LABEL: Record<string, string> = {
  phone: "Phone Click",
  mail: "Mail Click",
  maps: "Maps Click",
  contact: "Contact Form",
};
const CONV_PURCHASE_RE = /purchase|order|checkout|kauf|transaction/i;
const convBucketOf = (n: string) => CONV_BUCKETS.find((b) => b.re.test(n))?.key ?? null;

async function ranWithin(clientId: string, auditType: string, hours: number): Promise<boolean> {
  if (!hours || hours <= 0) return false;
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const { data } = await supabaseAdmin
    .from("audit_runs")
    .select("id")
    .eq("client_id", clientId)
    .eq("audit_type", auditType)
    .eq("status", "succeeded")
    .gte("created_at", since)
    .limit(1)
    .maybeSingle();
  return !!data;
}

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
    client_id: c.id,
    organization_id: c.organization_id,
    triggered_by: uid,
    audit_type: "pagespeed",
    status: "succeeded",
    input: { url: target, strategy: "mobile" },
    result: { metrics },
    started_at: nowIso(),
    finished_at: nowIso(),
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
    ahrefsCall(
      "site-explorer/refdomains-history",
      { target: domain, date_from: from, history_grouping: "weekly", mode: "subdomains" },
      key,
    ),
    ahrefsCall("site-explorer/metrics", { target: domain, date, mode: "subdomains" }, key),
  ]);
  const result = {
    generated_at: nowIso(),
    domain,
    domain_rating: dr.ok ? dr.data : null,
    backlinks_stats: bl.ok ? bl.data : null,
    refdomains_history: rd.ok ? rd.data : null,
    metrics: mt.ok ? mt.data : null,
    errors: {
      domain_rating: dr.ok ? null : dr.error,
      backlinks_stats: bl.ok ? null : bl.error,
      refdomains_history: rd.ok ? null : rd.error,
      metrics: mt.ok ? null : mt.error,
    },
  };
  await insertRun({
    client_id: c.id,
    organization_id: c.organization_id,
    triggered_by: uid,
    audit_type: "ahrefs",
    status: "succeeded",
    input: { domain },
    result,
    started_at: nowIso(),
    finished_at: nowIso(),
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
    body: JSON.stringify({
      startDate: fmt(start),
      endDate: fmt(end),
      dimensions: ["query"],
      rowLimit: 50,
      orderBy: [{ field: "clicks", descending: true }],
    }),
  });
  if (!r.ok)
    return { error: redactSecrets(`GSC HTTP ${r.status}: ${await r.text().catch(() => "")}`) };
  const json: any = await r.json();
  const keywords = (json.rows ?? []).map((x: any) => ({
    query: x.keys[0],
    clicks: x.clicks,
    impressions: x.impressions,
    ctr: x.ctr,
    position: x.position,
  }));
  const t = keywords.reduce(
    (a: any, k: any) => {
      a.clicks += k.clicks || 0;
      a.impressions += k.impressions || 0;
      a.posSum += (k.position || 0) * (k.impressions || 0);
      return a;
    },
    { clicks: 0, impressions: 0, posSum: 0 },
  );
  const result = {
    days,
    metrics: {
      clicks: t.clicks,
      impressions: t.impressions,
      ctr: t.impressions > 0 ? t.clicks / t.impressions : 0,
      position: t.impressions > 0 ? t.posSum / t.impressions : 0,
    },
    topQueries: keywords.slice(0, 25),
  };
  await insertRun({
    client_id: c.id,
    organization_id: c.organization_id,
    triggered_by: uid,
    audit_type: "gsc_summary",
    status: "succeeded",
    input: { days },
    result,
    started_at: nowIso(),
    finished_at: nowIso(),
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
    const r = await fetch(base, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(b),
    });
    if (!r.ok) throw new Error(`GA4 HTTP ${r.status}: ${await r.text().catch(() => "")}`);
    return (await r.json()) as any;
  };
  const CORE = [
    "sessions",
    "totalUsers",
    "newUsers",
    "engagedSessions",
    "screenPageViews",
    "bounceRate",
    "averageSessionDuration",
  ];
  const core = await call({ dateRanges, metrics: CORE.map((name) => ({ name })) });
  const cv = core.rows?.[0]?.metricValues ?? [];
  const metrics: Record<string, number> = {};
  CORE.forEach((n, i) => (metrics[n] = Number(cv[i]?.value ?? 0)));
  try {
    const opt = await call({
      dateRanges,
      metrics: [{ name: "conversions" }, { name: "totalRevenue" }],
    });
    const ov = opt.rows?.[0]?.metricValues ?? [];
    metrics.conversions = Number(ov[0]?.value ?? 0);
    metrics.totalRevenue = Number(ov[1]?.value ?? 0);
  } catch {
    metrics.conversions = 0;
    metrics.totalRevenue = 0;
  }
  let series: any[] = [];
  try {
    const tr = await call({
      dateRanges,
      dimensions: [{ name: "date" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "screenPageViews" }],
      orderBys: [{ dimension: { dimensionName: "date" } }],
    });
    series = (tr.rows ?? []).map((x: any) => ({
      date: x.dimensionValues?.[0]?.value ?? "",
      sessions: Number(x.metricValues?.[0]?.value ?? 0),
      totalUsers: Number(x.metricValues?.[1]?.value ?? 0),
      pageViews: Number(x.metricValues?.[2]?.value ?? 0),
    }));
  } catch {
    /* trend optional */
  }
  await insertRun({
    client_id: c.id,
    organization_id: c.organization_id,
    triggered_by: uid,
    audit_type: "ga4_summary",
    status: "succeeded",
    input: { days },
    result: { days, metrics, series },
    started_at: nowIso(),
    finished_at: nowIso(),
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
      country: String(c.country || "CH")
        .toUpperCase()
        .slice(0, 2),
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
  } catch {
    /* optional */
  }
  if (queries === 0) {
    try {
      const g = await fetch(`${proj}/queries/generate`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({ provider: "perplexity", count: 8 }),
      });
      const gj: any = await g.json().catch(() => ({}));
      const qs: string[] = gj?.queries || [];
      if (qs.length) {
        await fetch(`${proj}/queries`, {
          method: "POST",
          headers: H,
          body: JSON.stringify({ queries: qs }),
        });
        queries = qs.length;
      }
    } catch {
      /* optional */
    }
  }
  // 4. optional sweep (costs)
  let run: string | null = null;
  if (opts.runGeo) {
    // Sweep every configured public AI assistant Canonry knows about (dynamic, so
    // new providers are picked up automatically). "local"/llama is self-hosted and
    // not a visibility target, so it is excluded.
    let sweepProviders = ["openai", "perplexity", "gemini", "claude"];
    try {
      const sr = await fetch(`${root}/settings`, { headers: H });
      const sj: any = await sr.json().catch(() => ({}));
      const configured = (sj?.providers || [])
        .filter((p: any) => p?.configured && p?.name && p.name !== "local")
        .map((p: any) => String(p.name));
      if (configured.length) sweepProviders = configured;
    } catch {
      /* fall back to the static list */
    }
    try {
      const rr = await fetch(`${proj}/runs`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({
          trigger: "manual",
          providers: sweepProviders,
          noLocation: true,
        }),
      });
      const rj: any = await rr.json().catch(() => ({}));
      run = rj?.id || rj?.status || (rr.ok ? "queued" : `HTTP ${rr.status}`);
    } catch (e) {
      run = redactSecrets(e);
    }
  }
  return { slug, queries, run };
}

// GA4 traffic intelligence (channels, AI-referral, Google-vs-AI, top pages, countries).
async function jobGa4Traffic(c: any, uid: string, days: number) {
  if (!c.ga4_property) return { skipped: "kein ga4_property" };
  const { accessToken } = await getGoogleAccessToken(c.id);
  const propertyId = String(c.ga4_property).replace(/^properties\//, "");
  const base = `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`;
  const dateRanges = [{ startDate: `${days}daysAgo`, endDate: "today" }];
  const call = async (b: unknown) => {
    const r = await fetch(base, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(b),
    });
    if (!r.ok) throw new Error(`GA4 HTTP ${r.status}: ${await r.text().catch(() => "")}`);
    return (await r.json()) as any;
  };
  let channels: any[] = [];
  try {
    const ch = await call({
      dateRanges,
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    });
    channels = (ch.rows ?? []).map((r: any) => ({
      channel: r.dimensionValues?.[0]?.value ?? "(other)",
      sessions: Number(r.metricValues?.[0]?.value ?? 0),
    }));
  } catch {
    /* optional */
  }
  let aiBySource: any[] = [];
  try {
    const src = await call({
      dateRanges,
      dimensions: [{ name: "sessionSource" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 200,
    });
    aiBySource = (src.rows ?? [])
      .map((r: any) => ({
        source: r.dimensionValues?.[0]?.value ?? "",
        sessions: Number(r.metricValues?.[0]?.value ?? 0),
        users: Number(r.metricValues?.[1]?.value ?? 0),
      }))
      .filter((r: any) => isAiSource(r.source));
  } catch {
    /* optional */
  }
  const aiSessions = aiBySource.reduce((a, r) => a + r.sessions, 0);
  const aiUsers = aiBySource.reduce((a, r) => a + r.users, 0);
  let totalSessions = 0;
  try {
    const t = await call({ dateRanges, metrics: [{ name: "sessions" }] });
    totalSessions = Number(t.rows?.[0]?.metricValues?.[0]?.value ?? 0);
  } catch {
    /* optional */
  }
  const googleSessions = channels
    .filter((c2) => /organic|paid|search|google/i.test(c2.channel))
    .reduce((a, c2) => a + c2.sessions, 0);
  let aiSeries: any[] = [];
  try {
    const ds = await call({
      dateRanges,
      dimensions: [{ name: "date" }],
      metrics: [{ name: "sessions" }],
      dimensionFilter: {
        filter: {
          fieldName: "sessionSource",
          inListFilter: { values: AI_SOURCE_PATTERNS, caseSensitive: false },
        },
      },
      orderBys: [{ dimension: { dimensionName: "date" } }],
    });
    aiSeries = (ds.rows ?? []).map((r: any) => ({
      date: r.dimensionValues?.[0]?.value ?? "",
      aiSessions: Number(r.metricValues?.[0]?.value ?? 0),
    }));
  } catch {
    /* optional */
  }
  let topPages: any[] = [];
  try {
    const tp = await call({
      dateRanges,
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 15,
    });
    topPages = (tp.rows ?? []).map((r: any) => ({
      path: r.dimensionValues?.[0]?.value ?? "",
      views: Number(r.metricValues?.[0]?.value ?? 0),
    }));
  } catch {
    /* optional */
  }
  let countries: any[] = [];
  try {
    const co = await call({
      dateRanges,
      dimensions: [{ name: "country" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 10,
    });
    countries = (co.rows ?? []).map((r: any) => ({
      country: r.dimensionValues?.[0]?.value ?? "(unknown)",
      sessions: Number(r.metricValues?.[0]?.value ?? 0),
    }));
  } catch {
    /* optional */
  }
  const result = {
    days,
    channels,
    aiReferral: { sessions: aiSessions, users: aiUsers, bySource: aiBySource },
    googleVsAi: {
      google: googleSessions,
      ai: aiSessions,
      other: Math.max(0, totalSessions - googleSessions - aiSessions),
      total: totalSessions,
    },
    aiSeries,
    topPages,
    countries,
  };
  await insertRun({
    client_id: c.id,
    organization_id: c.organization_id,
    triggered_by: uid,
    audit_type: "ga4_traffic",
    status: "succeeded",
    input: { days },
    result,
    started_at: nowIso(),
    finished_at: nowIso(),
  });
  return { ai: aiSessions, channels: channels.length };
}

// GA4 conversion detail (event buckets + revenue + daily series).
async function jobGa4Conversions(c: any, uid: string, days: number) {
  if (!c.ga4_property) return { skipped: "kein ga4_property" };
  const { accessToken } = await getGoogleAccessToken(c.id);
  const propertyId = String(c.ga4_property).replace(/^properties\//, "");
  const base = `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`;
  const dateRanges = [{ startDate: `${days}daysAgo`, endDate: "today" }];
  const call = async (b: unknown) => {
    const r = await fetch(base, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(b),
    });
    if (!r.ok) throw new Error(`GA4 HTTP ${r.status}: ${await r.text().catch(() => "")}`);
    return (await r.json()) as any;
  };
  let events: any[] = [];
  const breakdown = { phone: 0, mail: 0, maps: 0, contact: 0 };
  try {
    const ev = await call({
      dateRanges,
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }],
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: 200,
    });
    events = (ev.rows ?? []).map((r: any) => ({
      eventName: r.dimensionValues?.[0]?.value ?? "",
      count: Number(r.metricValues?.[0]?.value ?? 0),
    }));
    for (const e of events) {
      const b = CONV_BUCKETS.find((x) => x.re.test(e.eventName));
      if (b) breakdown[b.key] += e.count;
    }
  } catch {
    /* optional */
  }
  let revenue = 0,
    purchases = 0;
  try {
    const rev = await call({
      dateRanges,
      metrics: [{ name: "totalRevenue" }, { name: "transactions" }],
    });
    const mv = rev.rows?.[0]?.metricValues ?? [];
    revenue = Number(mv[0]?.value ?? 0);
    purchases = Number(mv[1]?.value ?? 0);
  } catch {
    /* optional */
  }
  let series: any[] = [];
  try {
    const tr = await call({
      dateRanges,
      dimensions: [{ name: "date" }],
      metrics: [{ name: "conversions" }, { name: "totalRevenue" }],
      orderBys: [{ dimension: { dimensionName: "date" } }],
    });
    series = (tr.rows ?? []).map((r: any) => ({
      date: r.dimensionValues?.[0]?.value ?? "",
      conversions: Number(r.metricValues?.[0]?.value ?? 0),
      revenue: Number(r.metricValues?.[1]?.value ?? 0),
    }));
  } catch {
    /* optional */
  }
  // Detailed conversion listing (EzyRank-style rows). Filter to conversion event
  // NAMES so high-volume events (page_view, …) don't crowd out the rows.
  const convNames = events
    .map((e: any) => e.eventName)
    .filter((n: string) => convBucketOf(n) || CONV_PURCHASE_RE.test(n));
  let rows: any[] = [];
  if (convNames.length > 0) {
    try {
      const dr = await call({
        dateRanges,
        dimensions: [
          { name: "date" },
          { name: "eventName" },
          { name: "country" },
          { name: "sessionSource" },
          { name: "deviceCategory" },
        ],
        metrics: [{ name: "eventCount" }, { name: "eventValue" }],
        dimensionFilter: {
          filter: { fieldName: "eventName", inListFilter: { values: convNames } },
        },
        orderBys: [{ dimension: { dimensionName: "date" }, desc: true }],
        limit: 250,
      });
      rows = (dr.rows ?? []).map((r: any) => {
        const dv = r.dimensionValues ?? [];
        const mv = r.metricValues ?? [];
        const eventName = dv[1]?.value ?? "";
        const b = convBucketOf(eventName);
        return {
          date: dv[0]?.value ?? "",
          eventName,
          description: b ? CONV_BUCKET_LABEL[b] : eventName,
          country: dv[2]?.value ?? "",
          source: dv[3]?.value ?? "",
          device: dv[4]?.value ?? "",
          count: Number(mv[0]?.value ?? 0),
          value: Number(mv[1]?.value ?? 0),
        };
      });
    } catch {
      /* optional */
    }
  }
  const result = {
    days,
    breakdown,
    events: events.slice(0, 25),
    rows: rows.slice(0, 200),
    revenue,
    purchases,
    series,
  };
  await insertRun({
    client_id: c.id,
    organization_id: c.organization_id,
    triggered_by: uid,
    audit_type: "ga4_conversions",
    status: "succeeded",
    input: { days },
    result,
    started_at: nowIso(),
    finished_at: nowIso(),
  });
  return { revenue, leads: breakdown.phone + breakdown.mail + breakdown.maps + breakdown.contact };
}

// AI Visibility — pull Canonry analytics into a canonry_ai_visibility snapshot.
async function jobAiVisibility(c: any, uid: string) {
  const baseUrl = process.env.CANONRY_BASE_URL;
  const key = process.env.CANONRY_API_KEY;
  if (!baseUrl || !key) return { skipped: "Canonry not configured" };
  if (!c.canonry_project) return { skipped: "kein canonry_project" };
  const root = normalizeCanonryBase(baseUrl);
  const p = encodeURIComponent(c.canonry_project);
  const get = async (path: string) => {
    try {
      const r = await fetch(`${root}${path}`, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return { ok: false as const, status: r.status, error: `HTTP ${r.status}` };
      return { ok: true as const, data: await r.json().catch(() => null) };
    } catch (e) {
      return { ok: false as const, error: redactSecrets(e) };
    }
  };
  const [visibility, metrics, sources, contentSources, health, competitors] = await Promise.all([
    get(`/projects/${p}/citations/visibility`),
    get(`/projects/${p}/analytics/metrics?window=all`),
    get(`/projects/${p}/analytics/sources?window=all&limit=50`),
    get(`/projects/${p}/content/sources`),
    get(`/projects/${p}/health/latest`),
    get(`/projects/${p}/competitors`),
  ]);
  const allFailed =
    !visibility.ok && !metrics.ok && !sources.ok && !contentSources.ok && !health.ok;
  const result = {
    generated_at: nowIso(),
    project: c.canonry_project,
    domain: c.domain ?? null,
    visibility: visibility.ok ? visibility.data : null,
    metrics: metrics.ok ? metrics.data : null,
    sources: sources.ok ? sources.data : null,
    contentSources: contentSources.ok ? contentSources.data : null,
    health: health.ok ? health.data : null,
    competitors: competitors.ok ? competitors.data : null,
  };
  await insertRun({
    client_id: c.id,
    organization_id: c.organization_id,
    triggered_by: uid,
    audit_type: "canonry_ai_visibility",
    status: allFailed ? "failed" : "succeeded",
    input: { project: c.canonry_project },
    result,
    error: allFailed ? "All Canonry AI-visibility sections failed" : null,
    started_at: nowIso(),
    finished_at: nowIso(),
  });
  return { ok: !allFailed };
}

export const Route = createFileRoute("/api/admin/populate")({
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
        const {
          client: sel,
          all,
          jobs,
          days,
          runGeo,
          geoSlug,
          minIntervalHours,
          force,
        } = parsed.data;
        const wanted =
          jobs && jobs.length
            ? jobs
            : ([
                "ahrefs",
                "pagespeed",
                "gsc",
                "ga4",
                "ga4_traffic",
                "ga4_conversions",
                "ai_visibility",
              ] as const);

        const query = supabaseAdmin
          .from("clients")
          .select(
            "id, name, domain, organization_id, gsc_property, ga4_property, country, language, canonry_project",
          );
        let clients: any[] = [];
        if (all) clients = (await query).data || [];
        else if (sel && isUuid(sel)) clients = (await query.eq("id", sel)).data || [];
        else if (sel) clients = (await query.ilike("name", `%${sel}%`)).data || [];
        else
          return Response.json(
            { ok: false, error: "client oder all erforderlich" },
            { status: 400 },
          );
        if (!clients.length)
          return Response.json({ ok: false, error: "Kein Kunde gefunden" }, { status: 404 });

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
                if (!r.ok)
                  d.canonryProjectFetch.body = redactSecrets(
                    (await r.text().catch(() => "")).slice(0, 150),
                  );
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
              // Freshness guard: skip data jobs that ran recently (avoids double-spend
              // when more than one 12h trigger fires). geo is guarded by its own sweep.
              const at = JOB_AUDIT_TYPE[j];
              if (at && !force && (await ranWithin(c.id, at, minIntervalHours))) {
                jr[j] = { skipped: "fresh" };
                continue;
              }
              if (j === "ahrefs") jr.ahrefs = await jobAhrefs(c, uid);
              else if (j === "pagespeed") jr.pagespeed = await jobPagespeed(c, uid, days);
              else if (j === "gsc") jr.gsc = await jobGsc(c, uid, days);
              else if (j === "ga4") jr.ga4 = await jobGa4(c, uid, days);
              else if (j === "ga4_traffic") jr.ga4_traffic = await jobGa4Traffic(c, uid, days);
              else if (j === "ga4_conversions")
                jr.ga4_conversions = await jobGa4Conversions(c, uid, days);
              else if (j === "ai_visibility") jr.ai_visibility = await jobAiVisibility(c, uid);
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
