// Integrationstests Ingest-Haertung (Security-Runde 3, 13.09.2026).
// Es werden die ECHTEN Route-Handler aufgerufen (openai-ads-ingest,
// ai-crawler-ingest, ingest-credentials) — nur die Aussenwelt ist ersetzt:
// eine In-Memory-Supabase mit 2 Organisationen (inkl. Unique-Constraints
// fuer die Replay-Regeln) und ein OpenAI-Double. Beweise:
//  - Token von Kunde A kann nie Daten fuer Kunde B schreiben
//  - manipulierte clientId/Domain werden abgelehnt
//  - abgelaufene/widerrufene/rotierte Tokens funktionieren nicht mehr
//  - Duplikate bleiben idempotent
//  - ungueltige/uebergrosse Payloads werden abgelehnt
//  - die frueheren globalen Secrets werden nicht mehr akzeptiert
//  - Rate-Limits (Nutzlast je Credential, 401-Bremse je IP)
import { describe, it, expect, beforeAll, vi } from "vitest";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const KUNDE_A = "11111111-1111-4111-8111-111111111111";
const KUNDE_B = "22222222-2222-4222-8222-222222222222";

const users: Record<string, { org: string; role: string }[]> = {
  "admin-a": [{ org: ORG_A, role: "admin" }],
  "viewer-a": [{ org: ORG_A, role: "viewer" }],
  "admin-b": [{ org: ORG_B, role: "admin" }],
};

// ── In-Memory-Supabase mit Unique-Constraints ───────────────────────────────
const db: Record<string, any[]> = {
  app_users: Object.entries(users).flatMap(([uid, ms]) =>
    ms.map((m) => ({ user_id: uid, organization_id: m.org, role: m.role })),
  ),
  clients: [
    { id: KUNDE_A, organization_id: ORG_A, name: "Kunde A", domain: "a.ch" },
    { id: KUNDE_B, organization_id: ORG_B, name: "Kunde B", domain: "b.ch" },
  ],
  ingest_credentials: [],
  openai_ads_config: [
    {
      client_id: KUNDE_A,
      organization_id: ORG_A,
      pixel_id: "pid-a",
      api_key_enc: "key-a",
      enabled: true,
    },
    {
      client_id: KUNDE_B,
      organization_id: ORG_B,
      pixel_id: "pid-b",
      api_key_enc: "key-b",
      enabled: true,
    },
  ],
  openai_ads_events: [],
  ai_crawler_hits: [],
};
const UNIQUE: Record<string, string[][]> = {
  openai_ads_events: [["client_id", "event_id"]],
  ai_crawler_hits: [["hit_hash"]],
  ingest_credentials: [["token_hash"]],
};
let seq = 0;

// select("a, b") wird wie in PostgREST als Projektion angewendet — so beweist
// der Test, dass token_hash nie in einer API-Antwort landet.
function projiziere(row: any, cols: string[] | null) {
  if (!row || !cols) return row;
  const out: any = {};
  for (const c of cols) if (c in row) out[c] = row[c];
  return out;
}
function builder(table: string) {
  const st: any = { filters: [] as ((r: any) => boolean)[], single: false, cols: null };
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
      st.filters.push((r: any) => r[k] === v);
      return api;
    },
    order() {
      return api;
    },
    limit() {
      return api;
    },
    maybeSingle() {
      st.single = true;
      return api;
    },
    insert(rows: any) {
      st.insert = Array.isArray(rows) ? rows : [rows];
      return api;
    },
    upsert(rows: any, opts: any) {
      st.insert = Array.isArray(rows) ? rows : [rows];
      st.ignoreDup = !!opts?.ignoreDuplicates;
      return api;
    },
    update(patch: any) {
      st.update = patch;
      return api;
    },
    then(resolve: any) {
      if (st.insert) {
        const inserted: any[] = [];
        for (const r of st.insert) {
          const dup = (UNIQUE[table] || []).some((cols) =>
            db[table].some((x) => cols.every((c) => x[c] === r[c])),
          );
          if (dup) {
            if (st.ignoreDup) continue;
            return resolve({ data: null, error: { code: "23505", message: "duplicate key" } });
          }
          const row = {
            ...r,
            id: r.id ?? crypto.randomUUID(),
            created_at: r.created_at ?? new Date().toISOString(),
          };
          seq++;
          db[table].push(row);
          inserted.push(row);
        }
        const p = inserted.map((x) => projiziere(x, st.cols));
        return resolve({ data: st.single ? (p[0] ?? null) : p, error: null });
      }
      const rows = (db[table] || []).filter((r) => st.filters.every((f: any) => f(r)));
      if (st.update) {
        for (const r of rows) Object.assign(r, st.update);
        return resolve({ data: null, error: null });
      }
      const p = rows.map((x) => projiziere(x, st.cols));
      resolve({ data: st.single ? (p.length === 1 ? p[0] : null) : p, error: null });
    },
  };
  return api;
}

