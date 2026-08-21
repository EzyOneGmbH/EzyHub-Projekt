// Cross-Tenant-Integrationstests (Security-Runde 2, 21.08.2026).
// Es werden die ECHTEN Route-Handler aufgerufen (agent/agents, agent/approvals,
// agent/pilot, public/report, wordpress/connection) — nur die Aussenwelt ist
// ersetzt: eine In-Memory-Supabase (2 Organisationen × Owner/Admin/Member/
// Viewer) und ein agent-service-Double, das das produktive Org-Gate nachbildet.
// Damit laufen die Tests deterministisch in der CI und beweisen die
// Organisations-Grenzen Ende-zu-Ende durch die Handler-Logik.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// ── Fixtures: 2 Organisationen × 4 Rollen ───────────────────────────────────
const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORG_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // existiert NICHT
const KUNDE_A = "11111111-1111-4111-8111-111111111111";
const KUNDE_B = "22222222-2222-4222-8222-222222222222";

const users: Record<string, { org: string; role: string }[]> = {
  "owner-a": [{ org: ORG_A, role: "owner" }],
  "admin-a": [{ org: ORG_A, role: "admin" }],
  "member-a": [{ org: ORG_A, role: "member" }],
  "viewer-a": [{ org: ORG_A, role: "viewer" }],
  "owner-b": [{ org: ORG_B, role: "owner" }],
  "admin-b": [{ org: ORG_B, role: "admin" }],
  "member-b": [{ org: ORG_B, role: "member" }],
  "viewer-b": [{ org: ORG_B, role: "viewer" }],
  // Mehrfach-Mitgliedschaft: admin in A, NUR member in B.
  "multi-ab": [
    { org: ORG_A, role: "admin" },
    { org: ORG_B, role: "member" },
  ],
};

// ── In-Memory-Supabase (chainbarer Query-Builder fuer die genutzten Ketten) ──
const db: Record<string, any[]> = {
  app_users: Object.entries(users).flatMap(([uid, ms]) =>
    ms.map((m) => ({ user_id: uid, organization_id: m.org, role: m.role })),
  ),
  clients: [
    { id: KUNDE_A, organization_id: ORG_A, name: "Kunde A", domain: "a.ch" },
    { id: KUNDE_B, organization_id: ORG_B, name: "Kunde B", domain: "b.ch" },
  ],
  client_access: [{ user_id: "member-b", client_id: KUNDE_B, organization_id: ORG_B }],
  oauth_connections: [],
  public_report_links: [],
  ai_visibility_reports: [
    {
      id: "rep-a",
      client_id: KUNDE_A,
      snapshot_date: "2026-08-20",
      score: 66,
      score_delta: 2,
      mentions: 10,
      citations: 5,
      cited_pages: 3,
    },
  ],
  ai_visibility_models: [],
  ai_visibility_topics: [],
  ai_visibility_sources: [],
  ai_visibility_sov: [],
};

