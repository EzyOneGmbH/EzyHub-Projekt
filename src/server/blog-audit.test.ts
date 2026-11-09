// Blog-Autopilot Phase 2: KI-Audit (Kap. 6.2, Tests aus Kap. 10) und
// Google-Zuordnung (nur Properties der eigenen Domain).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const db: Record<string, any[]> = {
  blog_projects: [],
  keyword_audits: [],
  keyword_opportunities: [],
  blog_analysis_runs: [],
  content_items: [],
  clients: [],
  ahrefs_cache: [],
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
    if (st.upsert) {
      db[table].push(st.upsert);
      return null;
    }
    let rows = (db[table] || []).filter((r) => st.filters.every((f: any) => f(r)));
    if (st.update) for (const r of rows) Object.assign(r, st.update);
    if (st.limit) rows = rows.slice(0, st.limit);
    return st.single ? (rows[0] ?? null) : rows;
  };
  const api: any = {
    select: () => api,
    order: () => api,
    or: () => api,
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
    upsert(row: any) {
      st.upsert = row;
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
vi.mock("@/server/google-tokens.server", () => ({
  getGoogleAccessToken: async () => ({ accessToken: "tok", connectionId: "c", email: null }),
}));
vi.mock("@/server/gsc.server", () => ({
  GSC_END_LAG_DAYS: 3,
  gscRows: async (b: any) =>
    b.dimensions.length === 2
      ? {
          rows: [
            {
              keys: ["trinkwasser afrika", "https://fih.ch/blog/wasser/"],
              impressions: 40,
              clicks: 1,
              position: 8,
            },
            {
              keys: ["trinkwasser afrika", "https://fih.ch/"],
              impressions: 10,
              clicks: 0,
              position: 13,
            },
            {
              keys: ["faith in humanity", "https://fih.ch/"],
              impressions: 300,
              clicks: 50,
              position: 1.2,
            },
            { keys: ["wasser spenden", "https://fih.ch/"], impressions: 5, clicks: 0, position: 9 },
            {
              keys: ["brunnen bauen", "https://fih.ch/"],
              impressions: 30,
              clicks: 2,
              position: 2.5,
            },
          ],
        }
      : { rows: [{ keys: ["trinkwasser afrika"], impressions: 20, clicks: 0, position: 12 }] },
}));

import {
  abgedecktVon,
  istMarke,
  kategorisiere,
  seedsAus,
  tickeKeywordAudits,
  verdichteGsc,
  verteileTermine,
  istMontagZuerich,
} from "@/server/blog-audit.server";
import { gscKandidaten, passtZuDomain } from "@/server/blog-google.server";

let ahrefsAufrufe: string[] = [];
let claudeAufrufe = 0;
function attrappe(input: any, init?: any): Promise<Response> {
  const u = new URL(String(input));
  if (u.host === "api.ahrefs.com") {
    ahrefsAufrufe.push(`${u.pathname}?${u.searchParams.get("keywords")}`);
    expect(u.searchParams.get("country")).toBe("ch");
    const kw = u.searchParams.get("keywords");
    const rows =
      kw === "brunnen"
        ? [
            { keyword: "solarbrunnen", volume: 250, difficulty: 3, parent_topic: "gartenbrunnen" },
            { keyword: "brunnen bauen", volume: 90, difficulty: 5, parent_topic: "brunnen bauen" },
          ]
        : [
            {
              keyword: "afrika spenden",
              volume: 150,
              difficulty: 12,
              parent_topic: "spenden afrika",
            },
            { keyword: "hilfswerk schweiz", volume: 5, difficulty: 2, parent_topic: null },
            { keyword: "wasserkiosk ghana", volume: 40, difficulty: null, parent_topic: null },
          ];
    return Promise.resolve(Response.json({ keywords: rows }));
  }
  if (u.host === "api.anthropic.com") {
    claudeAufrufe++;
    const body = JSON.parse(init.body);
    expect(body.messages[0].content).toContain("gartenbrunnen");
    return Promise.resolve(
      Response.json({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              pruefung: [
                {
                  keyword: "solarbrunnen",
                  passt: false,
                  grund: "Gartenprodukt, kein Hilfsprojekt",
                  cluster: null,
                  artikeltyp: null,
                },
                {
                  keyword: "wasserkiosk ghana",
                  passt: true,
                  grund: "",
                  cluster: "Trinkwasser",
                  artikeltyp: "erklaerung",
                },
                {
                  keyword: "afrika spenden",
                  passt: true,
                  grund: "",
                  cluster: "Spenden",
                  artikeltyp: "ratgeber",
                },
              ],
            }),
          },
        ],
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    );
  }
  return Promise.reject(new Error("unerwartet " + u.host));
}