// In-Memory-Spiegel der Lifecycle-RPCs (Migration 20260913210000): gleiche
// Semantik wie die SQL-Funktionen — P0002 nicht gefunden, P0003 Konflikt,
// Rotation setzt das alte Ablaufdatum in demselben Schritt, Touch zaehlt hoch.
async function rpcMock(fn: string, a: any = {}): Promise<{ data: any; error: any }> {
  const rows = db.ingest_credentials;
  const P = (code: string, message: string) => ({ data: null, error: { code, message } });
  if (fn === "ingest_credential_touch") {
    const r = rows.find((x) => x.id === a._credential_id);
    if (r) {
      r.use_count = (r.use_count || 0) + 1;
      r.last_used_at = new Date().toISOString();
    }
    return { data: null, error: null };
  }
  if (fn === "ingest_credential_create") {
    if (!db.clients.some((c) => c.id === a._client_id && c.organization_id === a._organization_id))
      return P("P0002", "Kunde nicht in dieser Organisation");
    if (rows.some((x) => x.token_hash === a._token_hash)) return P("23505", "duplicate key");
    const r = {
      id: crypto.randomUUID(), // Route validiert credentialId als UUID
      organization_id: a._organization_id,
      client_id: a._client_id,
      purpose: a._purpose,
      token_hash: a._token_hash,
      token_prefix: a._token_prefix,
      label: a._label ?? null,
      created_by: a._created_by ?? null,
      created_at: new Date().toISOString(),
      expires_at: a._expires_at ?? null,
      revoked_at: null,
      revoked_reason: null,
      rotated_from: null,
      last_used_at: null,
      use_count: 0,
    };
    rows.push(r);
    return { data: r, error: null };
  }
  if (fn === "ingest_credential_rotate") {
    const alt = rows.find((x) => x.id === a._credential_id && x.client_id === a._client_id);
    if (!alt) return P("P0002", "Credential nicht gefunden");
    if (alt.revoked_at) return P("P0003", "Widerrufenes Credential kann nicht rotiert werden");
    const neu = {
      ...alt,
      id: crypto.randomUUID(), // Route validiert credentialId als UUID
      token_hash: a._token_hash,
      token_prefix: a._token_prefix,
      label: a._label ?? null,
      created_by: a._created_by ?? null,
      created_at: new Date().toISOString(),
      expires_at: a._expires_at ?? null,
      rotated_from: alt.id,
      last_used_at: null,
      use_count: 0,
    };
    rows.push(neu);
    const bisher = alt.expires_at ? Date.parse(alt.expires_at) : Infinity;
    const grace = a._grace_until ? Date.parse(a._grace_until) : Date.now();
    alt.expires_at = new Date(Math.min(bisher, grace)).toISOString();
    return { data: neu, error: null };
  }
  if (fn === "ingest_credential_revoke") {
    const r = rows.find((x) => x.id === a._credential_id && x.client_id === a._client_id);
    if (!r) return P("P0002", "Credential nicht gefunden");
    r.revoked_at = r.revoked_at || new Date().toISOString();
    r.revoked_reason = r.revoked_reason ?? a._reason ?? null;
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
const openaiCalls: any[] = [];
vi.mock("@/server/openai-ads.server", () => ({
  buildOpenAiEvent: (row: any) => ({ id: row.event_id, type: row.event_type }),
  sendConversionEvents: async (pixel: string, _key: string, events: any[]) => {
    openaiCalls.push({ pixel, events });
    return { ok: true, status: 200, response: { ok: true } };
  },
}));

// ── Helfer ──────────────────────────────────────────────────────────────────
type Handlers = Record<string, (a: { request: Request }) => Promise<Response>>;
let ads: Handlers, crawler: Handlers, creds: Handlers;
const ALTES_ADS_SECRET = "altes-globales-ads-secret";
const ALTES_CRAWLER_SECRET = "altes-globales-crawler-secret";
const ADMIN = "internes-admin-secret";

function req(
  path: string,
  opts: {
    bearer?: string;
    body?: any;
    rawBody?: string;
    ip?: string;
    noContentType?: boolean;
    method?: string;
  } = {},
) {
  const body = opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined);
  return new Request(`http://test${path}`, {
    method: opts.method ?? (body !== undefined ? "POST" : "GET"),
    headers: {
      ...(opts.bearer ? { authorization: `Bearer ${opts.bearer}` } : {}),
      ...(body !== undefined && !opts.noContentType ? { "content-type": "application/json" } : {}),
      "x-forwarded-for": opts.ip ?? "10.0.0.1",
    },
    body,
  });
}
const json = async (r: Response) => ({ status: r.status, j: await r.json() });

async function tokenErzeugen(user: string, clientId: string, purpose: string, label = "t") {
  const { status, j } = await json(
    await creds.POST({
      request: req("/api/admin/ingest-credentials", {
        bearer: user,
        body: { action: "create", clientId, purpose, label },
      }),
    }),
  );
  return { status, j };
}

const ev = (id: string, extra: Record<string, unknown> = {}) => ({
  event: { id, type: "lead_created", ...extra },
});

let tokA = "",
  tokB = "",
  crA = "",
  crB = "",
  credA = "";

beforeAll(async () => {
  process.env.SUPABASE_URL = "http://stub.local";
  process.env.SUPABASE_ANON_KEY = "stub-anon";
  process.env.ADMIN_AUTOMATION_SECRET = ADMIN;
  process.env.WP_SECRET_KEY_V1 = "test-key";
  process.env.OPENAI_ADS_INGEST_SECRET = ALTES_ADS_SECRET;
  process.env.CRAWLER_INGEST_SECRET = ALTES_CRAWLER_SECRET;
  // Nutzlast-Limit hoch, damit die uebrigen Tests nicht gedrosselt werden —
  // der Rate-Limit-Test fuellt das Fenster gezielt ueber den Limiter selbst.
  process.env.INGEST_RATE_LIMIT_PER_MIN = "1000";
  process.env.INGEST_AUTH_FAIL_LIMIT_PER_MIN = "20";
  ads = (await import("../routes/api/admin.openai-ads-ingest")).Route.options.server!
    .handlers as any;
  crawler = (await import("../routes/api/admin.ai-crawler-ingest")).Route.options.server!
    .handlers as any;
  creds = (await import("../routes/api/admin.ingest-credentials")).Route.options.server!
    .handlers as any;

  const a = await tokenErzeugen("admin-a", KUNDE_A, "openai_ads", "crm-a");
  expect(a.status).toBe(200);
  tokA = a.j.token;
  credA = a.j.credential.id;
  tokB = (await tokenErzeugen("admin-b", KUNDE_B, "openai_ads", "crm-b")).j.token;
  crA = (await tokenErzeugen("admin-a", KUNDE_A, "ai_crawler", "wp-a")).j.token;
  crB = (await tokenErzeugen("admin-b", KUNDE_B, "ai_crawler", "wp-b")).j.token;
});

// ── Credential-Verwaltung ───────────────────────────────────────────────────
describe("Credential-Verwaltung (Organisationsgrenze)", () => {
  it("liefert den Klartext-Token genau einmal und speichert nur den Hash", () => {
    expect(tokA).toMatch(/^ezyi_oa_[A-Za-z0-9_-]{43}$/);
    const row = db.ingest_credentials.find((c) => c.id === credA);
    expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.token_hash).not.toBe(tokA);
    expect(row.organization_id).toBe(ORG_A);
    expect(row.client_id).toBe(KUNDE_A);
    expect(row.purpose).toBe("openai_ads");
    expect(JSON.stringify(row)).not.toContain(tokA);
  });

  it("Admin von Org A kann KEIN Credential fuer Kunde B erzeugen", async () => {
    const r = await tokenErzeugen("admin-a", KUNDE_B, "openai_ads");
    expect(r.status).toBe(403);
  });

  it("Viewer kann keine Credentials erzeugen", async () => {
    const r = await tokenErzeugen("viewer-a", KUNDE_A, "openai_ads");
    expect(r.status).toBe(403);
  });

  it("Liste zeigt nie den Hash und nur die eigene Organisation", async () => {
    const { status, j } = await json(
      await creds.GET({
        request: req(`/api/admin/ingest-credentials?clientId=${KUNDE_A}`, { bearer: "admin-a" }),
      }),
    );
    expect(status).toBe(200);
    expect(j.credentials.length).toBeGreaterThan(0);
    for (const c of j.credentials) expect(c.token_hash).toBeUndefined();
    const fremd = await creds.GET({
      request: req(`/api/admin/ingest-credentials?clientId=${KUNDE_B}`, { bearer: "admin-a" }),
    });
    expect(fremd.status).toBe(403);
  });
});

