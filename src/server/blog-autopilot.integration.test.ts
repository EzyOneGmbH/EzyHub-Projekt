// Blog-Autopilot Phase 1 (09.11.2026): Zugriff nur per Einladung + Flag,
// Kunden-Grenzen und Verbindungstest gegen ein Plugin-Double. Es laufen die
// ECHTEN Route-Handler; ersetzt sind nur Supabase (In-Memory) und WordPress.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { blogZugriffErlaubt, normalisiereDomain } from "@/server/blog-autopilot.server";
import { ordneFehler, schluesselVerwerfen, EZR_KEY_RE } from "@/server/ezyrank-wp.server";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const K_A1 = "11111111-1111-4111-8111-111111111111"; // Flag an
const K_A2 = "22222222-2222-4222-8222-222222222222"; // Flag aus
const K_B = "33333333-3333-4333-8333-333333333333"; // andere Org, Flag an
const KEY = "ezr_" + "a".repeat(44);
const KEY_FALSCH = "ezr_" + "b".repeat(44);

const users: Record<string, { org: string; role: string }[]> = {
  "admin-a": [{ org: ORG_A, role: "admin" }],
  "viewer-a1": [{ org: ORG_A, role: "viewer" }],
  "viewer-a-ohne": [{ org: ORG_A, role: "viewer" }],
  "owner-b": [{ org: ORG_B, role: "owner" }],
  // Selbst registriert (ohne Einladung): Auth-Konto, aber keine Mitgliedschaft
  "selbst-registriert": [],
};

const db: Record<string, any[]> = {
  app_users: Object.entries(users).flatMap(([uid, ms]) =>
    ms.map((m) => ({ user_id: uid, organization_id: m.org, role: m.role })),
  ),
  clients: [
    { id: K_A1, organization_id: ORG_A, domain: "www.faithinhumanity.ch" },
    { id: K_A2, organization_id: ORG_A, domain: "a2.ch" },
    { id: K_B, organization_id: ORG_B, domain: "b.ch" },
  ],
  client_access: [{ user_id: "viewer-a1", client_id: K_A1 }],
  client_app_access: [
    { client_id: K_A1, app: "seo", features: ["blog", "blog_autopilot"] },
    { client_id: K_A2, app: "seo", features: ["blog"] },
    { client_id: K_B, app: "seo", features: ["blog_autopilot"] },
  ],
  blog_projects: [],
  writing_rules: [],
  wp_connections: [],
  blog_events: [],
  blog_competitors: [],
};

function builder(table: string) {
  const st: any = { filters: [] as ((r: any) => boolean)[], limit: 0, single: false };
  const run = () => {
    if (st.insert) {
      const neu = st.insert.map((r: any) => ({ ...r, id: r.id ?? crypto.randomUUID() }));
      db[table].push(...neu);
      return st.single ? neu[0] : neu;
    }
    if (st.upsert) {
      const r = st.upsert;
      const alt = db[table].find((x) => x[st.onConflict] === r[st.onConflict]);
      if (alt) Object.assign(alt, r);
      else db[table].push({ ...r, id: crypto.randomUUID() });
      return null;
    }
    let rows = (db[table] || []).filter((r) => st.filters.every((f: any) => f(r)));
    if (st.del) {
      db[table] = db[table].filter((r) => !rows.includes(r));
      return null;
    }
    if (st.update) for (const r of rows) Object.assign(r, st.update);
    if (st.limit) rows = rows.slice(0, st.limit);
    return st.single ? (rows.length === 1 ? rows[0] : null) : rows;
  };
  const api: any = {
    select: () => api,
    order: () => api,
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
    delete() {
      st.del = true;
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
    upsert(row: any, o: any) {
      st.upsert = row;
      st.onConflict = o?.onConflict;
      return api;
    },
    then(resolve: any, reject?: any) {
      try {
        resolve({ data: run(), error: null });
      } catch (e) {
        reject?.(e);
      }
    },
  };
  return api;
}
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => builder(t) },
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (_u: string, _k: string, opts: any) => ({
    auth: {
      getUser: async () => {
        const h = String(opts?.global?.headers?.Authorization || "");
        const id = h.startsWith("Bearer ") ? h.slice(7) : "";
        return { data: { user: id in users ? { id } : null } };
      },
    },
  }),
}));