const echt = globalThis.fetch;
beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "x";
  process.env.AHREFS_API_KEY = "y";
  vi.stubGlobal("fetch", attrappe);
});
afterAll(() => vi.stubGlobal("fetch", echt));

describe("KI-Audit: Regeln", () => {
  it("GSC verdichten: gewichtete Position, Hauptseite, Vorperiode", () => {
    const g = verdichteGsc(
      [
        { keys: ["a", "/x"], impressions: 30, clicks: 0, position: 10 },
        { keys: ["a", "/y"], impressions: 10, clicks: 0, position: 2 },
      ],
      new Map([["a", 12]]),
    );
    expect(g[0]).toMatchObject({
      query: "a",
      impressions: 40,
      position: 8,
      page: "/x",
      position_prev: 12,
    });
  });

  it("Marke erkennen, Abdeckung per Seite und per Keyword-Ähnlichkeit", () => {
    expect(istMarke("faith in humanity spenden", "Faith in Humanity", "faithinhumanity.ch")).toBe(
      true,
    );
    expect(istMarke("wasser spenden", "Faith in Humanity", "faithinhumanity.ch")).toBe(false);
    const artikel = [
      {
        url: "https://fih.ch/blog/spenden/",
        title: "Für Afrika spenden: so geht's",
        keywords: ["afrika spenden"],
      },
    ];
    expect(abgedecktVon("afrika spenden", artikel)).toBe("https://fih.ch/blog/spenden/");
    expect(abgedecktVon("x", artikel, "https://fih.ch/blog/spenden")).toBe(
      "https://fih.ch/blog/spenden/",
    );
    expect(abgedecktVon("solarbrunnen", artikel)).toBeNull();
  });

  it("fast vorne nur Position 4–20 mit genug Impressionen, ohne Marke", () => {
    const k = kategorisiere({
      gsc: [
        { query: "wasser filter", impressions: 50, clicks: 0, position: 6, page: null, position_prev: 9 },
        { query: "wasser pumpe", impressions: 5, clicks: 0, position: 6, page: null, position_prev: null },
        { query: "wasser tank", impressions: 50, clicks: 0, position: 2, page: null, position_prev: null },
        {
          query: "faith humanity",
          impressions: 500,
          clicks: 0,
          position: 5,
          page: null,
          position_prev: null,
        },
      ],
      ideen: [],
      artikel: [],
      minVolume: 10,
      minImpressions: 10,
      name: "Faith in Humanity",
      domain: "faithinhumanity.ch",
    });
    expect(k.map((x) => x.keyword)).toEqual(["wasser filter"]);
    expect(k[0].position_delta).toBe(3);
  });

  it("Termine: Werktage, nach Kontingent verteilt", () => {
    const t = verteileTermine(3, 4, new Date("2026-11-13T10:00:00Z")); // Freitag
    expect(t).toEqual(["2026-11-16", "2026-11-23", "2026-11-30"]);
    expect(
      seedsAus(
        [
          { name: "A", seeds: ["a1", "a2"] },
          { name: "B", seeds: ["b1"] },
        ],
        3,
      ).map((s) => s.seed),
    ).toEqual(["a1", "b1", "a2"]);
    expect(istMontagZuerich(new Date("2026-11-16T08:00:00Z"))).toBe(true);
    expect(istMontagZuerich(new Date("2026-11-15T23:30:00Z"))).toBe(true); // Mo 00:30 in Zürich (UTC+1)
  });
});

