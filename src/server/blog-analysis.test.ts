// Blog-Autopilot Phase 2: Website-Analyse. Reine Helfer und ein ganzer Lauf
// durch alle Phasen gegen eine Website- und Claude-Attrappe (In-Memory-DB).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const db: Record<string, any[]> = {
  blog_projects: [],
  blog_analysis_runs: [],
  blog_competitors: [],
  blog_events: [],
};

function builder(table: string) {
  const st: any = { filters: [] as ((r: any) => boolean)[], limit: 0, single: false };
  const run = () => {
    if (st.insert) {
      const neu = st.insert.map((r: any) => ({
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        ...r,
      }));
      db[table].push(...neu);
      return st.single ? neu[0] : neu;
    }
    let rows = (db[table] || []).filter((r) => st.filters.every((f: any) => f(r)));
    if (st.update) for (const r of rows) Object.assign(r, st.update);
    if (st.limit) rows = rows.slice(0, st.limit);
    return st.single ? (rows[0] ?? null) : rows;
  };
  const api: any = {
    select: () => api,
    order: () => api,
    or: () => api, // Lock-Filter: im Test immer frei
    eq(k: string, v: any) {
      st.filters.push((r: any) => r[k] === v);
      return api;
    },
    in(k: string, arr: any[]) {
      st.filters.push((r: any) => arr.includes(r[k]));
      return api;
    },
    limit(n: number) {
      st.limit = n;
      return api;
    },
    maybeSingle() {
      st.single = true;
      return api;
    },
    single() {
      st.single = true;
      return api;
    },
    update(p: any) {
      st.update = p;
      return api;
    },
    insert(row: any) {
      st.insert = Array.isArray(row) ? row : [row];
      return api;
    },
    then(resolve: any) {
      resolve({ data: run(), error: null });
    },
  };
  return api;
}
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => builder(t), rpc: async () => ({}) },
}));

import {
  bereinigeMitbewerber,
  ctaKandidaten,
  htmlZuText,
  jsonAusText,
  metaAus,
  pruefeProfil,
  sitemapLocs,
  tickeBlogAnalysen,
  waehleSeiten,
} from "@/server/blog-analysis.server";

// ── Attrappe: Website + Claude ─────────────────────────────────────────────
const SEITE = (titel: string, body: string) =>
  `<!doctype html><html lang="de-CH"><head><title>${titel}</title>
<meta name="description" content="Hilfe f&uuml;r Afrika"></head><body><h1>${titel}</h1>
<script>var x=1</script><p>${body}</p>
<a href="/spenden/">Jetzt spenden</a> <a href="https://raisenow.example/donate">Spenden</a>
<a href="/projekte/">Projekte</a></body></html>`;

let claudeAufrufe: any[] = [];
let offline = false;
const PROFIL = {
  name: "Faith in Humanity",
  description: "Gemeinnütziger Verein aus St. Gallen für sauberes Trinkwasser in Afrika.",
  audiences: ["Spenderinnen und Spender in der Schweiz", "Kirchgemeinden"],
  market: "ch",
  language: "de-CH",
  local_business: false,
  tone: "gespraechig",
  tone_reason: "Die Website spricht Leser direkt an.",
  rules: ["Immer du-Form", "Keine Mitleidsbilder"],
  clusters: [{ name: "Trinkwasser", seeds: ["Brunnen Afrika", "sauberes Wasser"] }],
  cta: { label: "Jetzt spenden", url: "https://faithinhumanity.ch/spenden/", text: "Hilf mit." },
  image_style: "dokumentarisch",
  competitor_hints: [],
};

