// Mehrfach-Organisationen durchgaengig (13.09.2026).
// Nutzer «multi-ab» ist in Organisation A ADMIN und in Organisation B MEMBER.
// Beweise ueber die ECHTEN Route-Handler (In-Memory-Supabase, agent-service/
// Live-Checks per fetch-Double):
//  - ohne aktive Organisation: 409 (mehrdeutig), nie stillschweigend die
//    hoechste Rolle irgendeiner Org
//  - mit aktiver Organisation: KEIN 409 mehr; Rolle gilt EXAKT je Org
//    (A: Admin-Routen erlaubt, B: 403 auf Admin-Routen, aber Member-Routen ok)
//  - fremde/unbekannte aktive Org: 403
//  - Browser-Seite: waehleAktiveOrg + authedFetch (Bearer + X-Ezy-Active-Org)
import { describe, it, expect, beforeAll, vi } from "vitest";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORG_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // keine Mitgliedschaft
const KUNDE_A = "11111111-1111-4111-8111-111111111111";
const KUNDE_B = "22222222-2222-4222-8222-222222222222";

const users: Record<string, { org: string; role: string }[]> = {
  "multi-ab": [
    { org: ORG_A, role: "admin" },
    { org: ORG_B, role: "member" },
  ],
  "owner-b": [{ org: ORG_B, role: "owner" }],
  "solo-a": [{ org: ORG_A, role: "member" }],
};

const db: Record<string, any[]> = {
  app_users: Object.entries(users).flatMap(([uid, ms]) =>
    ms.map((m) => ({ id: `${uid}@${m.org}`, user_id: uid, organization_id: m.org, role: m.role })),
  ),
  organizations: [
    { id: ORG_A, name: "Org A" },
    { id: ORG_B, name: "Org B" },
  ],
  clients: [
    { id: KUNDE_A, organization_id: ORG_A, name: "Kunde A", domain: "a.ch" },
    { id: KUNDE_B, organization_id: ORG_B, name: "Kunde B", domain: "b.ch" },
  ],
};

// Robuster In-Memory-Builder: bekannte Ketten werden ausgewertet, alle
// uebrigen Query-Methoden sind No-ops (chainbar) — unbekannte Tabellen
// liefern leere Ergebnisse.
function builder(table: string) {
  const st: any = { filters: [] as ((r: any) => boolean)[], single: false, limit: 0 };
  const api: any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "then")
          return (resolve: any) => {
            let rows = (db[table] || []).filter((r) => st.filters.every((f: any) => f(r)));
            if (st.insert) {
              for (const r of st.insert)
                db[table] = [...(db[table] || []), { id: crypto.randomUUID(), ...r }];
              return resolve({
                data: st.single ? st.insert[0] : st.insert,
                error: null,
                count: null,
              });
            }
            if (st.update) for (const r of rows) Object.assign(r, st.update);
            if (st.limit) rows = rows.slice(0, st.limit);
            const data = st.single ? (rows.length === 1 ? rows[0] : null) : rows;
            resolve({ data, error: null, count: rows.length });
          };
        if (prop === "eq")
          return (k: string, v: any) => (st.filters.push((r: any) => r[k] === v), api);
        if (prop === "in")
          return (k: string, arr: any[]) => (st.filters.push((r: any) => arr.includes(r[k])), api);
        if (prop === "neq")
          return (k: string, v: any) => (st.filters.push((r: any) => r[k] !== v), api);
        if (prop === "limit") return (n: number) => ((st.limit = n), api);
        if (prop === "maybeSingle" || prop === "single") return () => ((st.single = true), api);
        if (prop === "insert")
          return (rows: any) => ((st.insert = Array.isArray(rows) ? rows : [rows]), api);
        if (prop === "update") return (patch: any) => ((st.update = patch), api);
        return () => api; // select/order/gte/lte/is/not/range/delete/upsert/...
      },
    },
  );
  return api;
}
const supabaseAdminStub = {
  from: (t: string) => builder(t),
  auth: {
    admin: {
      getUserById: async (id: string) => ({ data: { user: { id, email: `${id}@test.ch` } } }),
      listUsers: async () => ({ data: { users: [] } }),
      inviteUserByEmail: async () => ({ data: null, error: { message: "nicht im Test" } }),
    },
  },
};
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: supabaseAdminStub,
  // API-Key-Umstellung (21.09.): live.status liest den Key-Typ — im Test neutral.
  supabaseSecretKey: () => "test-secret",
  supabaseKeyTyp: () => ({ secret: "legacy_service_role", publishable: "legacy_anon" }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (_u: string, _k: string, opts: any) => ({
    auth: {
      getUser: async () => {
        const h = String(opts?.global?.headers?.Authorization || "");
        const id = h.startsWith("Bearer ") ? h.slice(7) : "";
        return { data: { user: users[id] ? { id } : null } };
      },
    },
    from: (t: string) => builder(t),
  }),
}));
// Browser-Client-Double fuer authedFetch (Session-Token) — als Factory, damit
// vi.mock-Hoisting keine Variablen von aussen braucht.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: "browser-jwt" } } }) },
  },
}));