describe("KI-Audit: ganzer Lauf", () => {
  it("solarbrunnen → aussortiert, afrika spenden → abgedeckt, Units und Cache", async () => {
    const pid = crypto.randomUUID();
    db.clients.push({ id: "k1", gsc_property: "sc-domain:fih.ch" });
    db.blog_projects.push({
      id: pid,
      client_id: "k1",
      domain: "faithinhumanity.ch",
      name: "Faith in Humanity",
      description: "Trinkwasser für Afrika",
      market: "CH",
      min_volume: 10,
      min_impressions: 10,
      ahrefs_units_limit: 1000,
    });
    db.content_items.push({
      client_id: "k1",
      content_type: "blog",
      status: "published",
      target_url: "https://fih.ch/blog/spenden/",
      title: "Für Afrika spenden",
      primary_keyword: "afrika spenden",
      keywords: [],
    });
    db.blog_analysis_runs.push({
      project_id: pid,
      status: "done",
      result: { clusters: [{ name: "Trinkwasser", seeds: ["brunnen", "spenden afrika"] }] },
    });
    db.keyword_audits.push({
      id: "a1",
      project_id: pid,
      status: "queued",
      stage: "sammeln",
      state: {},
      events: [],
      attempts: 0,
      trigger: "onboarding",
    });

    for (let i = 0; i < 4; i++) await tickeKeywordAudits(200_000);
    const a = db.keyword_audits[0];
    expect(a.status).toBe("done");
    expect(a.events.map((e: any) => e.key)).toEqual(["sammeln", "ahrefs", "bewerten", "fertig"]);
    const o = new Map(db.keyword_opportunities.map((x) => [x.keyword, x]));
    expect(o.get("solarbrunnen").category).toBe("aussortiert");
    expect(o.get("solarbrunnen").reason).toMatch(/Gartenprodukt/);
    expect(o.get("afrika spenden").category).toBe("abgedeckt");
    expect(o.get("afrika spenden").covered_by_url).toBe("https://fih.ch/blog/spenden/");
    expect(o.get("wasserkiosk ghana").category).toBe("neu");
    expect(o.get("wasserkiosk ghana").cluster).toBe("Trinkwasser");
    expect(o.get("trinkwasser afrika").category).toBe("fast_vorne");
    expect(o.has("hilfswerk schweiz")).toBe(false); // unter Mindestvolumen
    expect(o.has("brunnen bauen")).toBe(false); // rankt schon top 3
    expect(o.has("faith in humanity")).toBe(false); // Marke
    expect(a.sources).toMatchObject({
      gsc_status: "ok",
      published_articles: 1,
      intent_checked: true,
    });
    expect(a.sources.ahrefs_units).toBe(5 * 22);
    expect(claudeAufrufe).toBe(1);

    // zweiter Audit: Ahrefs aus dem Cache, keine Units
    const vorher = ahrefsAufrufe.length;
    db.keyword_audits.push({
      id: "a2",
      project_id: pid,
      status: "queued",
      stage: "sammeln",
      state: {},
      events: [],
      attempts: 0,
    });
    // Cache-Stub: upsert legt Zeilen ab, die der nächste Lauf findet
    for (const c of db.ahrefs_cache) c.fetched_at = new Date().toISOString();
    for (let i = 0; i < 4; i++) await tickeKeywordAudits(200_000);
    expect(ahrefsAufrufe.length).toBe(vorher);
    expect(db.keyword_audits[1].sources.ahrefs_units).toBe(0);
  });
});

describe("Google-Zuordnung: nur eigene Domain", () => {
  it("fremde Properties tauchen nie auf", () => {
    expect(passtZuDomain("sc-domain:faithinhumanity.ch", "faithinhumanity.ch")).toBe(true);
    expect(passtZuDomain("https://www.faithinhumanity.ch/", "faithinhumanity.ch")).toBe(true);
    expect(passtZuDomain("https://shop.faithinhumanity.ch/", "faithinhumanity.ch")).toBe(true);
    expect(passtZuDomain("https://hotel-ava.ch/", "faithinhumanity.ch")).toBe(false);
    expect(passtZuDomain("https://faithinhumanity.ch.evil.com/", "faithinhumanity.ch")).toBe(false);
    expect(
      gscKandidaten(
        [
          { url: "https://hotel-ava.ch/" },
          { url: "https://faithinhumanity.ch/" },
          { url: "sc-domain:faithinhumanity.ch" },
          { url: "http://faithinhumanity.ch/", permission: "siteUnverifiedUser" },
        ],
        "faithinhumanity.ch",
      ),
    ).toEqual(["sc-domain:faithinhumanity.ch", "https://faithinhumanity.ch/"]);
  });
});