function attrappe(input: any, init?: any): Promise<Response> {
  const u = new URL(String(input));
  if (u.host === "api.anthropic.com") {
    const body = JSON.parse(init.body);
    claudeAufrufe.push(body);
    const json = body.tools
      ? {
          bestaetigt: [
            { domain: "https://www.wasser-hilfe.ch/", grund: "Gleiches Angebot" },
            { domain: "tot.ch", grund: "x" },
            { domain: "faithinhumanity.ch", grund: "eigene" },
          ],
          unbestaetigt: [{ domain: "vielleicht.ch", grund: "unsicher" }],
        }
      : PROFIL;
    return Promise.resolve(
      Response.json({
        content: [{ type: "text", text: "Hier: " + JSON.stringify(json) }],
        usage: { input_tokens: 1000, output_tokens: 200 },
      }),
    );
  }
  if (offline || u.host === "tot.ch") return Promise.reject(new Error("ECONNREFUSED"));
  const html = (t: string) =>
    new Response(SEITE(t, `Inhalt ${t}`), { headers: { "content-type": "text/html" } });
  if (u.pathname === "/robots.txt")
    return Promise.resolve(new Response(`Sitemap: https://${u.host}/sitemap_index.xml`));
  if (u.pathname === "/sitemap_index.xml")
    return Promise.resolve(
      new Response(
        `<sitemapindex><sitemap><loc>https://${u.host}/post-sitemap.xml</loc></sitemap><sitemap><loc>https://${u.host}/page-sitemap.xml</loc></sitemap></sitemapindex>`,
      ),
    );
  if (u.pathname.endsWith("-sitemap.xml"))
    return Promise.resolve(
      new Response(
        `<urlset><url><loc>https://${u.host}/ueber-uns/</loc></url><url><loc>https://${u.host}/tag/x/</loc></url><url><loc>https://${u.host}/bild.jpg</loc></url></urlset>`,
      ),
    );
  return Promise.resolve(html(u.pathname === "/" ? "Startseite" : u.pathname));
}

const echt = globalThis.fetch;
beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test";
  vi.stubGlobal("fetch", attrappe);
});
afterAll(() => vi.stubGlobal("fetch", echt));

describe("Website-Analyse: reine Helfer", () => {
  it("htmlZuText entfernt Skripte und dekodiert Entitäten", () => {
    const t = htmlZuText(
      "<p>Gr&uuml;sse</p><script>alert(1)</script><p>&laquo;Hallo&raquo;&#8211;Welt</p>",
    );
    expect(t).toBe("Grüsse\n«Hallo»–Welt");
    expect(metaAus(SEITE("T", "x")).lang).toBe("de-CH");
  });

  it("Sitemap-Index erkennen, Seiten wählen ohne Medien/Tags/fremde Hosts", () => {
    expect(sitemapLocs("<sitemapindex><loc>a</loc></sitemapindex>").index).toBe(true);
    const w = waehleSeiten(
      [
        "https://www.fih.ch/ueber-uns/",
        "https://fih.ch/",
        "https://fih.ch/tag/x/",
        "https://fih.ch/a/b/c/d/",
        "https://fremd.ch/ueber-uns/",
        "https://fih.ch/bild.jpg",
        "https://fih.ch/kontakt?x=1",
      ],
      "fih.ch",
      5,
    );
    expect(w).toEqual(["https://www.fih.ch/ueber-uns/", "https://fih.ch/a/b/c/d/"]);
  });

  it("CTA nur aus verlinkten https-Zielen; KI-Profil tolerant", () => {
    const links = ctaKandidaten(SEITE("x", ""), "https://fih.ch/");
    expect(links.map((l) => l.url)).toContain("https://fih.ch/spenden/");
    const p = pruefeProfil(
      {
        ...PROFIL,
        cta: { label: "x", url: "https://erfunden.ch", text: "" },
        tone: "laut",
        market: "zz9",
      },
      links,
    );
    expect(p.cta).toBeNull();
    expect(p.tone).toBe("informativ");
    expect(p.market).toBe("CH");
    expect(() => jsonAusText("kein json")).toThrow();
  });

  it("Mitbewerber: normalisiert, eigene Domain und Duplikate raus", () => {
    const m = bereinigeMitbewerber(
      {
        bestaetigt: [
          { domain: "https://www.a.ch/x", grund: "" },
          { domain: "a.ch", grund: "" },
          { domain: "fih.ch", grund: "" },
        ],
        unbestaetigt: [
          { domain: "a.ch", grund: "" },
          { domain: "b.ch", grund: "" },
        ],
      },
      "fih.ch",
    );
    expect(m.bestaetigt.map((c) => c.domain)).toEqual(["a.ch"]);
    expect(m.unbestaetigt.map((c) => c.domain)).toEqual(["b.ch"]);
  });
});

