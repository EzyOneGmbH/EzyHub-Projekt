// Read-API v1 (ChatGPT, read-only) — 28.09.2026.
// Echte Route-Handler mit In-Memory-Supabase (Muster: kpi-first-party /
// multi-org Integrationstest); authenticateReadApi/logReadApi gemockt.
//  - 401 ohne Token, CORS/Request-Id/no-store auf jeder Antwort, OPTIONS 204, 405
//  - Mandantentrennung: fremdes Projekt → 404, globale Changes nur eigene Org
//  - Pagination/next_offset, Validierung (Zeitraum, limit)
//  - /projects ohne sensible Felder, unavailable_fields, not_connected
//  - OpenAPI-Grundstruktur (3.1.0, 7 Datenpfade, eindeutige operationIds)
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { addDays, heuteYmd } from "../lib/date-range";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const KUNDE_A = "11111111-1111-4111-8111-111111111111";
const KUNDE_A2 = "33333333-3333-4333-8333-333333333333";
const KUNDE_B = "22222222-2222-4222-8222-222222222222";

const heute = heuteYmd();
const gestern = addDays(heute, -1);
const vorgestern = addDays(heute, -2);

// Tokens: "tok-a" → ORG_A, "tok-b" → ORG_B, alles andere 401.
const TOKENS: Record<string, string> = { "tok-a": ORG_A, "tok-b": ORG_B };

const db: Record<string, any[]> = {
  clients: [
    {
      id: KUNDE_A,
      organization_id: ORG_A,
      name: "Alpha Hotel",
      domain: "alpha.ch",
      country: "CH",
      language: "de",
      gsc_property: "sc-domain:alpha.ch",
      metadata: { first_party_kpi: true, wp_password: "geheim", google_refresh_token: "rt" },
    },
    {
      id: KUNDE_A2,
      organization_id: ORG_A,
      name: "Beta Shop",
      domain: "beta.ch",
      country: "CH",
      language: "de",
      metadata: { status: "paused" },
    },
    {
      id: KUNDE_B,
      organization_id: ORG_B,
      name: "Fremd AG",
      domain: "fremd.ch",
      country: "DE",
      language: "de",
      metadata: { first_party_kpi: true },
    },
  ],
  rank_daily: [
    ...["kw eins", "kw zwei", "kw drei"].flatMap((kw, i) => [
      {
        client_id: KUNDE_A,
        organization_id: ORG_A,
        date: vorgestern,
        keyword: kw,
        position: 3 + i,
        pos_src: "crawl",
        url: "https://alpha.ch/",
        search_volume: 100,
        is_money: i === 0,
        device: "desktop",
        country: "CH",
      },
      {
        client_id: KUNDE_A,
        organization_id: ORG_A,
        date: gestern,
        keyword: kw,
        position: i === 2 ? null : 5 + i,
        pos_src: "crawl",
        url: "https://alpha.ch/",
        search_volume: 100,
        is_money: i === 0,
        device: "desktop",
        country: "CH",
      },
    ]),
    {
      client_id: KUNDE_B,
      organization_id: ORG_B,
      date: gestern,
      keyword: "fremd kw",
      position: 1,
      pos_src: "crawl",
      device: "desktop",
      country: "DE",
    },
  ],
  gsc_daily: [
    {
      client_id: KUNDE_A,
      date: vorgestern,
      query: "hotel",
      page: "/a",
      clicks: 10,
      impressions: 100,
      ctr: 0.1,
      position: 2,
    },
    {
      client_id: KUNDE_A,
      date: gestern,
      query: "hotel",
      page: "/b",
      clicks: 5,
      impressions: 300,
      ctr: 0.0167,
      position: 6,
    },
    {
      client_id: KUNDE_A,
      date: gestern,
      query: "spa",
      page: "/a",
      clicks: 1,
      impressions: 50,
      ctr: 0.02,
      position: 12,
    },
    {
      client_id: KUNDE_B,
      date: gestern,
      query: "fremd",
      page: "/x",
      clicks: 99,
      impressions: 999,
      ctr: 0.1,
      position: 1,
    },
  ],
  ga4_landing_daily: [
    {
      client_id: KUNDE_A,
      date: gestern,
      landing_page: "/a",
      channel_group: "Organic Search",
      session_source: "google",
      session_medium: "organic",
      sessions: 30,
      engaged_sessions: 20,
      key_events: 2,
    },
    {
      client_id: KUNDE_A,
      date: gestern,
      landing_page: "/a",
      channel_group: "Direct",
      session_source: "(direct)",
      session_medium: "(none)",
      sessions: 10,
      engaged_sessions: 5,
      key_events: 1,
    },
    {
      client_id: KUNDE_A,
      date: vorgestern,
      landing_page: "/b",
      channel_group: "Organic Search",
      session_source: "google",
      session_medium: "organic",
      sessions: 7,
      engaged_sessions: 3,
      key_events: 0,
    },
  ],
};

