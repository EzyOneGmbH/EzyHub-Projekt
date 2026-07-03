import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "@/server/google-tokens.server";
import { redactSecrets } from "@/server/google-oauth.server";

// AI-Visibility-Ingestion, Stufe 1 (Makro-Layer + Attribution). Befüllt die
// ai_visibility_*-Tabellen server-seitig (service_role; n8n kommt nicht an die
// Lovable-DB — gleiche Architektur wie admin.content-sync):
//   brand_radar : Ahrefs Brand Radar — Mentions je Modell (+ je Land, nur für
//                 Modelle mit Mentions > 0, spart API-Units) -> models +
//                 model_country; Citations/Cited Pages der eigenen Domain ->
//                 report + sources
//   attribution : GA4 AI-Referral-Sessions/Conversions je Engine -> attribution
//   report      : Upsert je (client_id, snapshot_date=heute) mit Deltas vs.
//                 letztem Snapshot; Score = dokumentierte Heuristik (TUNE)
// Stufe 2 (separat): Custom-Prompt-Runner -> prompts/topics.
// Secret-gated (ADMIN_AUTOMATION_SECRET). Freshness-Guard: skip, wenn ein
// Report der letzten `minIntervalDays` existiert (Brand Radar kostet Units).

const Body = z.object({
  client: z.string().optional(), // Name (ilike) oder uuid
  all: z.boolean().optional(),
  jobs: z.array(z.enum(["brand_radar", "attribution"])).optional(),
  minIntervalDays: z.number().int().min(0).max(60).default(6),
  force: z.boolean().optional(),
});