// ── Mandantengrenze beim Ingest ─────────────────────────────────────────────
describe("ChatGPT-Ads-Ingest: Token-Scope", () => {
  it("Token A schreibt Events nur fuer Kunde A (Scope aus dem Token)", async () => {
    const { status, j } = await json(
      await ads.POST({
        request: req("/api/admin/openai-ads-ingest", { bearer: tokA, body: ev("e-1") }),
      }),
    );
    expect(status).toBe(200);
    expect(j.forwarded).toBe(true);
    const row = db.openai_ads_events.find((e) => e.event_id === "e-1");
    expect(row.client_id).toBe(KUNDE_A);
    expect(row.organization_id).toBe(ORG_A);
    expect(openaiCalls.at(-1).pixel).toBe("pid-a");
  });

  it("Token A mit manipulierter clientId = Kunde B -> 403, nichts geschrieben", async () => {
    const r = await ads.POST({
      request: req("/api/admin/openai-ads-ingest", {
        bearer: tokA,
        body: { clientId: KUNDE_B, ...ev("e-manip-1") },
      }),
    });
    expect(r.status).toBe(403);
    expect(db.openai_ads_events.some((e) => e.client_id === KUNDE_B)).toBe(false);
  });

  it("Token A mit fremder Domain b.ch -> 403; eigene Domain (auch www./Subdomain) -> ok", async () => {
    const fremd = await ads.POST({
      request: req("/api/admin/openai-ads-ingest", {
        bearer: tokA,
        body: { domain: "b.ch", ...ev("e-manip-2") },
      }),
    });
    expect(fremd.status).toBe(403);
    const eigen = await ads.POST({
      request: req("/api/admin/openai-ads-ingest", {
        bearer: tokA,
        body: { domain: "www.shop.a.ch", ...ev("e-2") },
      }),
    });
    expect(eigen.status).toBe(200);
    expect(db.openai_ads_events.some((e) => e.client_id === KUNDE_B)).toBe(false);
  });

  it("Token B schreibt fuer Kunde B — und nie fuer A", async () => {
    const r = await ads.POST({
      request: req("/api/admin/openai-ads-ingest", { bearer: tokB, body: ev("e-b-1") }),
    });
    expect(r.status).toBe(200);
    expect(db.openai_ads_events.find((e) => e.event_id === "e-b-1").client_id).toBe(KUNDE_B);
    const manip = await ads.POST({
      request: req("/api/admin/openai-ads-ingest", {
        bearer: tokB,
        body: { clientId: KUNDE_A, ...ev("e-b-manip") },
      }),
    });
    expect(manip.status).toBe(403);
    expect(db.openai_ads_events.some((e) => e.event_id === "e-b-manip")).toBe(false);
  });

  it("Crawler-Token auf der Ads-Route -> 401 (purpose-gebunden)", async () => {
    const r = await ads.POST({
      request: req("/api/admin/openai-ads-ingest", { bearer: crA, body: ev("e-x") }),
    });
    expect(r.status).toBe(401);
  });

  it("die frueheren globalen Secrets werden nicht mehr akzeptiert", async () => {
    const r1 = await ads.POST({
      request: req("/api/admin/openai-ads-ingest", {
        bearer: ALTES_ADS_SECRET,
        body: { clientId: KUNDE_A, ...ev("e-alt") },
      }),
    });
    expect(r1.status).toBe(401);
    const r2 = await crawler.POST({
      request: req("/api/admin/ai-crawler-ingest", {
        bearer: ALTES_CRAWLER_SECRET,
        body: { domain: "a.ch", hits: [{ bot: "GPTBot", url: "/x" }] },
      }),
    });
    expect(r2.status).toBe(401);
    expect(db.openai_ads_events.some((e) => e.event_id === "e-alt")).toBe(false);
  });

  it("interner Admin-Pfad (ADMIN_AUTOMATION_SECRET) bleibt mit clientId nutzbar", async () => {
    const r = await ads.POST({
      request: req("/api/admin/openai-ads-ingest", {
        bearer: ADMIN,
        body: { clientId: KUNDE_B, ...ev("e-admin") },
      }),
    });
    expect(r.status).toBe(200);
    expect(db.openai_ads_events.find((e) => e.event_id === "e-admin").client_id).toBe(KUNDE_B);
  });
});

