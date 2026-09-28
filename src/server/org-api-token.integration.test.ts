// Org-weite API-Tokens fuer die Read-API (ChatGPT, 28.09.2026).
// ECHTE Handler (admin.ingest-credentials, admin.rank-snapshot) und ECHTES
// authenticateReadApi gegen eine In-Memory-Supabase mit 2 Organisationen.
// Beweise:
//  - read_api-Token wird org-weit (client_id null) erzeugt, Klartext genau einmal
//  - nur Owner/Admin der eigenen Org; interner Admin-Pfad gesperrt
//  - rotate/revoke nur innerhalb der eigenen Organisation
//  - authenticateReadApi: gueltig / abgelaufen / widerrufen / falscher Praefix /
//    Kunden-Token → 403 / Admin-Secret → 401 / Rate-Limit → 429 mit Retry-After
//  - read_api-Token auf Kunden-Routen (rank-snapshot) → 401
//  - logReadApi schreibt gehashte IP, nie den Klartext; fail-soft
//  - rank-snapshot schreibt rank_daily (onConflict client_id,date,keyword)
import { describe, it, expect, beforeAll, vi } from "vitest";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const KUNDE_A = "11111111-1111-4111-8111-111111111111";

const users: Record<string, { org: string; role: string }[]> = {
  "admin-a": [{ org: ORG_A, role: "admin" }],
  "member-a": [{ org: ORG_A, role: "member" }],
  "admin-b": [{ org: ORG_B, role: "owner" }],
};

const db: Record<string, any[]> = {
  app_users: Object.entries(users).flatMap(([uid, ms]) =>
    ms.map((m) => ({ user_id: uid, organization_id: m.org, role: m.role })),
  ),
  organizations: [{ id: ORG_A }, { id: ORG_B }],
  clients: [{ id: KUNDE_A, organization_id: ORG_A, name: "Hotel Ava", domain: "hotel-ava.ch" }],
  ingest_credentials: [],
  read_api_log: [],
  audit_runs: [],
  rank_daily: [],
};
const upserts: { table: string; rows: any[]; opts: any }[] = [];
let logFehler = false;

function projiziere(row: any, cols: string[] | null) {
  if (!row || !cols) return row;
  const out: any = {};
  for (const c of cols) if (c in row) out[c] = row[c];
  return out;
}
function builder(table: string) {
  const st: any = { filters: [] as ((r: any) => boolean)[], single: false, cols: null, limit: 0 };
  const api: any = {
    select(spec?: string) {
      const s = String(spec || "*").trim();
      st.cols =
        s === "*"
          ? null
          : s
              .split(",")
              .map((c) => c.trim())
              .filter(Boolean);
      return api;
    },
    eq(k: string, v: any) {
      const m = /^(\w+)->>(\w+)$/.exec(k);
      st.filters.push((r: any) => (m ? r[m[1]]?.[m[2]] === v : r[k] === v));
      return api;
    },
    order: () => api,
    limit: (n: number) => ((st.limit = n), api),
    maybeSingle: () => ((st.single = true), api),
    single: () => ((st.single = true), api),
    insert(rows: any) {
      st.insert = Array.isArray(rows) ? rows : [rows];
      return api;
    },
    upsert(rows: any, opts: any) {
      st.upsert = Array.isArray(rows) ? rows : [rows];
      upserts.push({ table, rows: st.upsert, opts });
      return api;
    },
    update(patch: any) {
      st.update = patch;
      return api;
    },
    then(resolve: any) {
      if (st.upsert) {
        db[table].push(...st.upsert);
        return resolve({ data: null, error: null });
      }
      if (st.insert) {
        if (table === "read_api_log" && logFehler)
          return resolve({ data: null, error: { message: "db down" } });
        const out = st.insert.map((r: any) => ({ id: r.id ?? crypto.randomUUID(), ...r }));
        db[table].push(...out);
        return resolve({ data: st.single ? out[0] : out, error: null });
      }
      let rows = (db[table] || []).filter((r) => st.filters.every((f: any) => f(r)));
      if (st.update) {
        for (const r of rows) Object.assign(r, st.update);
        return resolve({ data: null, error: null });
      }
      if (st.limit) rows = rows.slice(0, st.limit);
      const p = rows.map((x) => projiziere(x, st.cols));
      resolve({ data: st.single ? (p.length === 1 ? p[0] : null) : p, error: null });
    },
  };
  return api;
}