// ── In-Memory-PostgREST-Double ───────────────────────────────────────────────
const abfragen: Array<{ table: string; filters: string[] }> = [];

function ilikeRegex(p: string): RegExp {
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "\\" && i + 1 < p.length) re += p[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (c === "%") re += ".*";
    else if (c === "_") re += ".";
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i");
}

function builder(table: string) {
  const st: any = {
    filters: [] as ((r: any) => boolean)[],
    namen: [] as string[],
    orders: [] as [string, boolean][],
    range: null as [number, number] | null,
    limit: null as number | null,
    single: false,
    count: false,
  };
  abfragen.push({ table, filters: st.namen });
  const f = (name: string, fn: (r: any) => boolean) => {
    st.namen.push(name);
    st.filters.push(fn);
    return api;
  };
  const api: any = {
    select: (_c: string, o?: { count?: string }) => ((st.count = !!o?.count), api),
    eq: (k: string, v: any) => f(`eq:${k}`, (r) => r[k] === v),
    in: (k: string, vs: any[]) => f(`in:${k}`, (r) => vs.includes(r[k])),
    gte: (k: string, v: any) => f(`gte:${k}`, (r) => r[k] >= v),
    lte: (k: string, v: any) => f(`lte:${k}`, (r) => r[k] <= v),
    lt: (k: string, v: any) => f(`lt:${k}`, (r) => r[k] < v),
    ilike: (k: string, p: string) => f(`ilike:${k}`, (r) => ilikeRegex(p).test(String(r[k] ?? ""))),
    order: (k: string, o?: { ascending?: boolean }) => (
      st.orders.push([k, o?.ascending !== false]),
      api
    ),
    range: (a: number, b: number) => ((st.range = [a, b]), api),
    limit: (n: number) => ((st.limit = n), api),
    maybeSingle: () => ((st.single = true), api),
    then: (resolve: any) => {
      let rows = (db[table] || []).filter((r) => st.filters.every((fn: any) => fn(r)));
      const total = rows.length;
      rows = [...rows].sort((a, b) => {
        for (const [k, asc] of st.orders) {
          const x = a[k] ?? "";
          const y = b[k] ?? "";
          if (x < y) return asc ? -1 : 1;
          if (x > y) return asc ? 1 : -1;
        }
        return 0;
      });
      if (st.range) rows = rows.slice(st.range[0], st.range[1] + 1);
      if (st.limit != null) rows = rows.slice(0, st.limit);
      const data = st.single ? (rows.length === 1 ? rows[0] : null) : rows;
      resolve({ data, error: null, count: st.count ? total : null });
    },
  };
  return api;
}

const rpcAufrufe: Array<{ name: string; args: any }> = [];
const rpcAntworten: Record<string, any[] | Error> = {};
const supabaseAdminStub = {
  from: (t: string) => builder(t),
  rpc: (name: string, args: any) => {
    rpcAufrufe.push({ name, args });
    const a = rpcAntworten[name];
    if (a instanceof Error) return Promise.resolve({ data: null, error: a });
    return Promise.resolve({ data: a ?? [], error: null });
  },
};
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: supabaseAdminStub }));

const logAufrufe: any[] = [];
vi.mock("@/server/ingest-auth.server", () => ({
  authenticateReadApi: async (request: Request) => {
    const h = request.headers.get("authorization") || "";
    const tok = h.startsWith("Bearer ") ? h.slice(7) : "";
    const org = TOKENS[tok];
    if (!org) return Response.json({ ok: false, error: "nope" }, { status: 401 });
    return { ok: true, organizationId: org, credentialId: `cred-${tok}` };
  },
  logReadApi: async (e: any) => {
    logAufrufe.push(e);
  },
}));

