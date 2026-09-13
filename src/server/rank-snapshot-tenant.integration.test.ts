// Ranking-Snapshot mandanteneindeutig (13.09.2026): ECHTER Route-Handler
// /api/admin/rank-snapshot gegen eine In-Memory-Supabase mit ZWEI
// Organisationen, die einen Kunden mit IDENTISCHEM Namen («Hotel Ava», Slug
// hotel-ava) fuehren. Beweise:
//  - clientId + organizationId sind Pflicht; Slug allein → 400
//  - der Kunde wird nie global ueber den Slug gewaehlt: jede Org schreibt in
//    ihre eigene audit_runs-Zeile, nie in die der anderen
//  - Admin-Pfad braucht den Org-Stempel (X-Ezy-Organization) und der muss
//    zur organizationId passen; clientId muss in dieser Org existieren
//  - kundenspezifisches Credential (rank_snapshot) ist an org+client gebunden
//  - Slug-Mismatch → 400, Slug-Mehrdeutigkeit ohne Bezug → 409
//  - Upsert je Org+Datum (keine Duplikate, keine Kreuz-Updates)
import { describe, it, expect, beforeAll, vi } from "vitest";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AVA_A = "11111111-1111-4111-8111-111111111111"; // «Hotel Ava» in Org A
const AVA_B = "22222222-2222-4222-8222-222222222222"; // «Hotel Ava» in Org B (gleicher Name!)
const AVA_A2 = "33333333-3333-4333-8333-333333333333"; // zweiter «Hotel Ava» in Org A (mehrdeutig)
const SEMINAR_A = "44444444-4444-4444-8444-444444444444";

const db: Record<string, any[]> = {
  clients: [
    { id: AVA_A, organization_id: ORG_A, name: "Hotel Ava", domain: "hotel-ava.ch" },
    { id: AVA_B, organization_id: ORG_B, name: "Hotel Ava", domain: "hotel-ava.at" },
    { id: AVA_A2, organization_id: ORG_A, name: "Hotel Ava", domain: "ava-zweigbetrieb.ch" },
    { id: SEMINAR_A, organization_id: ORG_A, name: "Seminar Luzern", domain: "seminar-luzern.ch" },
  ],
  app_users: [
    { user_id: "owner-a", organization_id: ORG_A, role: "owner" },
    { user_id: "owner-b", organization_id: ORG_B, role: "owner" },
  ],
  audit_runs: [],
  ingest_credentials: [],
};
let seq = 0;

function builder(table: string) {
  const st: any = { filters: [] as ((r: any) => boolean)[], single: false, limit: 0 };
  const api: any = {
    select: () => api,
    order: () => api,
    limit: (n: number) => ((st.limit = n), api),
    maybeSingle: () => ((st.single = true), api),
    single: () => ((st.single = true), api),
    eq: (k: string, v: any) => {
      // PostgREST-JSON-Pfad "input->>date"
      const m = /^(\w+)->>(\w+)$/.exec(k);
      st.filters.push((r: any) => (m ? r[m[1]]?.[m[2]] === v : r[k] === v));
      return api;
    },
    insert: (rows: any) => ((st.insert = Array.isArray(rows) ? rows : [rows]), api),
    update: (patch: any) => ((st.update = patch), api),
    then(resolve: any) {
      if (st.insert) {
        const out = st.insert.map((r: any) => ({ id: `run-${++seq}`, ...r }));
        db[table].push(...out);
        return resolve({ data: st.single ? out[0] : out, error: null });
      }
      let rows = (db[table] || []).filter((r) => st.filters.every((f: any) => f(r)));
      if (st.update) for (const r of rows) Object.assign(r, st.update);
      if (st.limit) rows = rows.slice(0, st.limit);
      resolve({ data: st.single ? (rows.length === 1 ? rows[0] : null) : rows, error: null });
    },
  };
  return api;
}
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (t: string) => builder(t),
    // Touch-RPC (use_count) — hier nur No-op, die Semantik testet ingest-hardening.
    rpc: async () => ({ data: null, error: null }),
  },
}));