// In-Memory-Spiegel der Lifecycle-RPCs (Migration 20260928100000).
async function rpcMock(fn: string, a: any = {}): Promise<{ data: any; error: any }> {
  const rows = db.ingest_credentials;
  const P = (code: string, message: string) => ({ data: null, error: { code, message } });
  const passt = (x: any) =>
    x.id === a._credential_id &&
    (a._client_id
      ? x.client_id === a._client_id &&
        (!a._organization_id || x.organization_id === a._organization_id)
      : x.organization_id === a._organization_id &&
        x.client_id == null &&
        x.purpose === "read_api");
  if (fn === "ingest_credential_touch") {
    const r = rows.find((x) => x.id === a._credential_id);
    if (r) r.use_count = (r.use_count || 0) + 1;
    return { data: null, error: null };
  }
  if (fn === "ingest_credential_create") {
    if (a._purpose === "read_api") {
      if (a._client_id) return P("P0003", "read_api-Token sind org-weit");
      if (!db.organizations.some((o) => o.id === a._organization_id))
        return P("P0002", "Organisation nicht gefunden");
    } else if (
      !db.clients.some((c) => c.id === a._client_id && c.organization_id === a._organization_id)
    )
      return P("P0002", "Kunde nicht in dieser Organisation");
    const r = {
      id: crypto.randomUUID(),
      organization_id: a._organization_id,
      client_id: a._client_id ?? null,
      purpose: a._purpose,
      token_hash: a._token_hash,
      token_prefix: a._token_prefix,
      label: a._label ?? null,
      created_at: new Date().toISOString(),
      expires_at: a._expires_at ?? null,
      revoked_at: null,
      rotated_from: null,
      last_used_at: null,
      use_count: 0,
    };
    rows.push(r);
    return { data: r, error: null };
  }
  if (fn === "ingest_credential_rotate") {
    if (!a._client_id && !a._organization_id) return P("P0002", "Kunde oder Organisation");
    const alt = rows.find(passt);
    if (!alt) return P("P0002", "Credential nicht gefunden");
    if (alt.revoked_at) return P("P0003", "Widerrufen");
    const neu = {
      ...alt,
      id: crypto.randomUUID(),
      token_hash: a._token_hash,
      token_prefix: a._token_prefix,
      expires_at: a._expires_at ?? null,
      rotated_from: alt.id,
      use_count: 0,
    };
    rows.push(neu);
    alt.expires_at = a._grace_until;
    return { data: neu, error: null };
  }
  if (fn === "ingest_credential_revoke") {
    if (!a._client_id && !a._organization_id) return P("P0002", "Kunde oder Organisation");
    const r = rows.find(passt);
    if (!r) return P("P0002", "Credential nicht gefunden");
    r.revoked_at = r.revoked_at || new Date().toISOString();
    return { data: r, error: null };
  }
  return P("42883", `unbekannte Funktion ${fn}`);
}
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => builder(t), rpc: rpcMock },
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
  }),
}));

type Handlers = Record<string, (a: { request: Request }) => Promise<Response>>;
let creds: Handlers;
let snapshot: Handlers;
let ia: typeof import("./ingest-auth.server");
let rl: typeof import("./rate-limit.server");
const ADMIN = "internes-admin-secret";
let ipZaehler = 0;