// Aussenwelt (agent-service, Live-Checks): jeder Aufruf antwortet 200.
const aussen: Array<{ url: string; headers: Record<string, string> }> = [];
vi.stubGlobal("fetch", async (input: any, init: any = {}) => {
  const h: Record<string, string> = {};
  new Headers(init.headers || {}).forEach((v, k) => (h[k] = v));
  aussen.push({ url: String(input), headers: h });
  return new Response(JSON.stringify({ ok: true, runs: [], status: "ok" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

type H = Record<string, (a: { request: Request }) => Promise<Response>>;
let readiness: H, audit: H, team: H, live: H, reakt: H, runs: H;
let firstParty: any;

function req(
  method: string,
  path: string,
  o: { user?: string; org?: string | null; body?: any } = {},
) {
  return new Request(`http://test${path}`, {
    method,
    headers: {
      ...(o.user ? { authorization: `Bearer ${o.user}` } : {}),
      ...(o.org ? { "x-ezy-active-org": o.org } : {}),
      ...(o.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
  });
}

beforeAll(async () => {
  process.env.SUPABASE_URL = "http://stub.local";
  process.env.SUPABASE_ANON_KEY = "stub-anon";
  process.env.AGENT_BASE_URL = "http://agent.stub";
  process.env.AGENT_SHARED_SECRET = "stub-shared";
  readiness = (await import("../routes/api/admin.client-readiness")).Route.options.server!
    .handlers as any;
  audit = (await import("../routes/api/admin.audit-log")).Route.options.server!.handlers as any;
  team = (await import("../routes/api/admin.team")).Route.options.server!.handlers as any;
  live = (await import("../routes/api/live.status")).Route.options.server!.handlers as any;
  reakt = (await import("../routes/api/agent.reakt")).Route.options.server!.handlers as any;
  runs = (await import("../routes/api/agent.runs")).Route.options.server!.handlers as any;
  firstParty = (await import("../routes/api/admin.first-party-connection")).Route.options.server!
    .handlers as any;
});

const nichtGesperrt = (s: number) => ![401, 403, 409].includes(s);

describe("multi-ab (Admin in A, Member in B): Server-Routen", () => {
  it("ohne aktive Organisation -> 409 auf allen Team-Routen (nie stillschweigend Admin)", async () => {
    const r1 = await readiness.GET({
      request: req("GET", "/api/admin/client-readiness?all=1", { user: "multi-ab" }),
    });
    const r2 = await audit.GET({
      request: req("GET", "/api/admin/audit-log?limit=5", { user: "multi-ab" }),
    });
    const r3 = await team.POST({
      request: req("POST", "/api/admin/team", { user: "multi-ab", body: { action: "list" } }),
    });
    const r4 = await live.GET({ request: req("GET", "/api/live/status", { user: "multi-ab" }) });
    const r5 = await runs.GET({ request: req("GET", "/api/agent/runs", { user: "multi-ab" }) });
    for (const r of [r1, r2, r3, r4, r5]) expect(r.status).toBe(409);
  });

  it("aktive Org A (Admin): Admin-Routen erlaubt, KEIN 409", async () => {
    const r1 = await readiness.GET({
      request: req("GET", "/api/admin/client-readiness?all=1", { user: "multi-ab", org: ORG_A }),
    });
    const r2 = await audit.GET({
      request: req("GET", "/api/admin/audit-log?limit=5", { user: "multi-ab", org: ORG_A }),
    });
    const r3 = await team.POST({
      request: req("POST", "/api/admin/team", {
        user: "multi-ab",
        org: ORG_A,
        body: { action: "list" },
      }),
    });
    const r4 = await live.GET({
      request: req("GET", "/api/live/status", { user: "multi-ab", org: ORG_A }),
    });
    for (const r of [r1, r2, r3, r4]) expect(nichtGesperrt(r.status)).toBe(true);
    // Team-Liste zeigt NUR Mitglieder von Org A
    const j3 = await r3.json();
    const ids = (j3.users || []).map((m: any) => m.userId);
    expect(ids).toContain("multi-ab");
    expect(ids).toContain("solo-a");
    expect(ids).not.toContain("owner-b");
  });

  it("aktive Org B (Member): Admin-Routen 403 — obwohl er in A Admin ist", async () => {
    const r1 = await readiness.GET({
      request: req("GET", "/api/admin/client-readiness?all=1", { user: "multi-ab", org: ORG_B }),
    });
    const r2 = await audit.GET({
      request: req("GET", "/api/admin/audit-log?limit=5", { user: "multi-ab", org: ORG_B }),
    });
    const r3 = await team.POST({
      request: req("POST", "/api/admin/team", {
        user: "multi-ab",
        org: ORG_B,
        body: { action: "list" },
      }),
    });
    const r4 = await live.GET({
      request: req("GET", "/api/live/status", { user: "multi-ab", org: ORG_B }),
    });
    for (const r of [r1, r2, r3, r4]) expect(r.status).toBe(403);
  });

  it("aktive Org B (Member): Member-Routen weiterhin erlaubt, KEIN 409", async () => {
    const r = await runs.GET({
      request: req("GET", "/api/agent/runs", { user: "multi-ab", org: ORG_B }),
    });
    expect(nichtGesperrt(r.status)).toBe(true);
    const g = await reakt.GET({
      request: req("GET", "/api/agent/reakt", { user: "multi-ab", org: ORG_B }),
    });
    expect(nichtGesperrt(g.status)).toBe(true);
  });

  it("agent/reakt: Zeitplan-Schalter (POST) nur als Admin der AKTIVEN Org", async () => {
    const inB = await reakt.POST({
      request: req("POST", "/api/agent/reakt", {
        user: "multi-ab",
        org: ORG_B,
        body: { enabled: false },
      }),
    });
    expect(inB.status).toBe(403);
    const inA = await reakt.POST({
      request: req("POST", "/api/agent/reakt", {
        user: "multi-ab",
        org: ORG_A,
        body: { enabled: false },
      }),
    });
    expect(nichtGesperrt(inA.status)).toBe(true);
  });

  it("fremde/unbekannte aktive Org -> 403, nie Daten", async () => {
    const r1 = await readiness.GET({
      request: req("GET", "/api/admin/client-readiness?all=1", { user: "multi-ab", org: ORG_C }),
    });
    const r2 = await runs.GET({
      request: req("GET", "/api/agent/runs", { user: "multi-ab", org: ORG_C }),
    });
    expect(r1.status).toBe(403);
    expect(r2.status).toBe(403);
  });

  it("Ein-Org-Nutzer braucht keinen Header (implizite Wahl) und bleibt in seiner Rolle", async () => {
    const r = await runs.GET({ request: req("GET", "/api/agent/runs", { user: "solo-a" }) });
    expect(nichtGesperrt(r.status)).toBe(true);
    const admin = await readiness.GET({
      request: req("GET", "/api/admin/client-readiness?all=1", { user: "solo-a" }),
    });
    expect(admin.status).toBe(403); // member, kein Admin
  });
});

describe("Browser: waehleAktiveOrg (AuthProvider-Logik)", () => {
  it("mehrere Orgs ohne gespeicherte Wahl -> auswahlNoetig, keine Rolle", async () => {
    const { waehleAktiveOrg } = await import("../lib/active-org");
    const ms = [
      { organizationId: ORG_A, role: "admin" as const },
      { organizationId: ORG_B, role: "member" as const },
    ];
    const w = waehleAktiveOrg(ms, null);
    expect(w).toEqual({ organizationId: null, role: null, auswahlNoetig: true });
  });

  it("gespeicherte gueltige Wahl -> Rolle EXAKT dieser Org", async () => {
    const { waehleAktiveOrg } = await import("../lib/active-org");
    const ms = [
      { organizationId: ORG_A, role: "admin" as const },
      { organizationId: ORG_B, role: "member" as const },
    ];
    expect(waehleAktiveOrg(ms, ORG_B)).toEqual({
      organizationId: ORG_B,
      role: "member",
      auswahlNoetig: false,
    });
    expect(waehleAktiveOrg(ms, ORG_A)).toEqual({
      organizationId: ORG_A,
      role: "admin",
      auswahlNoetig: false,
    });
  });

  it("gespeicherte Wahl ohne Mitgliedschaft (Login-Revalidierung) -> verworfen", async () => {
    const { waehleAktiveOrg } = await import("../lib/active-org");
    const ms = [
      { organizationId: ORG_A, role: "admin" as const },
      { organizationId: ORG_B, role: "member" as const },
    ];
    expect(waehleAktiveOrg(ms, ORG_C).auswahlNoetig).toBe(true);
    expect(waehleAktiveOrg(ms, "kein-uuid").auswahlNoetig).toBe(true);
    // genau eine Mitgliedschaft: implizit, auch bei ungueltiger Speicherung
    expect(waehleAktiveOrg([ms[1]], ORG_C)).toEqual({
      organizationId: ORG_B,
      role: "member",
      auswahlNoetig: false,
    });
    expect(waehleAktiveOrg([], ORG_A)).toEqual({
      organizationId: null,
      role: null,
      auswahlNoetig: false,
    });
  });
});

describe("Browser: authedFetch", () => {
  it("sendet Bearer + X-Ezy-Active-Org an eigene API-Routen; explizite Header gewinnen", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    const { speichereAktiveOrg } = await import("../lib/active-org");
    const { authedFetch } = await import("../lib/authed-fetch");

    speichereAktiveOrg(ORG_B);
    aussen.length = 0;
    await authedFetch("/api/admin/team", {
      method: "POST",
      body: JSON.stringify({ action: "list" }),
    });
    expect(aussen[0].headers.authorization).toBe("Bearer browser-jwt");
    expect(aussen[0].headers["x-ezy-active-org"]).toBe(ORG_B);
    expect(aussen[0].headers["content-type"]).toBe("application/json");

    // Wechsel der aktiven Org wirkt sofort auf den naechsten Aufruf.
    speichereAktiveOrg(ORG_A);
    await authedFetch("/api/agent/runs");
    expect(aussen[1].headers["x-ezy-active-org"]).toBe(ORG_A);

    // Explizite Header werden nicht ueberschrieben.
    await authedFetch("/api/x", {
      headers: { authorization: "Bearer eigener", "x-ezy-active-org": ORG_C },
    });
    expect(aussen[2].headers.authorization).toBe("Bearer eigener");
    expect(aussen[2].headers["x-ezy-active-org"]).toBe(ORG_C);

    // Ohne gespeicherte Wahl: kein Org-Header (Ein-Org-Nutzer brauchen keinen).
    speichereAktiveOrg(null);
    await authedFetch("/api/agent/runs");
    expect(aussen[3].headers["x-ezy-active-org"]).toBeUndefined();
  });
});

// Multi-Org abschliessen (13.09.2026): Browser-Aufrufstellen Ende-zu-Ende —
// authedFetch/ezyFetch → ECHTE Route-Handler. Nutzer multi-ab (Admin in A,
// Member in B) wechselt die aktive Organisation; jeder relevante Admin-Aufruf
// (Readiness wie im ServicesPanel, Audit-Log, Team) traegt die aktive Org und
// wird exakt in DIESER Org bewertet.
describe("Browser → Server: Admin-Aufrufe senden die aktive Organisation (multi-ab)", () => {
  const dispatch = async (input: any, init: any = {}) => {
    const url = new URL(String(input), "http://test");
    // Aufrufe der Handler an Fremdsysteme (agent-service, Live-Checks) laufen
    // ueber denselben fetch — sie sind keine Browser-Aufrufe und werden nicht
    // aufgezeichnet, sondern wie bisher mit 200 beantwortet.
    if (!url.pathname.startsWith("/api/"))
      return new Response(JSON.stringify({ ok: true, runs: [], status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const request = new Request(url.toString(), init);
    const h: Record<string, string> = {};
    request.headers.forEach((v, k) => (h[k] = v));
    aussen.push({ url: url.pathname, headers: h });
    const method = (init.method || "GET").toUpperCase();
    if (url.pathname === "/api/admin/client-readiness") return readiness.GET({ request });
    if (url.pathname === "/api/admin/audit-log") return audit.GET({ request });
    if (url.pathname === "/api/admin/team" && method === "POST") return team.POST({ request });
    if (url.pathname === "/api/agent/runs") return runs.GET({ request });
    return new Response("not found", { status: 404 });
  };

  async function browser(org: string | null) {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    // Session-Token = User-ID (siehe createClient-Double oben).
    vi.doMock("@/integrations/supabase/client", () => ({
      supabase: {
        auth: { getSession: async () => ({ data: { session: { access_token: "multi-ab" } } }) },
      },
    }));
    vi.resetModules();
    const { speichereAktiveOrg } = await import("../lib/active-org");
    speichereAktiveOrg(org);
    const { authedFetch } = await import("../lib/authed-fetch");
    const { ezyFetch } = await import("../ezy/data/api");
    vi.stubGlobal("fetch", dispatch);
    return { authedFetch, ezyFetch };
  }

  const ADMIN_AUFRUFE = (clientId: string) => [
    { name: "ServicesPanel Readiness", pfad: `/api/admin/client-readiness?client=${clientId}` },
    { name: "Kundenliste Readiness", pfad: "/api/admin/client-readiness?all=1" },
    { name: "Audit-Log", pfad: `/api/admin/audit-log?client=${clientId}&limit=80` },
  ];

  it("aktive Org A (Admin): jeder Admin-Aufruf traegt X-Ezy-Active-Org=A und ist erlaubt", async () => {
    const { authedFetch, ezyFetch } = await browser(ORG_A);
    aussen.length = 0;
    for (const a of ADMIN_AUFRUFE(KUNDE_A)) {
      const r = await authedFetch(a.pfad);
      expect({ name: a.name, status: r.status }).toEqual({ name: a.name, status: 200 });
    }
    const t = await ezyFetch("/api/admin/team", {
      method: "POST",
      body: JSON.stringify({ action: "list" }),
    });
    expect(t.status).toBe(200);
    for (const call of aussen) {
      expect(call.headers["x-ezy-active-org"]).toBe(ORG_A);
      expect(call.headers.authorization).toBe("Bearer multi-ab");
    }
    expect(aussen.length).toBe(ADMIN_AUFRUFE(KUNDE_A).length + 1);
  });

  it("Wechsel auf Org B (Member): dieselben Aufrufe tragen B und werden mit 403 abgewiesen", async () => {
    const { authedFetch, ezyFetch } = await browser(ORG_B);
    aussen.length = 0;
    for (const a of ADMIN_AUFRUFE(KUNDE_B)) {
      const r = await authedFetch(a.pfad);
      expect({ name: a.name, status: r.status }).toEqual({ name: a.name, status: 403 });
    }
    const t = await ezyFetch("/api/admin/team", {
      method: "POST",
      body: JSON.stringify({ action: "list" }),
    });
    expect(t.status).toBe(403);
    // Member-Route bleibt in B erlaubt — die Org kommt an, nur die Rolle greift.
    const m = await ezyFetch("/api/agent/runs");
    expect(nichtGesperrt(m.status)).toBe(true);
    for (const call of aussen) expect(call.headers["x-ezy-active-org"]).toBe(ORG_B);
  });

  it("ohne gewaehlte Org: 409 (mehrdeutig) statt stillschweigend eine Org", async () => {
    const { authedFetch } = await browser(null);
    aussen.length = 0;
    const r = await authedFetch("/api/admin/client-readiness?all=1");
    expect(r.status).toBe(409);
    expect(aussen[0].headers["x-ezy-active-org"]).toBeUndefined();
  });
});

// First-Party-KPIs Phase 2a (22.09.2026): Verbindungs-/Flag-Route ist strikt
// mandantengebunden — Kunde muss zur AKTIVEN Organisation gehoeren, nur
// Owner/Admin; Flag-Schreiben merged clients.metadata statt zu ueberschreiben.
describe("first-party-connection (Owner/Admin, Kunde nur in aktiver Org)", () => {
  const fp = (user: string, org: string | null, body: any) =>
    firstParty.POST({
      request: req("POST", "/api/admin/first-party-connection", { user, org, body }),
    });

  it("Admin A: status fuer Kunde A ok, Flag Default AUS, kein Service Account → OAuth-Fallback", async () => {
    const r = await fp("multi-ab", ORG_A, { clientId: KUNDE_A, action: "status" });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.flag).toBe(false);
    expect(j.serviceAccount.konfiguriert).toBe(false);
    expect(j.client.id).toBe(KUNDE_A);
  });

  it("Admin A: Kunde B (fremde Org) → 404, nie Daten", async () => {
    const r = await fp("multi-ab", ORG_A, { clientId: KUNDE_B, action: "status" });
    expect(r.status).toBe(404);
  });

  it("Member in B → 403; ohne aktive Org → 409; Owner B fuer Kunde A → 404", async () => {
    expect((await fp("multi-ab", ORG_B, { clientId: KUNDE_B, action: "status" })).status).toBe(403);
    expect((await fp("multi-ab", null, { clientId: KUNDE_A, action: "status" })).status).toBe(409);
    expect((await fp("owner-b", ORG_B, { clientId: KUNDE_A, action: "status" })).status).toBe(404);
  });

  it("Flag setzen merged metadata (andere Schluessel bleiben) und ist danach im Status sichtbar", async () => {
    const kunde = db.clients.find((c) => c.id === KUNDE_A)!;
    kunde.metadata = { status: "active", seo_autonom: true };
    const r = await fp("multi-ab", ORG_A, { clientId: KUNDE_A, action: "flag", enabled: true });
    expect(r.status).toBe(200);
    expect((await r.json()).flag).toBe(true);
    expect(kunde.metadata).toEqual({ status: "active", seo_autonom: true, first_party_kpi: true });
    const s = await (await fp("multi-ab", ORG_A, { clientId: KUNDE_A, action: "status" })).json();
    expect(s.flag).toBe(true);
    expect((await fp("multi-ab", ORG_A, { clientId: "nope", action: "status" })).status).toBe(400);
  });
});