// ── Ablauf / Widerruf / Rotation ────────────────────────────────────────────
describe("Ablauf, Widerruf, Rotation", () => {
  it("abgelaufener Token -> 401", async () => {
    const t = (await tokenErzeugen("admin-a", KUNDE_A, "openai_ads", "abgelaufen")).j;
    db.ingest_credentials.find((c) => c.id === t.credential.id).expires_at = new Date(
      Date.now() - 1000,
    ).toISOString();
    const { status, j } = await json(
      await ads.POST({
        request: req("/api/admin/openai-ads-ingest", {
          bearer: t.token,
          body: ev("e-exp"),
          ip: "10.0.0.2",
        }),
      }),
    );
    expect(status).toBe(401);
    expect(j.error).toMatch(/abgelaufen/);
  });

  it("widerrufener Token -> 401, Widerruf ist idempotent", async () => {
    const t = (await tokenErzeugen("admin-a", KUNDE_A, "openai_ads", "widerruf")).j;
    for (let i = 0; i < 2; i++) {
      const r = await creds.POST({
        request: req("/api/admin/ingest-credentials", {
          bearer: "admin-a",
          body: {
            action: "revoke",
            clientId: KUNDE_A,
            credentialId: t.credential.id,
            reason: "Test",
          },
        }),
      });
      expect(r.status).toBe(200);
    }
    const { status, j } = await json(
      await ads.POST({
        request: req("/api/admin/openai-ads-ingest", {
          bearer: t.token,
          body: ev("e-rev"),
          ip: "10.0.0.2",
        }),
      }),
    );
    expect(status).toBe(401);
    expect(j.error).toMatch(/widerrufen/);
  });

  it("Admin B kann Credential von Kunde A weder widerrufen noch rotieren", async () => {
    const r = await creds.POST({
      request: req("/api/admin/ingest-credentials", {
        bearer: "admin-b",
        body: { action: "revoke", clientId: KUNDE_A, credentialId: credA },
      }),
    });
    expect(r.status).toBe(403);
    // auch mit "eigenem" Kunden im Body, aber fremder Credential-ID -> 404
    const r2 = await creds.POST({
      request: req("/api/admin/ingest-credentials", {
        bearer: "admin-b",
        body: { action: "rotate", clientId: KUNDE_B, credentialId: credA },
      }),
    });
    expect(r2.status).toBe(404);
    expect(db.ingest_credentials.find((c) => c.id === credA).revoked_at).toBeFalsy();
  });

  it("Rotation: neuer Token gilt sofort, alter nur bis zum Ueberlappungsende", async () => {
    const alt = (await tokenErzeugen("admin-a", KUNDE_A, "openai_ads", "rot")).j;
    const { status, j } = await json(
      await creds.POST({
        request: req("/api/admin/ingest-credentials", {
          bearer: "admin-a",
          body: {
            action: "rotate",
            clientId: KUNDE_A,
            credentialId: alt.credential.id,
            graceDays: 1,
          },
        }),
      }),
    );
    expect(status).toBe(200);
    expect(j.token).toMatch(/^ezyi_oa_/);
    expect(j.credential.rotated_from).toBe(alt.credential.id);
    // neu: sofort gueltig
    expect(
      (
        await ads.POST({
          request: req("/api/admin/openai-ads-ingest", { bearer: j.token, body: ev("e-rot-neu") }),
        })
      ).status,
    ).toBe(200);
    // alt: noch im Ueberlappungsfenster gueltig
    expect(
      (
        await ads.POST({
          request: req("/api/admin/openai-ads-ingest", {
            bearer: alt.token,
            body: ev("e-rot-alt"),
          }),
        })
      ).status,
    ).toBe(200);
    const altRow = db.ingest_credentials.find((c) => c.id === alt.credential.id);
    expect(new Date(altRow.expires_at).getTime()).toBeLessThanOrEqual(Date.now() + 864e5 + 1000);
    // Ueberlappung vorbei -> alt faellt aus
    altRow.expires_at = new Date(Date.now() - 1).toISOString();
    expect(
      (
        await ads.POST({
          request: req("/api/admin/openai-ads-ingest", {
            bearer: alt.token,
            body: ev("e-rot-alt2"),
            ip: "10.0.0.2",
          }),
        })
      ).status,
    ).toBe(401);
  });
});

