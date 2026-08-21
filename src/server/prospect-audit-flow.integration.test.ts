// Flow-Integrationstests fuer den Async-Umbau (21.08.2026): echte
// startAudit/tickAudit/tickeOffeneAudits/abbrechenAudit gegen eine In-Memory-
// prospect_audits-Tabelle — beweist Doppelstart-Schutz, Tick-Lock (doppelte
// Worker fahren keine Etappe doppelt) und dass Abbrueche endgueltig sind.
import { describe, it, expect, beforeEach, vi } from "vitest";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const db: Record<string, any[]> = { prospect_audits: [], analyse_worker_heartbeat: [] };
let seq = 0;

// Mini-Query-Builder inkl. .or()-Parsing fuer die Lock-/Retry-Gates
// (`x.is.null,x.lt.<iso>` bzw. `x.is.null,x.lte.<iso>`).
function orFilter(expr: string) {
  return (r: any) =>
    expr.split(",").some((teil) => {
      const [feld, op, ...rest] = teil.split(".");
      const wert = rest.join(".");
      if (op === "is" && wert === "null") return r[feld] == null;
      if (op === "lt") return r[feld] != null && String(r[feld]) < wert;
      if (op === "lte") return r[feld] != null && String(r[feld]) <= wert;
      return false;
    });
}
function builder(table: string) {
  const state: any = { filters: [], limit: 0, single: false };
  const api: any = {
    select: () => api,
    order: () => api,
    eq: (k: string, v: any) => (state.filters.push((r: any) => r[k] === v), api),
    in: (k: string, arr: any[]) => (state.filters.push((r: any) => arr.includes(r[k])), api),
    or: (expr: string) => (state.filters.push(orFilter(expr)), api),
    limit: (n: number) => ((state.limit = n), api),
    maybeSingle: () => ((state.single = true), api),
    single: () => ((state.single = true), api),
    update: (patch: any) => ((state.update = patch), api),
    upsert: (row: any) => {
      const i = db[table].findIndex((r) => r.id === row.id);
      if (i >= 0) db[table][i] = { ...db[table][i], ...row };
      else db[table].push(row);
      return Promise.resolve({ data: null, error: null });
    },
    insert: (row: any) => {
      const r = { id: `job-${++seq}`, locked_until: null, next_retry_at: null, ...row };
      db[table].push(r);
      return {
        select: () => ({
          single: async () => ({ data: r, error: null }),
        }),
      };
    },
    then(resolve: any) {
      let rows = db[table].filter((r) => state.filters.every((f: any) => f(r)));
      if (state.update) for (const r of rows) Object.assign(r, state.update);
      if (state.limit) rows = rows.slice(0, state.limit);
      const data = state.single ? (rows.length === 1 ? rows[0] : null) : rows;
      resolve({ data, error: null });
    },
  };
  return api;
}
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => builder(t) },
}));

let mod: typeof import("./prospect-audit.server");
beforeEach(async () => {
  db.prospect_audits = [];
  db.analyse_worker_heartbeat = [];
  mod = await import("./prospect-audit.server");
});

const startOpts = (domain: string) => ({
  organizationId: ORG,
  userId: "u1",
  domain,
  firmenname: "Test AG",
  wettbewerber: [],
});

describe("startAudit (sofortiger Job, Doppelstart-Schutz)", () => {
  it("legt den Job OHNE externe Aufrufe an: queued, stage=prompts, progress=0", async () => {
    const { audit, bereitsLaufend } = await mod.startAudit(startOpts("www.test-ag.ch"));
    expect(bereitsLaufend).toBe(false);
    expect(audit.status).toBe("queued");
    expect(audit.stage).toBe("prompts");
    expect(audit.progress).toBe(0);
    expect(audit.domain).toBe("test-ag.ch"); // normalisiert
    expect(audit.data.prompts).toBeUndefined(); // Prompts erst im Worker
  });

  it("Doppelstart derselben normalisierten Domain liefert DENSELBEN Job", async () => {
    const a = await mod.startAudit(startOpts("test-ag.ch"));
    const b = await mod.startAudit(startOpts("https://WWW.Test-AG.ch/"));
    expect(b.bereitsLaufend).toBe(true);
    expect(b.audit.id).toBe(a.audit.id);
    expect(db.prospect_audits.length).toBe(1);
    // Auch ein Job im retry-Wartezustand blockt einen Neustart.
    db.prospect_audits[0].status = "retry";
    const c = await mod.startAudit(startOpts("test-ag.ch"));
    expect(c.bereitsLaufend).toBe(true);
  });

  it("nach Abschluss/Abbruch ist ein Neustart wieder moeglich", async () => {
    const a = await mod.startAudit(startOpts("test-ag.ch"));
    db.prospect_audits[0].status = "abgebrochen";
    const b = await mod.startAudit(startOpts("test-ag.ch"));
    expect(b.bereitsLaufend).toBe(false);
    expect(b.audit.id).not.toBe(a.audit.id);
  });
});