const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ""));
const today = () => new Date().toISOString().slice(0, 10);
const cleanDomain = (d: string) =>
  String(d || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");

// Spec §9: die 6 Makro-Datenquellen des Ahrefs Brand Radar (+ Anzeigename).
const SOURCES: Array<{ ds: string; name: string }> = [
  { ds: "chatgpt", name: "ChatGPT" },
  { ds: "google_ai_overviews", name: "Google AI Overviews" },
  { ds: "google_ai_mode", name: "Google AI Mode" },
  { ds: "gemini", name: "Gemini" },
  { ds: "perplexity", name: "Perplexity" },
  { ds: "copilot", name: "Copilot" },
];
// Länder-Splits (ISO alpha-2 -> Anzeigename im Dashboard).
const COUNTRIES: Array<{ code: string; name: string }> = [
  { code: "ch", name: "Schweiz" },
  { code: "de", name: "Deutschland" },
  { code: "at", name: "Österreich" },
  { code: "it", name: "Italien" },
];

// GA4 sessionSource -> Engine-Label (erste Übereinstimmung gewinnt).
const ENGINES: Array<{ name: string; re: RegExp }> = [
  { name: "ChatGPT", re: /chatgpt|openai/i },
  { name: "Perplexity", re: /perplexity/i },
  { name: "Gemini", re: /gemini|bard/i },
  { name: "Claude", re: /claude|anthropic/i },
  { name: "Copilot", re: /copilot|bing/i },
  { name: "Grok", re: /grok|x\.ai/i },
  { name: "DeepSeek", re: /deepseek/i },
];

// Ahrefs v3 Brand Radar (live validiert): Pfade OHNE "-entities"-Suffix;
// Arrays als CSV, `brand` als Plain-Name, nur `where` als JSON-String.
async function brandRadar(path: string, params: Record<string, unknown>, key: string) {
  const u = new URL(`https://api.ahrefs.com/v3/brand-radar/${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) u.searchParams.set(k, v.join(","));
    else if (typeof v === "object" && v !== null) u.searchParams.set(k, JSON.stringify(v));
    else u.searchParams.set(k, String(v));
  }
  const r = await fetch(u, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) {
    const body = (await r.text().catch(() => "")).slice(0, 160);
    return { ok: false as const, error: `HTTP ${r.status}: ${body}` };
  }
  return { ok: true as const, data: (await r.json().catch(() => null)) as any };
}

// REST-Form nimmt den Brand als Plain-Namen (die entities-Struktur ist MCP-only).
function brandName(c: any) {
  return String(c.name || "").trim() || cleanDomain(c.domain).split(".")[0];
}

// ── Ahrefs Brand Radar: Mentions je Modell (+ Land) + Citations ─────────────
async function jobBrandRadar(c: any) {
  const key = process.env.AHREFS_API_KEY;
  if (!key) return { skipped: "AHREFS_API_KEY fehlt" };
  if (!c.name && !c.domain) return { skipped: "kein Name/Domain" };
  const brand = brandName(c);
  const errors: string[] = [];

  // 1) Total je Modell (1 Call pro data_source).
  const models: Array<{ name: string; mentions: number; byCountry: Record<string, number> }> = [];
  for (const s of SOURCES) {
    const r = await brandRadar("mentions-overview", {
      select: "brand,total",
      data_source: s.ds,
      brand,
    }, key);
    if (!r.ok) { errors.push(`${s.name}: ${r.error}`); models.push({ name: s.name, mentions: 0, byCountry: {} }); continue; }
    const total = Number(r.data?.metrics?.[0]?.total ?? 0);
    models.push({ name: s.name, mentions: total, byCountry: {} });
  }

  // 2) Länder-Split NUR für Modelle mit Mentions > 0 (spart Units).
  for (const m of models) {
    if (m.mentions <= 0) continue;
    const ds = SOURCES.find((s) => s.name === m.name)!.ds;
    for (const co of COUNTRIES) {
      const r = await brandRadar("mentions-overview", {
        select: "brand,total",
        data_source: ds,
        country: co.code,
        brand,
      }, key);
      const v = r.ok ? Number(r.data?.metrics?.[0]?.total ?? 0) : 0;
      if (v > 0) m.byCountry[co.name] = v;
    }
    // Rest, der keinem der Split-Länder zuzuordnen ist -> "International".
    const split = Object.values(m.byCountry).reduce((a, b) => a + b, 0);
    if (m.mentions - split > 0) m.byCountry["International"] = m.mentions - split;
  }

  // 3) Citations + referenzierte Seiten der eigenen Domain (1 Call).
  let citations = 0;
  let citedPages: Array<{ url: string; responses: number }> = [];
  const domain = cleanDomain(c.domain);
  if (domain) {
    const r = await brandRadar("cited-pages", {
      select: "url,responses",
      data_source: SOURCES.map((s) => s.ds),
      where: { field: "cited_domain_subdomains", is: ["eq", domain] },
      brand,
      limit: 200,
    }, key);
    if (r.ok) {
      citedPages = (r.data?.pages ?? []).map((p: any) => ({
        url: String(p.url ?? ""),
        responses: Number(p.responses ?? 0),
      }));
      citations = citedPages.reduce((a, p) => a + p.responses, 0);
    } else errors.push(`cited-pages: ${r.error}`);
  }

  const mentions = models.reduce((a, m) => a + m.mentions, 0);
  return { models, mentions, citations, citedPagesCount: citedPages.length, citedPages, errors };
}

// ── GA4: AI-Referral-Sessions -> Conversions je Engine ──────────────────────
async function jobAttribution(c: any) {
  if (!c.ga4_property) return { skipped: "kein ga4_property" };
  let token: string;
  try {
    token = (await getGoogleAccessToken(c.id)).accessToken;
  } catch (e) {
    return { error: "Google-Token: " + redactSecrets(e) };
  }
  const propertyId = String(c.ga4_property).replace(/^properties\//, "");
  const r = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
        dimensions: [{ name: "sessionSource" }],
        metrics: [{ name: "sessions" }, { name: "keyEvents" }],
        limit: 250,
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!r.ok) return { error: `GA4 HTTP ${r.status}` };
  const json: any = await r.json().catch(() => ({}));
  const agg: Record<string, { sessions: number; conversions: number }> = {};
  for (const row of json.rows ?? []) {
    const src = String(row.dimensionValues?.[0]?.value ?? "");
    const eng = ENGINES.find((e) => e.re.test(src));
    if (!eng) continue;
    agg[eng.name] ??= { sessions: 0, conversions: 0 };
    agg[eng.name].sessions += Number(row.metricValues?.[0]?.value ?? 0);
    agg[eng.name].conversions += Number(row.metricValues?.[1]?.value ?? 0);
  }
  return {
    engines: Object.entries(agg).map(([engine, v]) => ({ engine, ...v })),
  };
}

export const Route = createFileRoute("/api/admin/aivis-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret)
          return Response.json({ ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" }, { status: 503 });
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });
        const { client: sel, all, jobs, minIntervalDays, force } = parsed.data;
        const wanted = jobs && jobs.length ? jobs : (["brand_radar", "attribution"] as const);

        const query = supabaseAdmin
          .from("clients")
          .select("id, name, domain, organization_id, ga4_property, country");
        let clients: any[] = [];
        if (all) clients = (await query).data || [];
        else if (sel && isUuid(sel)) clients = (await query.eq("id", sel)).data || [];
        else if (sel) clients = (await query.ilike("name", `%${sel}%`)).data || [];
        else return Response.json({ ok: false, error: "client oder all erforderlich" }, { status: 400 });
        if (!clients.length)
          return Response.json({ ok: false, error: "Kein Kunde gefunden" }, { status: 404 });

        const sb = supabaseAdmin as any;
        const snapshot = today();
        const results: any[] = [];
        for (const c of clients) {
          const jr: Record<string, unknown> = {};
          try {
            // Freshness-Guard (Brand Radar kostet Units).
            if (!force && minIntervalDays > 0) {
              const since = new Date(Date.now() - minIntervalDays * 86400_000).toISOString().slice(0, 10);
              const { data: recent } = await sb
                .from("ai_visibility_reports")
                .select("id")
                .eq("client_id", c.id)
                .gte("snapshot_date", since)
                .limit(1)
                .maybeSingle();
              if (recent) {
                results.push({ client: c.name, skipped: "fresh" });
                continue;
              }
            }

            const br: any = wanted.includes("brand_radar") ? await jobBrandRadar(c) : null;
            const at: any = wanted.includes("attribution") ? await jobAttribution(c) : null;
            jr.brand_radar = br ? (br.skipped ? { skipped: br.skipped } : { mentions: br.mentions, citations: br.citations, pages: br.citedPagesCount, errors: br.errors?.length || 0 }) : "skipped";
            jr.attribution = at ? (at.skipped || at.error ? at : { engines: at.engines.length }) : "skipped";

            if (br && !br.skipped) {
              // Deltas vs. letztem Snapshot.
              const { data: prev } = await sb
                .from("ai_visibility_reports")
                .select("mentions, citations, cited_pages, score")
                .eq("client_id", c.id)
                .lt("snapshot_date", snapshot)
                .order("snapshot_date", { ascending: false })
                .limit(1)
                .maybeSingle();
              // Score-Heuristik Stufe 1 (TUNE): logarithmisch gedämpfte Summe aus
              // Mentions/Citations/Seiten — 0 Daten -> 0; ~30 Mentions+15 Cit. -> ~60.
              const score = Math.min(
                100,
                Math.round(
                  28 * Math.log10(1 + br.mentions) +
                  22 * Math.log10(1 + br.citations) +
                  14 * Math.log10(1 + br.citedPagesCount),
                ),
              );
              const { data: rep, error: repErr } = await sb
                .from("ai_visibility_reports")
                .upsert(
                  {
                    client_id: c.id,
                    market: c.country || null,
                    snapshot_date: snapshot,
                    score,
                    score_delta: score - Number(prev?.score ?? 0),
                    mentions: br.mentions,
                    mentions_delta: br.mentions - Number(prev?.mentions ?? 0),
                    citations: br.citations,
                    citations_delta: br.citations - Number(prev?.citations ?? 0),
                    cited_pages: br.citedPagesCount,
                    cited_pages_delta: br.citedPagesCount - Number(prev?.cited_pages ?? 0),
                  },
                  { onConflict: "client_id,snapshot_date" },
                )
                .select("id")
                .single();
              if (repErr) throw new Error(repErr.message);
              const reportId = rep.id;

              // Kind-Tabellen idempotent: alte Zeilen des Reports ersetzen.
              await sb.from("ai_visibility_models").delete().eq("report_id", reportId);
              await sb.from("ai_visibility_sources").delete().eq("report_id", reportId);
              await sb.from("ai_visibility_attribution").delete().eq("report_id", reportId);

              const totalMentions = Math.max(1, br.mentions);
              const { data: modelRows, error: mErr } = await sb
                .from("ai_visibility_models")
                .insert(
                  br.models.map((m: any) => ({
                    report_id: reportId,
                    client_id: c.id,
                    model_name: m.name,
                    layer: "macro",
                    mentions: m.mentions,
                    sov: Math.round((m.mentions / totalMentions) * 100),
                  })),
                )
                .select("id, model_name");
              if (mErr) throw new Error(mErr.message);
              const mcInserts: any[] = [];
              for (const m of br.models) {
                const row = (modelRows || []).find((x: any) => x.model_name === m.name);
                if (!row) continue;
                for (const [country, mentions] of Object.entries(m.byCountry)) {
                  mcInserts.push({ model_id: row.id, client_id: c.id, country, mentions });
                }
              }
              if (mcInserts.length) await sb.from("ai_visibility_model_country").insert(mcInserts);

              if (br.citedPages?.length) {
                const domain = cleanDomain(c.domain);
                await sb.from("ai_visibility_sources").insert({
                  report_id: reportId,
                  client_id: c.id,
                  domain,
                  mentions: br.citations,
                  share: 100,
                  urls: br.citedPagesCount,
                  traffic: 0,
                });
              }
              if (at?.engines?.length) {
                await sb.from("ai_visibility_attribution").insert(
                  at.engines.map((e: any) => ({
                    report_id: reportId,
                    client_id: c.id,
                    engine: e.engine,
                    sessions: e.sessions,
                    conversions: e.conversions,
                  })),
                );
              }
              jr.report = { id: reportId, score, snapshot };
            }
          } catch (e) {
            jr.error = redactSecrets(e);
          }
          results.push({ client: c.name, domain: c.domain, jobs: jr });
        }
        return Response.json({ ok: true, count: clients.length, snapshot, results });
      },
    },
  },
});