function builder(table: string) {
  const state: any = { filters: [] as ((r: any) => boolean)[], limit: 0, single: false };
  const api: any = {
    select() {
      return api;
    },
    eq(k: string, v: any) {
      state.filters.push((r: any) => r[k] === v);
      return api;
    },
    in(k: string, arr: any[]) {
      state.filters.push((r: any) => arr.includes(r[k]));
      return api;
    },
    is(k: string, v: any) {
      state.filters.push((r: any) => (v === null ? r[k] == null : r[k] === v));
      return api;
    },
    order() {
      return api;
    },
    limit(n: number) {
      state.limit = n;
      return api;
    },
    maybeSingle() {
      state.single = true;
      return api;
    },
    single() {
      state.single = true;
      return api;
    },
    update(patch: any) {
      state.update = patch;
      return api;
    },
    delete() {
      state.del = true;
      return api;
    },
    insert(row: any) {
      const rows = Array.isArray(row) ? row : [row];
      for (const r of rows)
        db[table].push({ ...r, id: r.id ?? `${table}-${db[table].length + 1}` });
      return Promise.resolve({ data: null, error: null });
    },
    then(resolve: any) {
      let rows = (db[table] || []).filter((r) => state.filters.every((f: any) => f(r)));
      if (state.update) {
        for (const r of rows) Object.assign(r, state.update);
      }
      if (state.del) {
        db[table] = (db[table] || []).filter((r) => !rows.includes(r));
      }
      if (state.limit) rows = rows.slice(0, state.limit);
      const data = state.single ? (rows.length === 1 ? rows[0] : null) : rows;
      resolve({ data, error: null });
    },
  };
  return api;
}
const supabaseAdminStub = { from: (t: string) => builder(t) };

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: supabaseAdminStub }));
// Auth: Authorization "Bearer <userId>" -> dieser User ist eingeloggt.
vi.mock("@supabase/supabase-js", () => ({
  createClient: (_u: string, _k: string, opts: any) => ({
    auth: {
      getUser: async () => {
        const h = String(opts?.global?.headers?.Authorization || "");
        const id = h.startsWith("Bearer ") ? h.slice(7) : "";
        return { data: { user: users[id] ? { id } : null } };
      },
    },
  }),
}));

// ── agent-service-Double: bildet das produktive Org-Gate nach ───────────────
const svcAgents: Record<string, any[]> = {
  [ORG_A]: [
    { id: "ag-a", name: "Agent A", organizationId: ORG_A },
    { id: "ag-alt", name: "Unmarkierter Altbestand" }, // ohne organizationId!
    { id: "ag-fremd", name: "Fremd markiert", organizationId: ORG_B },
  ],
  [ORG_B]: [{ id: "ag-b", name: "Agent B", organizationId: ORG_B }],
};
const svcItems = [
  { id: "ap-a", clientName: "Kunde A", status: "offen" },
  { id: "ap-a2", clientName: "Kunde A", status: "erledigt" },
];
const fetchCalls: { url: string; init?: any }[] = [];
const echteFetch = globalThis.fetch;

function svcFetch(input: any, init?: any): Promise<Response> {
  const url = String(input);
  fetchCalls.push({ url, init });
  const u = new URL(url);
  const org = u.searchParams.get("org") || (init?.headers?.["X-Ezy-Organization"] ?? "");
  if (u.pathname === "/agents") {
    if (!svcAgents[org])
      return Promise.resolve(
        Response.json({ ok: false, error: "Organisation fehlt oder unbekannt" }, { status: 403 }),
      );
    // Wie in Prod stempelt der Service NICHT nach — die App filtert strikt.
    return Promise.resolve(Response.json({ ok: true, agents: svcAgents[org] }));
  }
  if (u.pathname === "/approvals") {
    if (org !== ORG_A)
      return Promise.resolve(
        Response.json({ ok: false, error: "Organisation fehlt oder unbekannt" }, { status: 403 }),
      );
    // Prod-Verhalten: Items der eigenen Org gestempelt; hier ABSICHTLICH ein
    // unmarkiertes + ein fremdes Item beigemischt, um die defensive
    // App-Filterung zu beweisen.
    const items = [
      { ...svcItems[0], organizationId: ORG_A },
      { ...svcItems[1], organizationId: ORG_A },
      { id: "ap-unmarkiert", status: "offen" },
      { id: "ap-b", status: "offen", organizationId: ORG_B },
    ];
    return Promise.resolve(Response.json({ ok: true, items, openCount: 3 }));
  }
  if (u.pathname === "/pilot-topics")
    return Promise.resolve(Response.json({ ok: true, topics: [] }));
  if (u.pathname.endsWith("/wp-json/wp/v2/users/me") || u.searchParams.get("rest_route"))
    return Promise.resolve(Response.json({ name: "wp-admin", id: 1 }));
  if (u.pathname === "/wp-json/wp/v2/posts" || u.pathname.endsWith("/posts"))
    return Promise.resolve(Response.json([]));
  return Promise.resolve(Response.json({ ok: false, error: "unbekannt" }, { status: 404 }));
}