describe("Tick-Lock (doppelte Worker)", () => {
  it("ein gehaltener Lock verhindert jeden zweiten Tick derselben Etappe", async () => {
    const { audit } = await mod.startAudit(startOpts("lock-test.ch"));
    // Worker 1 haelt den Lock (Zukunft):
    db.prospect_audits[0].status = "laufend";
    db.prospect_audits[0].locked_until = new Date(Date.now() + 4 * 60_000).toISOString();
    db.prospect_audits[0].stage = "irrelevant";
    const vorher = JSON.stringify(db.prospect_audits[0]);
    const r = await mod.tickAudit(audit.id);
    expect(JSON.stringify(db.prospect_audits[0])).toBe(vorher); // NICHTS veraendert
    expect(r.id).toBe(audit.id);
  });

  it("tickeOffeneAudits ueberspringt gelockte und retry-wartende Jobs", async () => {
    const { audit } = await mod.startAudit(startOpts("skip-test.ch"));
    db.prospect_audits[0].locked_until = new Date(Date.now() + 4 * 60_000).toISOString();
    const r1 = await mod.tickeOffeneAudits(1000);
    expect(r1.getickt).toBe(0);
    db.prospect_audits[0].locked_until = null;
    db.prospect_audits[0].status = "retry";
    db.prospect_audits[0].next_retry_at = new Date(Date.now() + 10 * 60_000).toISOString();
    const r2 = await mod.tickeOffeneAudits(1000);
    expect(r2.getickt).toBe(0);
    // Heartbeat wurde trotzdem geschrieben (Ausfall-Sichtbarkeit).
    expect(db.analyse_worker_heartbeat.length).toBe(1);
    expect(db.analyse_worker_heartbeat[0].jobs_processed).toBe(0);
    void audit;
  });

  it("ein claimbarer Job wird genau einmal getickt (Stage-Abschluss loest den Lock)", async () => {
    const { audit } = await mod.startAudit(startOpts("claim-test.ch"));
    // Unbekannte Stage -> default-Zweig beendet den Job ohne externe Calls.
    db.prospect_audits[0].stage = "unbekannte-stage";
    const r = await mod.tickAudit(audit.id);
    expect(r.status).toBe("fertig");
    expect(db.prospect_audits[0].last_started_at).toBeTruthy();
    expect(db.prospect_audits[0].locked_until).toBeNull();
    // Ein zweiter Tick auf den fertigen Job veraendert nichts mehr.
    const vorher = JSON.stringify(db.prospect_audits[0]);
    await mod.tickAudit(audit.id);
    expect(JSON.stringify(db.prospect_audits[0])).toBe(vorher);
  });
});

describe("Abbruch ist endgueltig", () => {
  it("abbrechenAudit stoppt queued/laufend/retry — Worker nimmt NIE wieder auf", async () => {
    const { audit } = await mod.startAudit(startOpts("abbruch-test.ch"));
    const r = await mod.abbrechenAudit(audit.id);
    expect(r.status).toBe("abgebrochen");
    expect(r.next_retry_at).toBeNull();
    const w = await mod.tickeOffeneAudits(1000);
    expect(w.getickt).toBe(0);
    // Auch ein direkter Tick claimt ihn nicht.
    const vorher = JSON.stringify(db.prospect_audits[0]);
    await mod.tickAudit(audit.id);
    expect(JSON.stringify(db.prospect_audits[0])).toBe(vorher);
  });

  it("fertige Jobs koennen nicht mehr abgebrochen werden", async () => {
    const { audit } = await mod.startAudit(startOpts("fertig-test.ch"));
    db.prospect_audits[0].status = "fertig";
    const r = await mod.abbrechenAudit(audit.id);
    expect(r.status).toBe("fertig"); // unveraendert
  });
});