type H = Record<
  string,
  (a: { request: Request; params?: Record<string, string> }) => Promise<Response>
>;
const routen: Record<string, H> = {};

const h = (m: any): H => m.Route.options.server!.handlers as any;

beforeAll(async () => {
  routen.projects = h(await import("../routes/api/v1.projects"));
  routen.rankings = h(await import("../routes/api/v1.projects.$projectId.rankings"));
  routen.changes = h(await import("../routes/api/v1.projects.$projectId.ranking-changes"));
  routen.gsc = h(await import("../routes/api/v1.projects.$projectId.search-console"));
  routen.ga4 = h(await import("../routes/api/v1.projects.$projectId.analytics"));
  routen.vis = h(await import("../routes/api/v1.projects.$projectId.visibility"));
  routen.global = h(await import("../routes/api/v1.seo.ranking-changes"));
});

beforeEach(() => {
  rpcAufrufe.length = 0;
  abfragen.length = 0;
  logAufrufe.length = 0;
  for (const k of Object.keys(rpcAntworten)) delete rpcAntworten[k];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function aufruf(
  route: string,
  path: string,
  o: { token?: string | null; method?: string; projectId?: string } = {},
) {
  const token = o.token === undefined ? "tok-a" : o.token;
  const method = o.method ?? "GET";
  const request = new Request(`http://test${path}`, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const h = routen[route];
  const fn = h[method] ?? h.ANY;
  return fn({ request, params: o.projectId ? { projectId: o.projectId } : {} });
}

describe("Read-API — Auth, Header, Methoden", () => {
  it("401 ohne Token im einheitlichen Fehlerformat, keine DB-Abfrage", async () => {
    const r = await aufruf("projects", "/api/v1/projects", { token: null });
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({
      error: { code: "unauthorized", message: expect.any(String) },
    });
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    expect(r.headers.get("x-request-id")).toBeTruthy();
    expect(abfragen).toHaveLength(0);
  });

  it("401 mit falschem Token", async () => {
    const r = await aufruf("projects", "/api/v1/projects", { token: "ezyi_ra_falsch" });
    expect(r.status).toBe(401);
  });

  it("200 mit no-store, CORS, X-Request-Id und Logging", async () => {
    const r = await aufruf("projects", "/api/v1/projects?limit=5");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    expect(r.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(logAufrufe).toHaveLength(1);
    expect(logAufrufe[0]).toMatchObject({
      credentialId: "cred-tok-a",
      organizationId: ORG_A,
      method: "GET",
      path: "/api/v1/projects",
      query: { limit: "5" },
      status: 200,
      zeilen: 2,
    });
  });

  it("OPTIONS 204 (CORS-Preflight), POST 405", async () => {
    const o = await aufruf("projects", "/api/v1/projects", { method: "OPTIONS", token: null });
    expect(o.status).toBe(204);
    expect(o.headers.get("access-control-allow-methods")).toContain("GET");
    const p = await aufruf("projects", "/api/v1/projects", { method: "POST" });
    expect(p.status).toBe(405);
    expect((await p.json()).error.code).toBe("method_not_allowed");
    expect(p.headers.get("allow")).toContain("GET");
  });

  it("500 redaktiert: keine DB-Details in der Antwort", async () => {
    rpcAntworten.rank_changes = new Error('relation "secret_table" permission denied at line 1');
    const r = await aufruf("global", "/api/v1/seo/ranking-changes");
    expect(r.status).toBe(500);
    const j = await r.json();
    expect(j).toEqual({ error: { code: "internal_error", message: "Internal server error." } });
    expect(logAufrufe[0].status).toBe(500);
  });
});

describe("GET /api/v1/projects", () => {
  it("nur Projekte der eigenen Org, keine sensiblen Felder", async () => {
    const r = await aufruf("projects", "/api/v1/projects");
    const j = await r.json();
    expect(j.data.map((p: any) => p.id)).toEqual([KUNDE_A, KUNDE_A2]);
    const text = JSON.stringify(j);
    for (const verboten of [
      "metadata",
      "geheim",
      "wp_password",
      "refresh_token",
      "gsc_property",
      "organization_id",
    ])
      expect(text).not.toContain(verboten);
    expect(Object.keys(j.data[0]).sort()).toEqual(
      [
        "country",
        "domain",
        "has_analytics",
        "has_rank_tracking",
        "has_search_console",
        "id",
        "language",
        "name",
        "status",
      ].sort(),
    );
    expect(j.data[0]).toMatchObject({
      status: "active",
      has_rank_tracking: true,
      has_search_console: true,
      has_analytics: true,
    });
    expect(j.data[1]).toMatchObject({
      status: "paused",
      has_rank_tracking: false,
      has_search_console: false,
      has_analytics: false,
    });
    const b = await (await aufruf("projects", "/api/v1/projects", { token: "tok-b" })).json();
    expect(b.data.map((p: any) => p.id)).toEqual([KUNDE_B]);
  });

  it("Pagination: total und next_offset", async () => {
    const r1 = await (await aufruf("projects", "/api/v1/projects?limit=1")).json();
    expect(r1.pagination).toEqual({ limit: 1, offset: 0, total: 2, next_offset: 1 });
    const r2 = await (await aufruf("projects", "/api/v1/projects?limit=1&offset=1")).json();
    expect(r2.pagination).toEqual({ limit: 1, offset: 1, total: 2, next_offset: null });
    expect(r2.data[0].id).toBe(KUNDE_A2);
  });

  it("400 bei limit > 1000, limit 0 und negativem offset", async () => {
    for (const q of ["limit=1001", "limit=0", "offset=-1", "limit=abc"]) {
      const r = await aufruf("projects", `/api/v1/projects?${q}`);
      expect(r.status, q).toBe(400);
      expect((await r.json()).error.code).toBe("validation_error");
    }
  });
});

describe("Mandantentrennung Projekt-Endpunkte", () => {
  const pfade: Array<[string, string]> = [
    ["rankings", "rankings"],
    ["changes", "ranking-changes"],
    ["gsc", "search-console"],
    ["ga4", "analytics"],
    ["vis", "visibility"],
  ];
  it.each(pfade)("%s: Projekt fremder Org → 404, keine RPC", async (route, suffix) => {
    const r = await aufruf(route, `/api/v1/projects/${KUNDE_B}/${suffix}`, { projectId: KUNDE_B });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: { code: "not_found", message: "Project not found." } });
    expect(rpcAufrufe).toHaveLength(0);
    expect(abfragen.filter((a) => a.table !== "clients")).toHaveLength(0);
  });

  it("ungueltige project_id → 404", async () => {
    const r = await aufruf("rankings", `/api/v1/projects/nope/rankings`, { projectId: "nope" });
    expect(r.status).toBe(404);
  });

  it("project_id wird auch ohne Router-Params aus dem Pfad gelesen", async () => {
    const request = new Request(`http://test/api/v1/projects/${KUNDE_B}/rankings`, {
      headers: { authorization: "Bearer tok-a" },
    });
    expect((await routen.rankings.GET({ request })).status).toBe(404);
  });
});

describe("GET /api/v1/projects/{id}/rankings", () => {
  it("previous_position/change aus dem letzten vorherigen Messtag, org-gefiltert", async () => {
    const r = await aufruf("rankings", `/api/v1/projects/${KUNDE_A}/rankings`, {
      projectId: KUNDE_A,
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.meta).toMatchObject({
      from: addDays(heute, -27),
      to: heute,
      source: "rank_daily",
      coverage: "full",
    });
    expect(j.pagination.total).toBe(6);
    const eins = j.data.find((d: any) => d.date === gestern && d.keyword === "kw eins");
    expect(eins).toMatchObject({ position: 5, previous_position: 3, change: 2, is_money: true });
    const drei = j.data.find((d: any) => d.date === gestern && d.keyword === "kw drei");
    expect(drei).toMatchObject({ position: null, previous_position: 5, change: null });
    const alt = j.data.find((d: any) => d.date === vorgestern && d.keyword === "kw eins");
    expect(alt.previous_position).toBeNull();
    expect(j.data.some((d: any) => d.keyword === "fremd kw")).toBe(false);
    for (const a of abfragen.filter((x) => x.table === "rank_daily"))
      expect(a.filters).toContain("eq:organization_id");
  });

  it("Filter keyword + Pagination", async () => {
    const j = await (
      await aufruf("rankings", `/api/v1/projects/${KUNDE_A}/rankings?keyword=ZWEI&limit=1`, {
        projectId: KUNDE_A,
      })
    ).json();
    expect(j.pagination).toEqual({ limit: 1, offset: 0, total: 2, next_offset: 1 });
    expect(j.data[0].keyword).toBe("kw zwei");
  });

  it("400 bei verdrehtem Zeitraum, falschem Format, Zukunft, > 400 Tage", async () => {
    const fall = [
      "from=2026-09-10&to=2026-09-01",
      "from=10.09.2026",
      `to=${addDays(heute, 3)}`,
      `from=${addDays(heute, -400)}&to=${heute}`,
      "device=watch",
      "country=CHE",
    ];
    for (const q of fall) {
      const r = await aufruf("rankings", `/api/v1/projects/${KUNDE_A}/rankings?${q}`, {
        projectId: KUNDE_A,
      });
      expect(r.status, q).toBe(400);
      expect((await r.json()).error.code).toBe("validation_error");
    }
  });

  it("400 Tage exakt sind erlaubt", async () => {
    const r = await aufruf(
      "rankings",
      `/api/v1/projects/${KUNDE_A}/rankings?from=${addDays(heute, -399)}&to=${heute}`,
      { projectId: KUNDE_A },
    );
    expect(r.status).toBe(200);
  });
});

describe("Ranking-Changes (Projekt und global)", () => {
  const zeile = (client: string, kw: string, total = 2) => ({
    client_id: client,
    keyword: kw,
    url: "https://x/",
    position_before: 3,
    position_after: 9,
    position_change: 6,
    date_before: "2026-09-24",
    date_after: "2026-09-27",
    pos_src: "crawl",
    search_volume: 50,
    country: "CH",
    device: "desktop",
    dropped_out: false,
    total_count: total,
  });

  it("Projekt: RPC-Args (Org, Kunde, Richtung, Schwelle) und Feldmapping", async () => {
    rpcAntworten.rank_changes = [zeile(KUNDE_A, "a"), zeile(KUNDE_A, "b")];
    const r = await aufruf(
      "changes",
      `/api/v1/projects/${KUNDE_A}/ranking-changes?from=2026-09-24&to=${heute}&direction=gains&min_change=2.5&country=ch&limit=2`,
      { projectId: KUNDE_A },
    );
    expect(r.status).toBe(200);
    expect(rpcAufrufe[0]).toEqual({
      name: "rank_changes",
      args: {
        _org: ORG_A,
        _client: KUNDE_A,
        _from: "2026-09-24",
        _to: heute,
        _min_loss: 2.5,
        _country: "CH",
        _device: null,
        _limit: 2,
        _offset: 0,
        _richtung: "gewinn",
      },
    });
    const j = await r.json();
    expect(j.pagination).toEqual({ limit: 2, offset: 0, total: 2, next_offset: null });
    expect(j.data[0]).not.toHaveProperty("total_count");
    expect(j.data[0]).not.toHaveProperty("client_id");
    expect(j.data[0]).toMatchObject({ keyword: "a", position_change: 6, dropped_out: false });
  });

  it("Default-Richtung losses → 'verlust', ungueltige Richtung → 400", async () => {
    await aufruf("changes", `/api/v1/projects/${KUNDE_A}/ranking-changes`, { projectId: KUNDE_A });
    expect(rpcAufrufe[0].args._richtung).toBe("verlust");
    expect(rpcAufrufe[0].args._min_loss).toBe(1);
    const r = await aufruf(
      "changes",
      `/api/v1/projects/${KUNDE_A}/ranking-changes?direction=down`,
      { projectId: KUNDE_A },
    );
    expect(r.status).toBe(400);
  });

  it("global: _org aus dem Token, _client null, nur eigene Projekte, next_offset", async () => {
    rpcAntworten.rank_changes = [zeile(KUNDE_A, "a", 3), zeile(KUNDE_B, "fremd", 3)];
    const r = await aufruf(
      "global",
      `/api/v1/seo/ranking-changes?from=2026-09-24&min_position_loss=3&limit=2`,
    );
    expect(r.status).toBe(200);
    expect(rpcAufrufe[0].args).toMatchObject({ _org: ORG_A, _client: null, _min_loss: 3 });
    const j = await r.json();
    expect(j.data).toHaveLength(1);
    expect(j.data[0]).toMatchObject({
      project_id: KUNDE_A,
      project_name: "Alpha Hotel",
      domain: "alpha.ch",
      keyword: "a",
    });
    expect(JSON.stringify(j)).not.toContain("Fremd AG");
    expect(j.pagination).toEqual({ limit: 2, offset: 0, total: 3, next_offset: 2 });
    const kundenAbfrage = abfragen.find((a) => a.table === "clients");
    expect(kundenAbfrage?.filters).toContain("eq:organization_id");
  });

  it("global mit Token der Org B: _org = ORG_B", async () => {
    await aufruf("global", `/api/v1/seo/ranking-changes`, { token: "tok-b" });
    expect(rpcAufrufe[0].args._org).toBe(ORG_B);
  });
});

describe("GET /api/v1/projects/{id}/search-console", () => {
  it("Aggregation nach query: Summen, impressionsgewichtete Position, unavailable_fields", async () => {
    const r = await aufruf("gsc", `/api/v1/projects/${KUNDE_A}/search-console`, {
      projectId: KUNDE_A,
    });
    const j = await r.json();
    expect(j.meta.unavailable_fields).toEqual(["device", "country"]);
    expect(j.meta.coverage).toBe("full");
    expect(j.pagination.total).toBe(2);
    const hotel = j.data.find((d: any) => d.query === "hotel");
    // (2*100 + 6*300) / 400 = 5
    expect(hotel).toEqual({
      query: "hotel",
      page: null,
      date: null,
      clicks: 15,
      impressions: 400,
      ctr: 0.0375,
      position: 5,
      device: null,
      country: null,
    });
    expect(JSON.stringify(j)).not.toContain("fremd");
  });

  it("dimensions=page,date und Filter; ungueltige Dimension → 400", async () => {
    const j = await (
      await aufruf(
        "gsc",
        `/api/v1/projects/${KUNDE_A}/search-console?dimensions=page,date&page=/a`,
        {
          projectId: KUNDE_A,
        },
      )
    ).json();
    expect(j.data).toHaveLength(2);
    expect(j.data.every((d: any) => d.page === "/a" && d.date && d.query === null)).toBe(true);
    const all = await (
      await aufruf(
        "gsc",
        `/api/v1/projects/${KUNDE_A}/search-console?dimensions=query,page,date&limit=2`,
        {
          projectId: KUNDE_A,
        },
      )
    ).json();
    expect(all.pagination).toEqual({ limit: 2, offset: 0, total: 3, next_offset: 2 });
    const bad = await aufruf(
      "gsc",
      `/api/v1/projects/${KUNDE_A}/search-console?dimensions=device`,
      {
        projectId: KUNDE_A,
      },
    );
    expect(bad.status).toBe(400);
  });

  it("Projekt ohne First-Party-Daten → 200, leer, coverage not_connected", async () => {
    const r = await aufruf("gsc", `/api/v1/projects/${KUNDE_A2}/search-console`, {
      projectId: KUNDE_A2,
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.data).toEqual([]);
    expect(j.meta.coverage).toBe("not_connected");
    expect(abfragen.some((a) => a.table === "gsc_daily")).toBe(false);
  });
});

describe("GET /api/v1/projects/{id}/analytics", () => {
  it("group_by=date: sessions, organic_sessions, conversions, users null", async () => {
    const j = await (
      await aufruf("ga4", `/api/v1/projects/${KUNDE_A}/analytics`, { projectId: KUNDE_A })
    ).json();
    expect(j.meta.unavailable_fields).toEqual(["users"]);
    expect(j.data).toEqual([
      {
        date: vorgestern,
        landing_page: null,
        sessions: 7,
        organic_sessions: 7,
        users: null,
        conversions: 0,
      },
      {
        date: gestern,
        landing_page: null,
        sessions: 40,
        organic_sessions: 30,
        users: null,
        conversions: 3,
      },
    ]);
  });

  it("group_by=landing_page, not_connected ohne Flag, ungueltiges group_by → 400", async () => {
    const j = await (
      await aufruf("ga4", `/api/v1/projects/${KUNDE_A}/analytics?group_by=landing_page`, {
        projectId: KUNDE_A,
      })
    ).json();
    expect(j.data[0]).toMatchObject({ landing_page: "/a", date: null, sessions: 40 });
    const n = await (
      await aufruf("ga4", `/api/v1/projects/${KUNDE_A2}/analytics`, { projectId: KUNDE_A2 })
    ).json();
    expect(n.meta.coverage).toBe("not_connected");
    const bad = await aufruf("ga4", `/api/v1/projects/${KUNDE_A}/analytics?group_by=user`, {
      projectId: KUNDE_A,
    });
    expect(bad.status).toBe(400);
  });
});

describe("GET /api/v1/projects/{id}/visibility", () => {
  it("RPC-Args, visibility_index/top100 null + unavailable_fields, Pagination", async () => {
    rpcAntworten.visibility_daily = [
      {
        date: gestern,
        pos_src: "crawl",
        tracked: 3,
        top3: 1,
        top10: 2,
        top30: 2,
        avg_position: 5.5,
        keywords_ranking: 2,
      },
      {
        date: vorgestern,
        pos_src: "crawl",
        tracked: 3,
        top3: 1,
        top10: 3,
        top30: 3,
        avg_position: 4,
        keywords_ranking: 3,
      },
    ];
    const r = await aufruf("vis", `/api/v1/projects/${KUNDE_A}/visibility?limit=1`, {
      projectId: KUNDE_A,
    });
    const j = await r.json();
    expect(rpcAufrufe[0]).toMatchObject({
      name: "visibility_daily",
      args: { _org: ORG_A, _client: KUNDE_A },
    });
    expect(j.meta.unavailable_fields).toEqual(["visibility_index", "top100"]);
    expect(j.pagination).toEqual({ limit: 1, offset: 0, total: 2, next_offset: 1 });
    expect(j.data[0]).toMatchObject({
      date: vorgestern,
      visibility_index: null,
      top100: null,
      top10: 3,
      tracked: 3,
    });
  });
});

describe("OpenAPI", () => {
  it("3.1.0, alle 7 Datenpfade, eindeutige operationIds, bearerAuth", async () => {
    const { readApiOpenApi } = await import("./read-api-openapi");
    const spec: any = readApiOpenApi();
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.servers[0].url).toBe("https://ezyhub.ch");
    expect(spec.components.securitySchemes.bearerAuth).toMatchObject({
      type: "http",
      scheme: "bearer",
    });
    const pfade = Object.keys(spec.paths).sort();
    expect(pfade).toEqual(
      [
        "/api/v1/projects",
        "/api/v1/projects/{project_id}/rankings",
        "/api/v1/projects/{project_id}/ranking-changes",
        "/api/v1/projects/{project_id}/search-console",
        "/api/v1/projects/{project_id}/analytics",
        "/api/v1/projects/{project_id}/visibility",
        "/api/v1/seo/ranking-changes",
      ].sort(),
    );
    const ops = pfade.flatMap((p) => Object.values(spec.paths[p]).map((o: any) => o.operationId));
    expect(ops).toHaveLength(7);
    expect(new Set(ops).size).toBe(7);
    // Nur GET, jede Operation mit Beschreibung <= 300 Zeichen (ChatGPT-Limit).
    for (const p of pfade) {
      expect(Object.keys(spec.paths[p])).toEqual(["get"]);
      expect(spec.paths[p].get.description.length).toBeLessThanOrEqual(300);
    }
    // Alle $ref-Ziele existieren.
    const refs = JSON.stringify(spec).match(/"\$ref":"#\/components\/[^"]+"/g) ?? [];
    for (const r of refs) {
      const [, typ, name] = r.match(/#\/components\/([^/]+)\/([^"]+)/)!;
      expect(spec.components[typ]?.[name], r).toBeDefined();
    }
    // Pfadparameter in jedem Projektpfad deklariert.
    for (const p of pfade.filter((x) => x.includes("{project_id}")))
      expect(JSON.stringify(spec.paths[p].get.parameters)).toContain(
        "#/components/parameters/project_id",
      );
  });
});