// ── Idempotenz / Validierung / Groesse ──────────────────────────────────────
describe("Replay, Validierung, Payload-Limits", () => {
  it("gleiche event.id -> dedup:true, genau eine Zeile, kein zweiter OpenAI-Call", async () => {
    const vorher = openaiCalls.length;
    const r1 = await json(
      await ads.POST({
        request: req("/api/admin/openai-ads-ingest", { bearer: tokA, body: ev("dup-1") }),
      }),
    );
    const r2 = await json(
      await ads.POST({
        request: req("/api/admin/openai-ads-ingest", { bearer: tokA, body: ev("dup-1") }),
      }),
    );
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r2.j.dedup).toBe(true);
    expect(
      db.openai_ads_events.filter((e) => e.event_id === "dup-1" && e.client_id === KUNDE_A),
    ).toHaveLength(1);
    expect(openaiCalls.length).toBe(vorher + 1);
  });

  it.each([
    ["unbekannter Event-Typ", { event: { id: "v1", type: "hack" } }],
    [
      "Betrag nicht ganzzahlig",
      { event: { id: "v2", type: "purchase", amount_cents: 12.5, currency: "CHF" } },
    ],
    [
      "Betrag negativ",
      { event: { id: "v3", type: "purchase", amount_cents: -5, currency: "CHF" } },
    ],
    ["Betrag 0", { event: { id: "v4", type: "purchase", amount_cents: 0, currency: "CHF" } }],
    [
      "Waehrung klein geschrieben",
      { event: { id: "v5", type: "purchase", amount_cents: 100, currency: "chf" } },
    ],
    [
      "Waehrung kein ISO-4217",
      { event: { id: "v6", type: "purchase", amount_cents: 100, currency: "XXX" } },
    ],
    ["Betrag ohne Waehrung", { event: { id: "v7", type: "purchase", amount_cents: 100 } }],
    [
      "email_sha256 kein Hex-64",
      { event: { id: "v8", type: "lead_created", user: { email_sha256: "abc" } } },
    ],
    ["unbekanntes Feld im Event", { event: { id: "v9", type: "lead_created", evil: 1 } }],
    ["unbekanntes Feld im Body", { event: { id: "v10", type: "lead_created" }, admin: true }],
    ["event.id mit Sonderzeichen", { event: { id: "v 11 <script>", type: "lead_created" } }],
    [
      "source_url keine URL",
      { event: { id: "v12", type: "lead_created", source_url: "nicht-url" } },
    ],
    [
      "contents > 50",
      {
        event: {
          id: "v13",
          type: "lead_created",
          contents: Array.from({ length: 51 }, (_, i) => ({ item_id: `i${i}` })),
        },
      },
    ],
    [
      "clientId kein UUID",
      { clientId: "1; drop table", event: { id: "v14", type: "lead_created" } },
    ],
  ])("lehnt ab: %s", async (_name, body) => {
    const r = await ads.POST({
      request: req("/api/admin/openai-ads-ingest", { bearer: tokA, body }),
    });
    expect(r.status).toBe(400);
  });

  it("akzeptiert einen korrekten Kauf mit gehashtem User", async () => {
    const r = await json(
      await ads.POST({
        request: req("/api/admin/openai-ads-ingest", {
          bearer: tokA,
          body: {
            event: {
              id: "kauf-1",
              type: "purchase",
              amount_cents: 12990,
              currency: "CHF",
              source_url: "https://a.ch/danke",
              user: { email_sha256: "a".repeat(64), country: "CH" },
              contents: [{ item_id: "sku-1", quantity: 1, price: 12990 }],
            },
          },
        }),
      }),
    );
    expect(r.status).toBe(200);
    const row = db.openai_ads_events.find((e) => e.event_id === "kauf-1");
    expect(row.amount_cents).toBe(12990);
    expect(row.payload.user.email_sha256).toBe("a".repeat(64));
  });

  it("uebergrosse Payload -> 413; falscher Content-Type -> 415; kaputtes JSON -> 400", async () => {
    const gross = {
      event: { id: "big", type: "lead_created", data: { blob: "x".repeat(40 * 1024) } },
    };
    expect(
      (
        await ads.POST({
          request: req("/api/admin/openai-ads-ingest", { bearer: tokA, body: gross }),
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await ads.POST({
          request: req("/api/admin/openai-ads-ingest", {
            bearer: tokA,
            body: ev("ct"),
            noContentType: true,
          }),
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await ads.POST({
          request: req("/api/admin/openai-ads-ingest", { bearer: tokA, rawBody: "{nicht json" }),
        })
      ).status,
    ).toBe(400);
  });
});

// ── Crawler-Ingest ──────────────────────────────────────────────────────────
describe("KI-Crawler-Ingest", () => {
  const hits = [
    { bot: "GPTBot", url: "https://a.ch/", status: 200, at: "2026-09-13T08:00:00Z" },
    { bot: "ClaudeBot", url: "/blog/x", at: "2026-09-13T08:00:01Z" },
  ];

  it("Token A schreibt Hits fuer Kunde A; Wiederholung ist idempotent", async () => {
    const r1 = await json(
      await crawler.POST({
        request: req("/api/admin/ai-crawler-ingest", { bearer: crA, body: { hits } }),
      }),
    );
    expect(r1.status).toBe(200);
    expect(r1.j.inserted).toBe(2);
    const r2 = await json(
      await crawler.POST({
        request: req("/api/admin/ai-crawler-ingest", { bearer: crA, body: { hits } }),
      }),
    );
    expect(r2.j.inserted).toBe(0);
    expect(r2.j.dedup).toBe(2);
    expect(db.ai_crawler_hits.filter((h) => h.client_id === KUNDE_A)).toHaveLength(2);
    for (const h of db.ai_crawler_hits) expect(h.hit_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("Token A mit Domain b.ch oder clientId B -> 403, nichts fuer B geschrieben", async () => {
    const r1 = await crawler.POST({
      request: req("/api/admin/ai-crawler-ingest", { bearer: crA, body: { domain: "b.ch", hits } }),
    });
    expect(r1.status).toBe(403);
    const r2 = await crawler.POST({
      request: req("/api/admin/ai-crawler-ingest", {
        bearer: crA,
        body: { clientId: KUNDE_B, hits },
      }),
    });
    expect(r2.status).toBe(403);
    expect(db.ai_crawler_hits.some((h) => h.client_id === KUNDE_B)).toBe(false);
  });

  it("Token B schreibt fuer B; Ads-Token auf Crawler-Route -> 401", async () => {
    const ok = await crawler.POST({
      request: req("/api/admin/ai-crawler-ingest", { bearer: crB, body: { domain: "b.ch", hits } }),
    });
    expect(ok.status).toBe(200);
    expect(db.ai_crawler_hits.some((h) => h.client_id === KUNDE_B)).toBe(true);
    const falsch = await crawler.POST({
      request: req("/api/admin/ai-crawler-ingest", { bearer: tokA, body: { hits } }),
    });
    expect(falsch.status).toBe(401);
  });

  it.each([
    ["unbekannter Bot", { hits: [{ bot: "EvilBot", url: "/" }] }],
    ["Status ausserhalb 100-599", { hits: [{ bot: "GPTBot", url: "/", status: 999 }] }],
    ["URL weder http noch Pfad", { hits: [{ bot: "GPTBot", url: "javascript:alert(1)" }] }],
    ["leerer Batch", { hits: [] }],
    [
      "zu viele Hits",
      { hits: Array.from({ length: 501 }, (_, i) => ({ bot: "GPTBot", url: `/p${i}` })) },
    ],
    ["unbekanntes Feld", { hits: [{ bot: "GPTBot", url: "/", ua: "x" }] }],
    ["kein ISO-Zeitstempel", { hits: [{ bot: "GPTBot", url: "/", at: "gestern" }] }],
  ])("lehnt ab: %s", async (_name, body) => {
    const r = await crawler.POST({
      request: req("/api/admin/ai-crawler-ingest", { bearer: crA, body }),
    });
    expect(r.status).toBe(400);
  });

  it("Zeitstempel ausserhalb des Fensters werden verworfen (nicht gespeichert)", async () => {
    const r = await json(
      await crawler.POST({
        request: req("/api/admin/ai-crawler-ingest", {
          bearer: crA,
          body: { hits: [{ bot: "GPTBot", url: "/alt", at: "2020-01-01T00:00:00Z" }] },
        }),
      }),
    );
    expect(r.status).toBe(200);
    expect(r.j.inserted).toBe(0);
    expect(r.j.verworfen).toBe(1);
  });
});

// ── Rate-Limits ─────────────────────────────────────────────────────────────
describe("Rate-Limits", () => {
  it("Nutzlast-Limit je Credential: ueber dem Limit -> 429 mit Retry-After, nichts geschrieben", async () => {
    const { ingestLimiter } = await import("./rate-limit.server");
    const t = (await tokenErzeugen("admin-a", KUNDE_A, "openai_ads", "rl")).j;
    // Fenster bis auf EINEN Platz fuellen (limit-1 Treffer), dann 1 ok, dann 429.
    for (let i = 0; i < ingestLimiter.limit - 1; i++) ingestLimiter.hit(`cred:${t.credential.id}`);
    const ok = await ads.POST({
      request: req("/api/admin/openai-ads-ingest", { bearer: t.token, body: ev("rl-ok") }),
    });
    expect(ok.status).toBe(200);
    const r = await ads.POST({
      request: req("/api/admin/openai-ads-ingest", { bearer: t.token, body: ev("rl-zuviel") }),
    });
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(db.openai_ads_events.some((e) => e.event_id === "rl-zuviel")).toBe(false);
    // andere Credentials desselben Kunden sind nicht betroffen
    const andere = await ads.POST({
      request: req("/api/admin/openai-ads-ingest", { bearer: tokA, body: ev("rl-andere") }),
    });
    expect(andere.status).toBe(200);
  });

  it("401-Bremse je IP: nach 20 abgelehnten Tokens -> 429, auch fuer gueltige Tokens dieser IP", async () => {
    const ip = "9.9.9.9";
    for (let i = 0; i < 20; i++) {
      const r = await ads.POST({
        request: req("/api/admin/openai-ads-ingest", {
          bearer: `ezyi_oa_${"x".repeat(43)}`,
          body: ev(`bf-${i}`),
          ip,
        }),
      });
      expect(r.status).toBe(401);
    }
    const gesperrt = await ads.POST({
      request: req("/api/admin/openai-ads-ingest", { bearer: tokA, body: ev("bf-ok"), ip }),
    });
    expect(gesperrt.status).toBe(429);
    // andere IP ist nicht betroffen
    const frei = await ads.POST({
      request: req("/api/admin/openai-ads-ingest", {
        bearer: tokA,
        body: ev("bf-ok2"),
        ip: "10.0.0.3",
      }),
    });
    expect(frei.status).toBe(200);
  });
});