function req(path: string, o: { bearer?: string; body?: any; ip?: string; stempel?: string } = {}) {
  const body = o.body !== undefined ? JSON.stringify(o.body) : undefined;
  return new Request(`http://test${path}`, {
    method: body !== undefined ? "POST" : "GET",
    headers: {
      ...(o.bearer ? { authorization: `Bearer ${o.bearer}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(o.stempel ? { "x-ezy-organization": o.stempel } : {}),
      // Jede Anfrage eigene IP — die 401-Bremse soll Einzeltests nicht stoeren.
      "x-forwarded-for": o.ip ?? `10.1.0.${++ipZaehler % 250}`,
    },
    body,
  });
}
const json = async (r: Response) => ({ status: r.status, j: await r.json() });
const erstelle = async (user: string, body: Record<string, unknown> = {}) =>
  json(
    await creds.POST({
      request: req("/api/admin/ingest-credentials", {
        bearer: user,
        body: { action: "create", purpose: "read_api", label: "chatgpt", ...body },
      }),
    }),
  );
const readApi = (token: string, ip?: string) =>
  ia.authenticateReadApi(req("/api/v1/rank-changes", { bearer: token, ip }));

let tokA = "";
let credA = "";

beforeAll(async () => {
  process.env.SUPABASE_URL = "http://stub.local";
  process.env.SUPABASE_ANON_KEY = "stub-anon";
  process.env.ADMIN_AUTOMATION_SECRET = ADMIN;
  creds = (await import("../routes/api/admin.ingest-credentials")).Route.options.server!
    .handlers as any;
  snapshot = (await import("../routes/api/admin.rank-snapshot")).Route.options.server!
    .handlers as any;
  ia = await import("./ingest-auth.server");
  rl = await import("./rate-limit.server");
  const a = await erstelle("admin-a");
  expect(a.status).toBe(200);
  tokA = a.j.token;
  credA = a.j.credential.id;
});

describe("Admin-Route: org-weite read_api-Tokens", () => {
  it("erzeugt ein org-weites Token (client_id null), Klartext nur in der Antwort", () => {
    expect(tokA).toMatch(/^ezyi_ra_[A-Za-z0-9_-]{43}$/);
    const row = db.ingest_credentials.find((c) => c.id === credA);
    expect(row.organization_id).toBe(ORG_A);
    expect(row.client_id).toBeNull();
    expect(row.purpose).toBe("read_api");
    expect(row.token_hash).toBe(ia.ingestTokenHash(tokA));
    expect(JSON.stringify(db)).not.toContain(tokA);
  });

  it("Liste liefert nie Klartext/Hash und nur die eigene Organisation + Log", async () => {
    await erstelle("admin-b", { label: "fremd" });
    const { status, j } = await json(
      await creds.GET({
        request: req("/api/admin/ingest-credentials?purpose=read_api", { bearer: "admin-a" }),
      }),
    );
    expect(status).toBe(200);
    expect(j.credentials.length).toBeGreaterThan(0);
    expect(Array.isArray(j.log)).toBe(true);
    for (const c of j.credentials) {
      expect(c.token_hash).toBeUndefined();
      expect(c.label).not.toBe("fremd");
    }
    expect(JSON.stringify(j)).not.toContain(tokA);
  });

  it("Member darf nicht; interner Admin-Pfad ist gesperrt", async () => {
    expect((await erstelle("member-a")).status).toBe(403);
    expect((await erstelle(ADMIN)).status).toBe(403);
    const liste = await creds.GET({
      request: req("/api/admin/ingest-credentials?purpose=read_api", { bearer: ADMIN }),
    });
    expect(liste.status).toBe(403);
  });

  it("read_api mit clientId → 400; Kunden-Zweck ohne clientId → 400", async () => {
    expect((await erstelle("admin-a", { clientId: KUNDE_A })).status).toBe(400);
    expect((await erstelle("admin-a", { purpose: "openai_ads" })).status).toBe(400);
  });

  it("Org B kann Token von Org A weder rotieren noch widerrufen", async () => {
    for (const action of ["rotate", "revoke"]) {
      const r = await creds.POST({
        request: req("/api/admin/ingest-credentials", {
          bearer: "admin-b",
          body: { action, credentialId: credA },
        }),
      });
      expect(r.status).toBe(404);
    }
    expect(db.ingest_credentials.find((c) => c.id === credA).revoked_at).toBeNull();
  });

  it("Rotieren liefert neuen Klartext einmal; altes Token laeuft nach Grace ab", async () => {
    const t = await erstelle("admin-a", { label: "rot" });
    const { status, j } = await json(
      await creds.POST({
        request: req("/api/admin/ingest-credentials", {
          bearer: "admin-a",
          body: { action: "rotate", credentialId: t.j.credential.id, graceDays: 0 },
        }),
      }),
    );
    expect(status).toBe(200);
    expect(j.token).toMatch(/^ezyi_ra_/);
    expect(j.token).not.toBe(t.j.token);
    expect(j.credential.client_id).toBeNull();
    expect(j.rotatedFrom).toBe(t.j.credential.id);
    expect(await readApi(t.j.token)).toBeInstanceOf(Response); // alt: abgelaufen
    const neu = await readApi(j.token);
    expect(neu).not.toBeInstanceOf(Response);
  });
});

describe("authenticateReadApi", () => {
  it("gueltiges Token → Organisation + Credential aus der DB-Zeile", async () => {
    const r = await readApi(tokA);
    expect(r).toEqual({ ok: true, organizationId: ORG_A, credentialId: credA });
  });

  it("abgelaufenes Token → 401", async () => {
    const t = await erstelle("admin-a", { label: "abl" });
    db.ingest_credentials.find((c) => c.id === t.j.credential.id).expires_at = new Date(
      Date.now() - 1000,
    ).toISOString();
    const r = (await readApi(t.j.token)) as Response;
    expect(r.status).toBe(401);
    expect((await r.json()).error).toMatch(/abgelaufen/);
  });

  it("widerrufenes Token → 401", async () => {
    const t = await erstelle("admin-a", { label: "wid" });
    const w = await creds.POST({
      request: req("/api/admin/ingest-credentials", {
        bearer: "admin-a",
        body: { action: "revoke", credentialId: t.j.credential.id },
      }),
    });
    expect(w.status).toBe(200);
    const r = (await readApi(t.j.token)) as Response;
    expect(r.status).toBe(401);
    expect((await r.json()).error).toMatch(/widerrufen/);
  });

  it("falscher Praefix / Muell / kein Token → 401", async () => {
    for (const t of ["sk-test", `ezyi_xx_${"a".repeat(43)}`, tokA.slice(0, -1), ""]) {
      const r = (await readApi(t)) as Response;
      expect(r.status).toBe(401);
    }
  });

  it("Admin-Secret wird fuer die Read-API NICHT akzeptiert", async () => {
    const r = (await readApi(ADMIN)) as Response;
    expect(r.status).toBe(401);
  });

  it("gueltiges Kunden-Token → 403; unbekanntes Kunden-Format → 401", async () => {
    const k = await json(
      await creds.POST({
        request: req("/api/admin/ingest-credentials", {
          bearer: "admin-a",
          body: { action: "create", clientId: KUNDE_A, purpose: "rank_snapshot" },
        }),
      }),
    );
    expect(k.status).toBe(200);
    expect(k.j.token).toMatch(/^ezyi_rs_/);
    const r = (await readApi(k.j.token)) as Response;
    expect(r.status).toBe(403);
    const unbekannt = (await readApi(ia.generateIngestToken("rank_snapshot").token)) as Response;
    expect(unbekannt.status).toBe(401);
  });

  it("read_api-Token auf der Kunden-Route rank-snapshot → 401 (purpose-gebunden)", async () => {
    const r = await snapshot.POST({
      request: req("/api/admin/rank-snapshot", {
        bearer: tokA,
        body: { clientId: KUNDE_A, organizationId: ORG_A },
      }),
    });
    expect(r.status).toBe(401);
  });

  it("Rate-Limit je Credential → 429 mit Retry-After", async () => {
    const t = await erstelle("admin-a", { label: "rl" });
    const id = t.j.credential.id;
    const jetzt = Date.now();
    for (let i = 0; i < rl.readApiLimiter.limit; i++) rl.readApiLimiter.hit(`cred:${id}`, jetzt);
    const r = (await readApi(t.j.token)) as Response;
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("Retry-After"))).toBeGreaterThan(0);
    // Andere Credentials sind nicht betroffen.
    expect(await readApi(tokA)).not.toBeInstanceOf(Response);
  });

  it("Default-Limit ist 120/min", () => {
    expect(rl.readApiLimiter.limit).toBe(Number(process.env.READ_API_RATE_PER_MIN || 120));
  });
});

describe("logReadApi", () => {
  it("schreibt eine Zeile mit gekuerztem IP-Hash (nie Klartext-IP)", async () => {
    await ia.logReadApi({
      credentialId: credA,
      organizationId: ORG_A,
      method: "GET",
      path: "/api/v1/rank-changes",
      query: { from: "2026-09-01" },
      status: 200,
      dauerMs: 42.4,
      zeilen: 17,
      ip: "203.0.113.9",
    });
    const row = db.read_api_log.at(-1);
    expect(row).toMatchObject({
      credential_id: credA,
      organization_id: ORG_A,
      method: "GET",
      path: "/api/v1/rank-changes",
      query: { from: "2026-09-01" },
      status: 200,
      dauer_ms: 42,
      zeilen: 17,
    });
    expect(row.ip_hash).toMatch(/^[a-f0-9]{16}$/);
    expect(JSON.stringify(row)).not.toContain("203.0.113.9");
  });

  it("ist fail-soft (DB-Fehler wird geloggt, nicht geworfen)", async () => {
    logFehler = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      ia.logReadApi({
        credentialId: credA,
        organizationId: ORG_A,
        method: "GET",
        path: "/x",
        status: 500,
        dauerMs: 1,
      }),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    logFehler = false;
  });
});

describe("rank-snapshot → rank_daily", () => {
  it("upsertet die Keyword-Zeilen nach dem audit_runs-Upsert", async () => {
    const r = await snapshot.POST({
      request: req("/api/admin/rank-snapshot", {
        bearer: ADMIN,
        stempel: ORG_A,
        body: {
          clientId: KUNDE_A,
          organizationId: ORG_A,
          date: "2026-09-27",
          country: "CH",
          keywords: [
            { kw: "hotel luzern", pos: 4, posSrc: "crawl", volume: 900, isMoney: true },
            { kw: "hotel ava", pos: null, posSrc: "crawl" },
          ],
          aggregate: {
            tracked: 2,
            top3: 0,
            top10: 1,
            pos11to20: 0,
            notRanking: 1,
            improved7: 0,
            declined7: 0,
            avgPos: 4,
          },
        },
      }),
    });
    expect(r.status).toBe(200);
    const u = upserts.find((x) => x.table === "rank_daily");
    expect(u?.opts).toEqual({ onConflict: "client_id,date,keyword" });
    expect(u?.rows).toHaveLength(2);
    expect(u?.rows[0]).toMatchObject({
      client_id: KUNDE_A,
      organization_id: ORG_A,
      date: "2026-09-27",
      keyword: "hotel luzern",
      position: 4,
      pos_src: "crawl",
      is_money: true,
    });
  });
});