// ── Plugin-Double (ezyrank/v1) ──────────────────────────────────────────────
const wpCalls: string[] = [];
function wpFetch(input: any, init?: any): Promise<Response> {
  const u = new URL(String(input));
  wpCalls.push(`${init?.method || "GET"} ${u.host}${u.pathname}`);
  if (u.host === "kein-plugin.ch")
    return Promise.resolve(Response.json({ code: "rest_no_route" }, { status: 404 }));
  if (u.host === "waf.ch")
    return Promise.resolve(
      new Response("<html>Forbidden</html>", {
        status: 403,
        headers: { "content-type": "text/html" },
      }),
    );
  const key = init?.headers?.["X-EzyRank-Key"];
  if (key !== KEY)
    return Promise.resolve(
      Response.json({ code: "ezr_auth_invalid", message: "Falscher Schlüssel" }, { status: 401 }),
    );
  if (u.pathname.endsWith("/health"))
    return Promise.resolve(Response.json({ ok: true, plugin_version: "2.0.0" }));
  if (u.pathname.endsWith("/capabilities"))
    return Promise.resolve(Response.json({ scopes: ["read", "draft"], seo_plugins: ["yoast"] }));
  if (u.pathname.endsWith("/test"))
    return Promise.resolve(Response.json({ ok: true, created_and_deleted: true, ms: 120 }));
  return Promise.resolve(Response.json({ code: "rest_no_route" }, { status: 404 }));
}

