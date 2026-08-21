// Admin-Jobs (Async-Datenlaeufe, 21.08.2026): Doppelstart-Schutz, Lock-Claim
// und Retry-Verhalten gegen eine In-Memory-Tabelle — gleiche Beweisfuehrung
// wie prospect-audit-flow.
import { describe, it, expect, beforeEach, vi } from "vitest";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const KUNDE = "11111111-1111-4111-8111-111111111111";

const db: Record<string, any[]> = { admin_jobs: [] };
let seq = 0;

function orFilter(expr: string) {
  return (r: any) =>
    expr.split(",").some((teil) => {
      const [feld, op, ...rest] = teil.split(".");
      const wert = rest.join(".");
      if (op === "is" && wert === "null") return r[feld] == null;
      if (op === "lt") return r[feld] != null && String(r[feld]) < wert;
      return false;
    });
}
function builder(table: string) {
  const state: any = { filters: [], limit: 0, single: false };
  const api: any = {
    select: () => api,
    order: () => api,
    eq: (k: string, v: any) => (state.filters.push((r: any) => r[k] === v), api),
    is: (k: string, v: any) => (
      state.filters.push((r: any) => (v === null ? r[k] == null : r[k] === v)),
      api
    ),
    in: (k: string, arr: any[]) => (state.filters.push((r: any) => arr.includes(r[k])), api),
    or: (expr: string) => (state.filters.push(orFilter(expr)), api),
    limit: (n: number) => ((state.limit = n), api),
    maybeSingle: () => ((state.single = true), api),
    single: () => ((state.single = true), api),
    update: (patch: any) => ((state.update = patch), api),
    insert: (row: any) => {
      const r = { id: `job-${++seq}`, locked_until: null, attempts: 0, max_attempts: 2, ...row };
      db[table].push(r);
      return { select: () => ({ single: async () => ({ data: r, error: null }) }) };
    },
    then(resolve: any) {
      let rows = db[table].filter((r) => state.filters.every((f: any) => f(r)));
      if (state.update) for (const r of rows) Object.assign(r, state.update);
      if (state.limit) rows = rows.slice(0, state.limit);
      resolve({ data: state.single ? (rows.length === 1 ? rows[0] : null) : rows, error: null });
    },
  };
  return api;
}
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => builder(t) },
}));

let mod: typeof import("./admin-jobs.server");
const echteFetch = globalThis.fetch;
beforeEach(async () => {
  db.admin_jobs = [];
  process.env.ADMIN_AUTOMATION_SECRET = "test-secret";
  mod = await import("./admin-jobs.server");
  vi.stubGlobal("fetch", echteFetch);
});

describe("startAdminJob (Doppelstart je Kunde + Lauftyp)", () => {
  it("legt sofort einen queued-Job an; zweiter Start liefert DENSELBEN Job", async () => {
    const a = await mod.startAdminJob({
      organizationId: ORG,
      clientId: KUNDE,
      jobType: "datenlauf",
      userId: "u1",
    });
    expect(a.bereitsLaufend).toBe(false);
    expect(a.job.status).toBe("queued");
    const b = await mod.startAdminJob({
      organizationId: ORG,
      clientId: KUNDE,
      jobType: "datenlauf",
      userId: "u2",
    });
    expect(b.bereitsLaufend).toBe(true);
    expect(b.job.id).toBe(a.job.id);
    expect(db.admin_jobs.length).toBe(1);
  });

  it("anderer Kunde oder anderer Lauftyp bekommt einen EIGENEN Job", async () => {
    await mod.startAdminJob({
      organizationId: ORG,
      clientId: KUNDE,
      jobType: "datenlauf",
      userId: null,
    });
    const anders = await mod.startAdminJob({
      organizationId: ORG,
      clientId: "22222222-2222-4222-8222-222222222222",
      jobType: "datenlauf",
      userId: null,
    });
    expect(anders.bereitsLaufend).toBe(false);
    expect(db.admin_jobs.length).toBe(2);
  });
});

describe("tickeAdminJobs (Lock, Erfolg, begrenzter Retry)", () => {
  it("erfolgreicher Lauf -> fertig mit result; gelockte Jobs werden uebersprungen", async () => {
    const { job } = await mod.startAdminJob({
      organizationId: ORG,
      clientId: KUNDE,
      jobType: "datenlauf",
      userId: null,
    });
    vi.stubGlobal("fetch", async () => Response.json({ summary: { ok: 1 } }));
    const r = await mod.tickeAdminJobs(120_000, "http://test");
    expect(r).toEqual({ getickt: 1, fertig: 1, fehler: 0 });
    expect(db.admin_jobs[0].status).toBe("fertig");
    expect(db.admin_jobs[0].result).toEqual({ ok: 1 });
    // Fertiger Job wird nie erneut getickt.
    const r2 = await mod.tickeAdminJobs(120_000, "http://test");
    expect(r2.getickt).toBe(0);
    void job;
  });

  it("Fehler -> zurueck in die Queue; ab max_attempts endgueltig fehler", async () => {
    await mod.startAdminJob({
      organizationId: ORG,
      clientId: KUNDE,
      jobType: "datenlauf",
      userId: null,
    });
    vi.stubGlobal("fetch", async () => Response.json({ error: "kaputt" }, { status: 500 }));
    const r1 = await mod.tickeAdminJobs(120_000, "http://test");
    expect(r1).toEqual({ getickt: 1, fertig: 0, fehler: 0 });
    expect(db.admin_jobs[0].status).toBe("queued");
    expect(db.admin_jobs[0].attempts).toBe(1);
    // Cooldown: im selben Tick wird NICHT sofort erneut versucht.
    expect(db.admin_jobs[0].locked_until).toBeTruthy();
    db.admin_jobs[0].locked_until = null; // Cooldown abgelaufen (simuliert)
    const r2 = await mod.tickeAdminJobs(120_000, "http://test");
    expect(r2.fehler).toBe(1);
    expect(db.admin_jobs[0].status).toBe("fehler");
    expect(db.admin_jobs[0].error).toContain("kaputt");
    // Endgueltig fehlgeschlagene Jobs bleiben liegen.
    const r3 = await mod.tickeAdminJobs(120_000, "http://test");
    expect(r3.getickt).toBe(0);
  });

  it("laufender Job mit gehaltenem Lock wird nicht doppelt gefahren", async () => {
    const { job } = await mod.startAdminJob({
      organizationId: ORG,
      clientId: KUNDE,
      jobType: "datenlauf",
      userId: null,
    });
    db.admin_jobs[0].status = "laufend";
    db.admin_jobs[0].locked_until = new Date(Date.now() + 5 * 60_000).toISOString();
    const r = await mod.tickeAdminJobs(120_000, "http://test");
    expect(r.getickt).toBe(0);
    void job;
  });
});