describe("Website-Analyse: ganzer Lauf im Worker", () => {
  it("vier Phasen → Ergebnis, Agent-Log mit 8 Stufen, KI-Mitbewerber gespeichert", async () => {
    const pid = crypto.randomUUID();
    db.blog_projects.push({ id: pid, domain: "faithinhumanity.ch" });
    db.blog_competitors.push({ project_id: pid, domain: "vielleicht.ch", source: "manuell" });
    db.blog_analysis_runs.push({
      id: "run-1",
      project_id: pid,
      status: "queued",
      stage: "lesen",
      state: {},
      events: [],
      attempts: 0,
      created_at: new Date().toISOString(),
    });
    for (let i = 0; i < 4; i++) await tickeBlogAnalysen(200_000);
    const run = db.blog_analysis_runs[0];
    expect(run.status).toBe("done");
    expect(run.percent).toBe(100);
    expect(run.events.map((e: any) => e.key)).toEqual([
      "lesen",
      "angebot",
      "zielgruppen",
      "mitbewerber_suchen",
      "mitbewerber_pruefen",
      "tonalitaet",
      "cluster",
      "fertig",
    ]);
    expect(run.result.name).toBe("Faith in Humanity");
    expect(run.result.market).toBe("CH");
    expect(run.result.cta.url).toBe("https://faithinhumanity.ch/spenden/");
    expect(run.result.pages_read).toBeGreaterThanOrEqual(2);
    expect(run.result.competitors.bestaetigt.map((c: any) => c.domain)).toEqual([
      "wasser-hilfe.ch",
    ]);
    expect(run.result.competitors.unbestaetigt.map((c: any) => c.domain)).toEqual([
      "tot.ch",
      "vielleicht.ch",
    ]);
    // manuell vorhandener Mitbewerber bleibt, KI-Kandidaten kommen dazu
    const comps = db.blog_competitors.filter((c) => c.project_id === pid);
    expect(comps.map((c) => `${c.domain}:${c.source}:${c.validated ?? ""}`).sort()).toEqual([
      "tot.ch:ki:false",
      "vielleicht.ch:manuell:",
      "wasser-hilfe.ch:ki:true",
    ]);
    // Profil ohne Websuche, Mitbewerber mit Websuche; Prompt enthält gelesene Seiten
    expect(claudeAufrufe).toHaveLength(2);
    expect(claudeAufrufe[0].tools).toBeUndefined();
    expect(claudeAufrufe[0].messages[0].content).toContain("ueber-uns");
    expect(claudeAufrufe[1].tools[0].name).toBe("web_search");
    expect(db.blog_events.some((e) => e.type === "analysis.done")).toBe(true);
  });

  it("Website nicht erreichbar → nach 3 Versuchen failed mit Grund", async () => {
    offline = true;
    const pid = crypto.randomUUID();
    db.blog_projects.push({ id: pid, domain: "offline.ch" });
    db.blog_analysis_runs.push({
      id: "run-2",
      project_id: pid,
      status: "queued",
      stage: "lesen",
      state: {},
      events: [],
      attempts: 0,
      created_at: new Date().toISOString(),
    });
    for (let i = 0; i < 3; i++) await tickeBlogAnalysen(200_000);
    offline = false;
    const run = db.blog_analysis_runs.find((r) => r.id === "run-2");
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/nicht erreichbar/);
    expect(db.blog_events.some((e) => e.type === "onboarding.analysis_failed")).toBe(true);
  });
});