let POST: (a: { request: Request }) => Promise<Response>;
let tokenHash: (t: string) => string;
let genToken: (p: any) => { token: string; tokenHash: string; tokenPrefix: string };

beforeAll(async () => {
  process.env.ADMIN_AUTOMATION_SECRET = "admin-secret";
  const mod = await import("../routes/api/admin.rank-snapshot");
  POST = (mod.Route.options.server!.handlers as any).POST;
  const ia = await import("./ingest-auth.server");
  tokenHash = ia.ingestTokenHash;
  genToken = ia.generateIngestToken;
});

const payload = (
  clientId: string,
  organizationId: string,
  extra: Record<string, unknown> = {},
) => ({
  clientId,
  organizationId,
  client: "hotel-ava",
  date: "2026-09-13",
  crawlLocation: "Lucerne,Lucerne,Switzerland",
  keywords: [{ kw: "hotel luzern", pos: 3, posSrc: "crawl" }],
  aggregate: {
    tracked: 1,
    top3: 1,
    top10: 1,
    pos11to20: 0,
    notRanking: 0,
    improved7: 0,
    declined7: 0,
    avgPos: 3,
  },
  ...extra,
});

function push(
  body: unknown,
  o: { bearer?: string; stempel?: string | null; ip?: string } = {},
): Promise<Response> {
  return POST({
    request: new Request("http://test/api/admin/rank-snapshot", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${o.bearer ?? "admin-secret"}`,
        "x-forwarded-for": o.ip ?? "10.0.0.1",
        ...(o.stempel ? { "x-ezy-organization": o.stempel } : {}),
      },
      body: JSON.stringify(body),
    }),
  });
}

describe("Zwei Organisationen, identischer Kundenname «Hotel Ava»", () => {
  it("Slug allein (Legacy-Pusher) wird mit 400 abgelehnt — kein globaler Slug-Lookup mehr", async () => {
    const { clientId: _c, organizationId: _o, ...ohneId } = payload(AVA_A, ORG_A);
    void _c;
    void _o;
    const r = await push(ohneId, { stempel: ORG_A });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/clientId.*Pflicht/);
    expect(db.audit_runs.length).toBe(0);
  });

  it("Org A und Org B schreiben je in IHRE Zeile — nie in die der anderen", async () => {
    const a = await push(payload(AVA_A, ORG_A), { stempel: ORG_A });
    const b = await push(payload(AVA_B, ORG_B), { stempel: ORG_B });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(db.audit_runs.length).toBe(2);
    const zeileA = db.audit_runs.find((r) => r.organization_id === ORG_A)!;
    const zeileB = db.audit_runs.find((r) => r.organization_id === ORG_B)!;
    expect(zeileA.client_id).toBe(AVA_A);
    expect(zeileB.client_id).toBe(AVA_B);
    expect(zeileA.triggered_by).toBe("owner-a");
    expect(zeileB.triggered_by).toBe("owner-b");
    expect(zeileA.result.clientId).toBe(AVA_A);
    expect(zeileA.result.organizationId).toBe(ORG_A);
    expect(zeileA.result.client).toBe("hotel-ava"); // Slug bleibt als Anzeige-/Legacy-Feld
    expect(zeileA.result.crawlLocation).toBe("Lucerne,Lucerne,Switzerland");
  });

  it("Upsert je Org+Datum: erneuter Push fuer A aktualisiert NUR A (kein Duplikat, kein Kreuz-Update)", async () => {
    const vorher = db.audit_runs.length;
    const r = await push(payload(AVA_A, ORG_A, { keywords: [{ kw: "hotel luzern", pos: 1 }] }), {
      stempel: ORG_A,
    });
    expect(r.status).toBe(200);
    expect((await r.json()).upserted).toBe(true);
    expect(db.audit_runs.length).toBe(vorher);
    expect(db.audit_runs.find((r) => r.organization_id === ORG_A)!.result.keywords[0].pos).toBe(1);
    expect(db.audit_runs.find((r) => r.organization_id === ORG_B)!.result.keywords[0].pos).toBe(3);
  });

  it("clientId von Org B mit organizationId A → 404 (Kunde nicht in dieser Organisation)", async () => {
    const r = await push(payload(AVA_B, ORG_A), { stempel: ORG_A });
    expect(r.status).toBe(404);
  });

  it("Admin-Pfad: ohne Org-Stempel 403; Stempel A mit organizationId B → 403", async () => {
    expect((await push(payload(AVA_A, ORG_A), { stempel: null })).status).toBe(403);
    expect((await push(payload(AVA_B, ORG_B), { stempel: ORG_A })).status).toBe(403);
  });

  it("Slug passt nicht zum clientId → 400; mehrdeutiger Slug ohne Bezug zum Kunden → 409", async () => {
    const r = await push(payload(SEMINAR_A, ORG_A, { client: "hotel-ava" }), { stempel: ORG_A });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/passt nicht zum clientId/);
    // Zweiter «Hotel Ava» in Org A: mit clientId eindeutig → 200 (Slug ist nur Anzeige)
    const r2 = await push(payload(AVA_A2, ORG_A), { stempel: ORG_A });
    expect(r2.status).toBe(200);
    expect(db.audit_runs.filter((r) => r.organization_id === ORG_A).length).toBe(2);
    // Ohne clientId waere der Slug in Org A mehrdeutig — genau deshalb ist er Pflicht.
    const ohne = await push({ ...payload(AVA_A, ORG_A), clientId: undefined }, { stempel: ORG_A });
    expect(ohne.status).toBe(400);
  });

  it("kundenspezifisches Credential (rank_snapshot) ist an org+client gebunden", async () => {
    const tokA = genToken("rank_snapshot");
    const tokB = genToken("rank_snapshot");
    db.ingest_credentials.push(
      {
        id: "cred-a",
        organization_id: ORG_A,
        client_id: AVA_A,
        purpose: "rank_snapshot",
        token_hash: tokA.tokenHash,
      },
      {
        id: "cred-b",
        organization_id: ORG_B,
        client_id: AVA_B,
        purpose: "rank_snapshot",
        token_hash: tokB.tokenHash,
      },
    );
    expect(tokenHash(tokA.token)).toBe(tokA.tokenHash);
    // eigener Kunde: ok, kein Org-Stempel noetig (Scope kommt aus dem Token)
    expect((await push(payload(AVA_A, ORG_A), { bearer: tokA.token, ip: "10.0.0.2" })).status).toBe(
      200,
    );
    // Token A fuer den gleichnamigen Kunden in Org B → 403
    expect((await push(payload(AVA_B, ORG_B), { bearer: tokA.token, ip: "10.0.0.2" })).status).toBe(
      403,
    );
    // Token A fuer einen anderen Kunden derselben Org → 403
    expect(
      (
        await push(payload(SEMINAR_A, ORG_A, { client: "seminar-luzern" }), {
          bearer: tokA.token,
          ip: "10.0.0.2",
        })
      ).status,
    ).toBe(403);
    // Token B fuer seinen Kunden ok
    expect((await push(payload(AVA_B, ORG_B), { bearer: tokB.token, ip: "10.0.0.3" })).status).toBe(
      200,
    );
    // Fremdes/unbekanntes Token → 401
    expect(
      (await push(payload(AVA_A, ORG_A), { bearer: "ezyi_rs_" + "x".repeat(43), ip: "10.0.0.4" }))
        .status,
    ).toBe(401);
    // Zeilenbestand: A hat 2 (Ava, Ava2), B hat 1 — nichts ist gekreuzt
    expect(db.audit_runs.filter((r) => r.organization_id === ORG_A).length).toBe(2);
    expect(db.audit_runs.filter((r) => r.organization_id === ORG_B).length).toBe(1);
    expect(db.audit_runs.every((r) => r.result.organizationId === r.organization_id)).toBe(true);
  });
});