// ── Handler-Zugriff ─────────────────────────────────────────────────────────
let agents: any, approvals: any, pilot: any, report: any, wp: any;

function req(
  method: string,
  path: string,
  opts: { user?: string; body?: any; headers?: Record<string, string> } = {},
) {
  return new Request(`http://test${path}`, {
    method,
    headers: {
      ...(opts.user ? { authorization: `Bearer ${opts.user}` } : {}),
      ...(opts.body ? { "content-type": "application/json" } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

beforeAll(async () => {
  process.env.SUPABASE_URL = "http://stub.local";
  process.env.SUPABASE_ANON_KEY = "stub-anon";
  process.env.ADMIN_AUTOMATION_SECRET = "test-automation-secret";
  process.env.AGENT_BASE_URL = "http://agent.stub";
  process.env.AGENT_SHARED_SECRET = "stub-shared";
  process.env.WP_SECRET_KEY_V1 = "test-dedizierter-schluessel";
  vi.stubGlobal("fetch", svcFetch);
  agents = (await import("../routes/api/agent.agents")).Route.options.server!.handlers;
  approvals = (await import("../routes/api/agent.approvals")).Route.options.server!.handlers;
  pilot = (await import("../routes/api/agent.pilot")).Route.options.server!.handlers;
  report = (await import("../routes/api/public.report")).Route.options.server!.handlers;
  wp = (await import("../routes/api/wordpress.connection")).Route.options.server!.handlers;
});
afterAll(() => {
  vi.stubGlobal("fetch", echteFetch);
});

// ── agent/agents ────────────────────────────────────────────────────────────
describe("agent/agents (Org strikt, kein Unmarkiert-Durchlass)", () => {
  it("member A sieht NUR exakt fuer Org A markierte Agenten", async () => {
    const r = await agents.GET({ request: req("GET", "/api/agent/agents", { user: "member-a" }) });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.agents.map((a: any) => a.id)).toEqual(["ag-a"]); // unmarkiert + fremd NIE
  });

  it("viewer wird abgelehnt; member darf nicht mutieren", async () => {
    const r1 = await agents.GET({ request: req("GET", "/api/agent/agents", { user: "viewer-a" }) });
    expect(r1.status).toBe(403);
    const r2 = await agents.POST({
      request: req("POST", "/api/agent/agents", { user: "member-a", body: { name: "X" } }),
    });
    expect(r2.status).toBe(403);
    const r3 = await agents.GET({ request: req("GET", "/api/agent/agents", {}) });
    expect(r3.status).toBe(401);
  });

  it("manipulierte org im Query/Body wird serverseitig ueberschrieben", async () => {
    fetchCalls.length = 0;
    const r = await agents.POST({
      request: req("POST", `/api/agent/agents?org=${ORG_B}`, {
        user: "admin-a",
        body: { name: "Neu", organizationId: ORG_B },
      }),
    });
    expect(r.status).toBe(200);
    const call = fetchCalls.find((c) => c.url.includes("/agents"))!;
    expect(new URL(call.url).searchParams.get("org")).toBe(ORG_A);
    expect(JSON.parse(call.init.body).organizationId).toBe(ORG_A);
  });

  it("Mehrfach-Mitgliedschaft: ohne aktive Org 409; Rolle gilt EXAKT je Org", async () => {
    const r1 = await agents.GET({ request: req("GET", "/api/agent/agents", { user: "multi-ab" }) });
    expect(r1.status).toBe(409);
    // Aktive Org B: multi-ab ist dort NUR member -> GET ok (sieht B-Agenten) ...
    const r2 = await agents.GET({
      request: req("GET", "/api/agent/agents", {
        user: "multi-ab",
        headers: { "x-ezy-active-org": ORG_B },
      }),
    });
    const j2 = await r2.json();
    expect(j2.agents.map((a: any) => a.id)).toEqual(["ag-b"]);
    // ... aber POST (admin noetig) wird abgelehnt, obwohl er in A admin ist.
    const r3 = await agents.POST({
      request: req("POST", "/api/agent/agents", {
        user: "multi-ab",
        body: { name: "X" },
        headers: { "x-ezy-active-org": ORG_B },
      }),
    });
    expect(r3.status).toBe(403);
    // Fremde/unbekannte aktive Org -> 403.
    const r4 = await agents.GET({
      request: req("GET", "/api/agent/agents", {
        user: "multi-ab",
        headers: { "x-ezy-active-org": ORG_C },
      }),
    });
    expect(r4.status).toBe(403);
  });
});

// ── agent/approvals ─────────────────────────────────────────────────────────
describe("agent/approvals (defensiv nach exakter Org gefiltert)", () => {
  it("member A: unmarkierte/fremde Items werden NIE ausgeliefert, openCount korrekt", async () => {
    const r = await approvals.GET({
      request: req("GET", "/api/agent/approvals", { user: "member-a" }),
    });
    const j = await r.json();
    expect(j.items.map((i: any) => i.id).sort()).toEqual(["ap-a", "ap-a2"]);
    expect(j.openCount).toBe(1); // neu gerechnet auf die gefilterte Liste
  });

  it("Org B bekommt vom Service 403 durchgereicht — nie Daten von Org A", async () => {
    const r = await approvals.GET({
      request: req("GET", "/api/agent/approvals", { user: "member-b" }),
    });
    const j = await r.json();
    expect(j.ok).toBe(false);
    expect(j.items ?? []).toEqual([]);
  });

  it("manipulierte approvalId/Status werden formvalidiert abgelehnt", async () => {
    for (const body of [
      { id: "../../etc/passwd", status: "freigegeben" },
      { id: "ok-id", status: "; DROP TABLE" },
      { id: "", status: "freigegeben" },
    ]) {
      const r = await approvals.POST({
        request: req("POST", "/api/agent/approvals", { user: "admin-a", body }),
      });
      expect(r.status).toBe(400);
    }
  });
});

// ── agent/pilot ─────────────────────────────────────────────────────────────
describe("agent/pilot (Scope exakt je Organisation)", () => {
  it("member B sieht nur die ihm zugewiesenen Kunden seiner Org", async () => {
    const r = await pilot.GET({ request: req("GET", "/api/agent/pilot", { user: "member-b" }) });
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.clients.map((c: any) => c.id)).toEqual([KUNDE_B]);
  });

  it("owner A sieht alle Kunden der EIGENEN Org — nie Org B", async () => {
    const r = await pilot.GET({ request: req("GET", "/api/agent/pilot", { user: "owner-a" }) });
    const j = await r.json();
    expect(j.clients.map((c: any) => c.id)).toEqual([KUNDE_A]);
  });

  it("erschlichene aktive Org ohne Mitgliedschaft -> 403", async () => {
    const r = await pilot.GET({
      request: req("GET", "/api/agent/pilot", {
        user: "member-b",
        headers: { "x-ezy-active-org": ORG_A },
      }),
    });
    expect(r.status).toBe(403);
  });
});

// ── public/report ───────────────────────────────────────────────────────────
describe("public/report (Token an Kunde+Org gebunden, widerrufbar)", () => {
  let tokenUrl = "";

  it("nur owner/admin der EIGENEN Org erstellen Links; fremde clientId -> 404", async () => {
    for (const user of ["member-a", "viewer-a"]) {
      const r = await report.POST({
        request: req("POST", "/api/public/report", { user, body: { clientId: KUNDE_A } }),
      });
      expect(r.status).toBe(403);
    }
    const fremd = await report.POST({
      request: req("POST", "/api/public/report", { user: "admin-a", body: { clientId: KUNDE_B } }),
    });
    expect(fremd.status).toBe(404);
    const ok = await report.POST({
      request: req("POST", "/api/public/report", { user: "admin-a", body: { clientId: KUNDE_A } }),
    });
    const j = await ok.json();
    expect(j.ok).toBe(true);
    tokenUrl = j.url;
  });

  it("gueltiges Token liefert Report; manipuliertes Token wird abgelehnt", async () => {
    const token = tokenUrl.replace("/r/", "");
    const ok = await report.GET({
      request: req("GET", `/api/public/report?token=${encodeURIComponent(token)}`),
    });
    expect((await ok.json()).client).toBe("Kunde A");
    // Manipulation: clientId im Token gegen Kunde B tauschen -> Signatur bricht.
    const raw = Buffer.from(token, "base64url").toString("utf8");
    const gefaelscht = Buffer.from(raw.replace(KUNDE_A, KUNDE_B), "utf8").toString("base64url");
    const bad = await report.GET({
      request: req("GET", `/api/public/report?token=${encodeURIComponent(gefaelscht)}`),
    });
    expect(bad.status).toBe(401);
  });

  it("Admin von Org B kann Links von Org A NICHT widerrufen — Admin A schon", async () => {
    const fremd = await report.DELETE({
      request: req("DELETE", "/api/public/report", {
        user: "admin-b",
        body: { clientId: KUNDE_A },
      }),
    });
    expect((await fremd.json()).widerrufen).toBe(0);
    const eigen = await report.DELETE({
      request: req("DELETE", "/api/public/report", {
        user: "admin-a",
        body: { clientId: KUNDE_A },
      }),
    });
    expect((await eigen.json()).widerrufen).toBe(1);
    const token = tokenUrl.replace("/r/", "");
    const danach = await report.GET({
      request: req("GET", `/api/public/report?token=${encodeURIComponent(token)}`),
    });
    expect(danach.status).toBe(401); // widerrufen
  });
});

// ── wordpress/connection ────────────────────────────────────────────────────
describe("wordpress/connection (Org-Grenze + Verschluesselung)", () => {
  it("viewer sehen den Status nie; fremde Org wird abgelehnt", async () => {
    const r1 = await wp.GET({
      request: req("GET", `/api/wordpress/connection?clientId=${KUNDE_A}`, { user: "viewer-a" }),
    });
    expect(r1.status).toBe(403);
    const r2 = await wp.GET({
      request: req("GET", `/api/wordpress/connection?clientId=${KUNDE_B}`, { user: "member-a" }),
    });
    expect(r2.status).toBe(403);
    const r3 = await wp.POST({
      request: req("POST", "/api/wordpress/connection", {
        user: "admin-a",
        body: { clientId: KUNDE_B, siteUrl: "https://b.ch", username: "u", appPassword: "p" },
      }),
    });
    expect(r3.status).toBe(403);
  });

  it("Connect speichert das Application Password NUR verschluesselt (w1)", async () => {
    const r = await wp.POST({
      request: req("POST", "/api/wordpress/connection", {
        user: "admin-a",
        body: {
          clientId: KUNDE_A,
          siteUrl: "https://a.ch",
          username: "wp-user",
          appPassword: "app pass 1234",
        },
      }),
    });
    expect((await r.json()).ok).toBe(true);
    const row = db.oauth_connections.find((c) => c.client_id === KUNDE_A)!;
    expect(row.access_token.startsWith("enc:w1:")).toBe(true);
    expect(row.access_token).not.toContain("app pass 1234");
    // GET liefert den Status OHNE Secret.
    const g = await wp.GET({
      request: req("GET", `/api/wordpress/connection?clientId=${KUNDE_A}`, { user: "member-a" }),
    });
    const j = await g.json();
    expect(j.connected).toBe(true);
    expect(JSON.stringify(j)).not.toContain("app pass");
  });
});