function req(method: string, path: string, user?: string, body?: any) {
  return new Request(`http://test${path}`, {
    method,
    headers: {
      ...(user ? { authorization: `Bearer ${user}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

let projects: any,
  connect: any,
  test: any,
  projekt: any,
  comps: any,
  rules: any,
  rule: any,
  events: any;
const echteFetch = globalThis.fetch;
beforeAll(async () => {
  process.env.SUPABASE_URL = "http://stub.local";
  process.env.SUPABASE_ANON_KEY = "stub-anon";
  process.env.WP_SECRET_KEY_V1 = "test-dedizierter-schluessel";
  vi.stubGlobal("fetch", wpFetch);
  projects = (await import("../routes/api/blog.projects")).Route.options.server!.handlers;
  connect = (await import("../routes/api/blog.projects.$id.wp.connect")).Route.options.server!
    .handlers;
  test = (await import("../routes/api/blog.projects.$id.wp.[test]")).Route.options.server!.handlers;
  projekt = (await import("../routes/api/blog.projects.$id")).Route.options.server!.handlers;
  comps = (await import("../routes/api/blog.projects.$id.competitors")).Route.options.server!
    .handlers;
  rules = (await import("../routes/api/blog.projects.$id.rules")).Route.options.server!.handlers;
  rule = (await import("../routes/api/blog.rules.$id")).Route.options.server!.handlers;
  events = (await import("../routes/api/blog.projects.$id.events")).Route.options.server!.handlers;
});
afterAll(() => vi.stubGlobal("fetch", echteFetch));

describe("Blog-Autopilot: Zugang nur per Einladung", () => {
  it("ohne Login 401, selbst registriert ohne Einladung 403", async () => {
    const r0 = await projects.GET({ request: req("GET", `/api/blog/projects?clientId=${K_A1}`) });
    expect(r0.status).toBe(401);
    const r1 = await projects.POST({
      request: req("POST", "/api/blog/projects", "selbst-registriert", { clientId: K_A1 }),
    });
    expect(r1.status).toBe(403);
  });

  it("eingeladenes Kunden-Login: nur eigener Kunde, nur mit Flag", async () => {
    const fremd = await projects.POST({
      request: req("POST", "/api/blog/projects", "viewer-a1", { clientId: K_B }),
    });
    expect(fremd.status).toBe(403);
    const ohneZuweisung = await projects.POST({
      request: req("POST", "/api/blog/projects", "viewer-a-ohne", { clientId: K_A1 }),
    });
    expect(ohneZuweisung.status).toBe(403);
    // Admin hat Zugriff auf K_A2, aber dort ist das Flag aus
    const ohneFlag = await projects.POST({
      request: req("POST", "/api/blog/projects", "admin-a", { clientId: K_A2 }),
    });
    expect(ohneFlag.status).toBe(403);
    expect((await ohneFlag.json()).error).toMatch(/nicht freigeschaltet/);
  });

  it("Projekt anlegen: Domain normalisiert, Standardregeln, idempotent", async () => {
    const r = await projects.POST({
      request: req("POST", "/api/blog/projects", "viewer-a1", { clientId: K_A1 }),
    });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.created).toBe(true);
    expect(j.project.domain).toBe("faithinhumanity.ch");
    expect(db.writing_rules.filter((w) => w.project_id === j.project.id)).toHaveLength(3);
    const r2 = await projects.POST({
      request: req("POST", "/api/blog/projects", "admin-a", { clientId: K_A1 }),
    });
    expect((await r2.json()).created).toBe(false);
    expect(db.blog_projects).toHaveLength(1);
  });
});

describe("Blog-Autopilot: WordPress verbinden", () => {
  const pid = () => db.blog_projects[0].id;

  it("fremde Org bekommt 404 (kein Existenz-Orakel)", async () => {
    const r = await connect.POST({
      request: req("POST", `/api/blog/projects/${pid()}/wp/connect`, "owner-b", {
        siteUrl: "https://faithinhumanity.ch",
        key: KEY,
      }),
      params: { id: pid() },
    });
    expect(r.status).toBe(404);
  });

  it("falscher Schlüssel: Klartext-Fehler, nichts gespeichert", async () => {
    const r = await connect.POST({
      request: req("POST", "/x", "viewer-a1", { siteUrl: "faithinhumanity.ch", key: KEY_FALSCH }),
      params: { id: pid() },
    });
    const j = await r.json();
    expect(j.ok).toBe(false);
    expect(j.gespeichert).toBe(false);
    expect(j.test.error_code).toBe("ezr_auth_invalid");
    expect(j.test.hilfe).toMatch(/neuen Schlüssel/);
    expect(db.wp_connections).toHaveLength(0);
  });

  it("Plugin fehlt bzw. Firewall: verständliche Codes", async () => {
    const r1 = await connect.POST({
      request: req("POST", "/x", "viewer-a1", { siteUrl: "https://kein-plugin.ch", key: KEY }),
      params: { id: pid() },
    });
    expect((await r1.json()).test.error_code).toBe("ezr_plugin_missing");
    const r2 = await connect.POST({
      request: req("POST", "/x", "viewer-a1", { siteUrl: "https://waf.ch", key: KEY }),
      params: { id: pid() },
    });
    const j2 = await r2.json();
    expect(j2.test.error_code).toBe("ezr_blocked");
    expect(j2.gespeichert).toBe(true); // Schlüssel evtl. gültig → behalten
    expect(db.wp_connections[0].status).toBe("aktion_noetig");
  });

  it("http:// wird abgelehnt", async () => {
    const r = await connect.POST({
      request: req("POST", "/x", "viewer-a1", { siteUrl: "http://faithinhumanity.ch", key: KEY }),
      params: { id: pid() },
    });
    expect(r.status).toBe(400);
  });

  it("richtiger Schlüssel: verbunden, verschlüsselt gespeichert, nie zurückgegeben", async () => {
    wpCalls.length = 0;
    const r = await connect.POST({
      request: req("POST", "/x", "viewer-a1", { siteUrl: "https://faithinhumanity.ch/", key: KEY }),
      params: { id: pid() },
    });
    const text = await r.text();
    const j = JSON.parse(text);
    expect(j.ok).toBe(true);
    expect(j.wordpress.status).toBe("verbunden");
    expect(j.wordpress.plugin_version).toBe("2.0.0");
    expect(text).not.toContain(KEY);
    expect(wpCalls).toEqual([
      "GET faithinhumanity.ch/wp-json/ezyrank/v1/health",
      "GET faithinhumanity.ch/wp-json/ezyrank/v1/capabilities",
      "POST faithinhumanity.ch/wp-json/ezyrank/v1/test",
    ]);
    expect(db.wp_connections).toHaveLength(1);
    expect(db.wp_connections[0].key_enc).toMatch(/^enc:/);
    expect(db.wp_connections[0].key_enc).not.toContain(KEY);

    const g = await projects.GET({
      request: req("GET", `/api/blog/projects?clientId=${K_A1}`, "viewer-a1"),
    });
    const gt = await g.text();
    expect(JSON.parse(gt).project.wordpress.status).toBe("verbunden");
    expect(gt).not.toContain("key_enc");
  });

  it("erneuter Test nutzt den gespeicherten Schlüssel", async () => {
    const r = await test.POST({ request: req("POST", "/x", "viewer-a1"), params: { id: pid() } });
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(db.blog_events.map((e) => e.type)).toContain("wp.test_ok");
  });
});

describe("Blog-Autopilot: reine Funktionen", () => {
  it("blogZugriffErlaubt", () => {
    expect(blogZugriffErlaubt({ role: null, zugewiesen: true, flag: true }).ok).toBe(false);
    expect(blogZugriffErlaubt({ role: "viewer", zugewiesen: false, flag: true }).ok).toBe(false);
    expect(blogZugriffErlaubt({ role: "member", zugewiesen: false, flag: true }).ok).toBe(false);
    expect(blogZugriffErlaubt({ role: "viewer", zugewiesen: true, flag: false }).ok).toBe(false);
    expect(blogZugriffErlaubt({ role: "viewer", zugewiesen: true, flag: true }).ok).toBe(true);
    expect(blogZugriffErlaubt({ role: "admin", zugewiesen: false, flag: true }).ok).toBe(true);
  });
  it("normalisiereDomain", () => {
    expect(normalisiereDomain("https://www.FaithInHumanity.ch/blog?x=1")).toBe(
      "faithinhumanity.ch",
    );
    expect(normalisiereDomain("kein domain")).toBe("");
  });
  it("ordneFehler / schluesselVerwerfen / Schlüsselformat", () => {
    expect(ordneFehler(403, { code: "ezr_scope_missing" }, "application/json")).toBe(
      "ezr_scope_missing",
    );
    expect(ordneFehler(403, null, "text/html")).toBe("ezr_blocked");
    expect(ordneFehler(404, null, "text/html")).toBe("ezr_plugin_missing");
    expect(ordneFehler(429, null, "")).toBe("ezr_rate_limited");
    expect(ordneFehler(401, { code: "rest_not_logged_in" }, "application/json")).toBe(
      "ezr_blocked",
    );
    expect(ordneFehler(401, { code: "ezr_auth_invalid" }, "application/json")).toBe(
      "ezr_auth_invalid",
    );
    expect(schluesselVerwerfen("ezr_auth_invalid")).toBe(true);
    expect(schluesselVerwerfen("ezr_blocked")).toBe(false);
    expect(EZR_KEY_RE.test(KEY)).toBe(true);
    expect(EZR_KEY_RE.test("ezr_kurz")).toBe(false);
  });
});

describe("Blog-Autopilot Phase 2: Onboarding-Daten", () => {
  const pid = () => db.blog_projects[0].id;
  const p = (u: string, body: any) =>
    projekt.PATCH({
      request: req("PATCH", `/api/blog/projects/${pid()}`, u, body),
      params: { id: pid() },
    });

  it("Schritte 3–5 speichern, unbekannte Felder abgelehnt", async () => {
    const ok = await p("viewer-a1", {
      name: "Faith in Humanity",
      audiences: ["Spenderinnen in der Schweiz"],
      tone: "gespraechig",
      cta_blocks: [{ label: "Jetzt spenden", url: "https://faithinhumanity.ch/spenden" }],
      excluded_domains: ["https://www.Beispiel.ch/x"],
      onboarding_step: 4,
    });
    expect(ok.status).toBe(200);
    const j = await ok.json();
    expect(j.project.tone).toBe("gespraechig");
    expect(j.project.excluded_domains).toEqual(["beispiel.ch"]);
    expect(j.project.cta_blocks[0].position).toBe("end");
    expect(JSON.stringify(j)).not.toMatch(/key_enc/);

    expect((await p("viewer-a1", { status: "active" })).status).toBe(400);
    expect((await p("viewer-a1", { client_id: K_B })).status).toBe(400);
    expect(
      (await p("viewer-a1", { cta_blocks: [{ label: "x", url: "http://unsicher.ch" }] })).status,
    ).toBe(400);
  });

  it("Kontingent nur für Ezy One, fremde Org 404", async () => {
    expect((await p("viewer-a1", { articles_per_month: 20 })).status).toBe(403);
    const a = await p("admin-a", { articles_per_month: 4 });
    expect(a.status).toBe(200);
    expect(db.blog_projects[0].articles_per_month).toBe(4);
    expect((await p("owner-b", { name: "fremd" })).status).toBe(404);
    expect((await p(undefined as any, { name: "x" })).status).toBe(401);
  });

  it("Mitbewerber: Liste setzen, eigene Domain ignoriert, ungültige abgelehnt", async () => {
    db.blog_competitors.push({
      id: crypto.randomUUID(),
      project_id: pid(),
      domain: "ki-fund.ch",
      source: "ki",
      validated: false,
    });
    const put = (u: string, domains: string[]) =>
      comps.PUT({ request: req("PUT", "/x", u, { domains }), params: { id: pid() } });
    const r = await put("viewer-a1", ["ki-fund.ch", "https://www.Neu.ch", "faithinhumanity.ch"]);
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.competitors.map((c: any) => c.domain).sort()).toEqual(["ki-fund.ch", "neu.ch"]);
    expect(j.competitors.find((c: any) => c.domain === "ki-fund.ch").source).toBe("ki");
    expect(j.competitors.find((c: any) => c.domain === "neu.ch").source).toBe("manuell");
    expect((await put("viewer-a1", ["kein domain"])).status).toBe(400);
    await put("viewer-a1", ["neu.ch"]);
    expect(db.blog_competitors.map((c) => c.domain)).toEqual(["neu.ch"]);
    expect((await put("owner-b", [])).status).toBe(404);
  });

  it("Schreibregeln: anlegen ohne Duplikat, Standard bleibt an", async () => {
    const post = (u: string, body: any) =>
      rules.POST({ request: req("POST", "/x", u, body), params: { id: pid() } });
    const a = await (await post("viewer-a1", { rule: "Immer du-Form verwenden." })).json();
    expect(a.created).toBe(true);
    const b = await (await post("viewer-a1", { rule: "immer du-form verwenden." })).json();
    expect(b.created).toBe(false);
    expect((await post("viewer-a1", { rule: "x", source: "agentur" })).status).toBe(400);
    expect((await post("viewer-a1", { rule: "Agentur-Regel", source: "agentur" })).status).toBe(
      403,
    );

    const std = db.writing_rules.find((w) => w.project_id === pid() && w.source === "standard");
    const aus = (u: string, id: string, active: boolean) =>
      rule.PATCH({ request: req("PATCH", "/x", u, { active }), params: { id } });
    expect((await aus("viewer-a1", std.id, false)).status).toBe(409);
    expect((await aus("viewer-a1", a.rule.id, false)).status).toBe(200);
    expect(db.writing_rules.find((w) => w.id === a.rule.id).active).toBe(false);
    expect((await aus("owner-b", a.rule.id, true)).status).toBe(404);
  });

  it("Ereignisse: nur erlaubte Typen", async () => {
    const ev = (body: any) =>
      events.POST({ request: req("POST", "/x", "viewer-a1", body), params: { id: pid() } });
    expect((await ev({ type: "onboarding.step_viewed", payload: { step: 3 } })).status).toBe(200);
    expect((await ev({ type: "wp.connected", payload: {} })).status).toBe(400);
    expect((await ev({ type: "onboarding.step_viewed", payload: { evil: "x" } })).status).toBe(400);
    expect(db.blog_events.some((e) => e.type === "onboarding.step_viewed")).toBe(true);
  });
});
