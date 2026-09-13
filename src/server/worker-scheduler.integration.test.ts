// Verwalteter Worker-Scheduler (13.09.2026): Beweisfuehrung gegen eine
// In-Memory-DB — parallele Worker (Lease), Lease-/Lock-Ablauf, Retry,
// Heartbeat-Ausfall-Bewertung, Fehler-Alarm (dedupliziert, Webhook einmal)
// und Wiedervorlage-Meldungen OHNE Browserbesuch.
import { describe, it, expect, beforeEach, vi } from "vitest";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const KUNDE_A = "11111111-1111-4111-8111-111111111111";
const KUNDE_B = "22222222-2222-4222-8222-222222222222";
const OWNER_A = "u-owner-a";
const ADMIN_A = "u-admin-a";
const MEMBER_A = "u-member-a";
const ADMIN_B = "u-admin-b";

const db: Record<string, any[]> = {};
let seq = 0;
function reset() {
  for (const k of Object.keys(db)) delete db[k];
  Object.assign(db, {
    prospect_audits: [],
    admin_jobs: [],
    analyse_worker_heartbeat: [],
    app_notifications: [],
    ai_opportunity_states: [],
    app_users: [
      { organization_id: ORG_A, user_id: OWNER_A, role: "owner" },
      { organization_id: ORG_A, user_id: ADMIN_A, role: "admin" },
      { organization_id: ORG_A, user_id: MEMBER_A, role: "member" },
      { organization_id: ORG_B, user_id: ADMIN_B, role: "admin" },
    ],
  });
}

// Mini-Query-Builder: Filter (eq/in/is/lt/lte/gte/or), update, insert,
// upsert (onConflict + ignoreDuplicates liefert NUR neue Zeilen — wie
// PostgREST mit resolution=ignore-duplicates,return=representation).
function cmp(op: string, a: any, b: any) {
  if (a == null) return false;
  const x = String(a);
  const y = String(b);
  if (op === "lt") return x < y;
  if (op === "lte") return x <= y;
  if (op === "gt") return x > y;
  if (op === "gte") return x >= y;
  if (op === "eq") return x === y;
  return false;
}
function orFilter(expr: string) {
  return (r: any) =>
    expr.split(",").some((teil) => {
      const [feld, op, ...rest] = teil.split(".");
      const wert = rest.join(".");
      if (op === "is" && wert === "null") return r[feld] == null;
      return cmp(op, r[feld], wert);
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
    lt: (k: string, v: any) => (state.filters.push((r: any) => cmp("lt", r[k], v)), api),
    lte: (k: string, v: any) => (state.filters.push((r: any) => cmp("lte", r[k], v)), api),
    gte: (k: string, v: any) => (state.filters.push((r: any) => cmp("gte", r[k], v)), api),
    or: (expr: string) => (state.filters.push(orFilter(expr)), api),
    limit: (n: number) => ((state.limit = n), api),
    maybeSingle: () => ((state.single = true), api),
    single: () => ((state.single = true), api),
    update: (patch: any) => ((state.update = patch), api),
    upsert: (rows: any, opts: any = {}) => (
      (state.upsert = { rows: Array.isArray(rows) ? rows : [rows], opts }),
      api
    ),
    insert: (row: any) => {
      const r = { id: `row-${++seq}`, locked_until: null, attempts: 0, max_attempts: 2, ...row };
      db[table].push(r);
      return { select: () => ({ single: async () => ({ data: r, error: null }) }) };
    },
    then(resolve: any) {
      if (state.upsert) {
        const key = state.upsert.opts.onConflict || "id";
        const neu: any[] = [];
        for (const row of state.upsert.rows) {
          const vorhanden =
            row[key] != null ? db[table].find((r) => r[key] === row[key]) : undefined;
          if (vorhanden) {
            if (!state.upsert.opts.ignoreDuplicates) Object.assign(vorhanden, row);
            continue;
          }
          const r = { id: row.id ?? `row-${++seq}`, ...row };
          db[table].push(r);
          neu.push(r);
        }
        return resolve({ data: neu, error: null });
      }
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
// Etappen-Aussenwelt der Analyse (Site-Health) — kontrolliert fehlschlagen lassen.
const siteHealth = vi.fn();
vi.mock("@/routes/api/admin.site-health", () => ({
  runSiteHealthForDomain: (...a: any[]) => siteHealth(...a),
  fetchText: async () => ({ ok: false, text: "" }),
  botBlocked: () => false,
  CRITICAL_BOTS: [],
}));

let ws: typeof import("./worker-scheduler.server");
let pa: typeof import("./prospect-audit.server");
const echteFetch = globalThis.fetch;
const still = { getickt: 0, fertig: 0, fehler: 0 };
const ok = async () => ({ ...still });
const iso = (ms: number) => new Date(ms).toISOString();

beforeEach(async () => {
  reset();
  seq = 0;
  process.env.ADMIN_AUTOMATION_SECRET = "test-secret";
  delete process.env.WORKER_ALARM_WEBHOOK_URL;
  vi.stubGlobal("fetch", echteFetch);
  ws = await import("./worker-scheduler.server");
  pa = await import("./prospect-audit.server");
});

describe("Parallele Worker (Lease)", () => {
  it("zwei gleichzeitige Ticks: genau EINER arbeitet, der andere meldet uebersprungen", async () => {
    let laeufe = 0;
    const langsam = async () => {
      laeufe++;
      await new Promise((r) => setTimeout(r, 20));
      return { ...still };
    };
    const [a, b] = await Promise.all([
      ws.runWorkerTick(
        { origin: "http://t", source: "pg_cron" },
        { tickeOffeneAudits: langsam, tickeAdminJobs: ok },
      ),
      ws.runWorkerTick(
        { origin: "http://t", source: "pg_cron" },
        { tickeOffeneAudits: langsam, tickeAdminJobs: ok },
      ),
    ]);
    expect(laeufe).toBe(1);
    expect([a, b].filter((r: any) => r.uebersprungen === "lease").length).toBe(1);
    // Nach dem Tick ist die Lease frei und der Heartbeat traegt die Quelle.
    const hb = db.analyse_worker_heartbeat[0];
    expect(hb.lease_until).toBeNull();
    expect(hb.source).toBe("pg_cron");
    expect(hb.last_run_at).toBeTruthy();
  });

  it("gehaltene Lease in der Zukunft blockt; abgelaufene Lease (abgestuerzter Tick) wird uebernommen", async () => {
    db.analyse_worker_heartbeat.push({
      id: 1,
      last_run_at: iso(Date.now() - 60_000),
      lease_until: iso(Date.now() + 120_000),
      lease_holder: "pg_cron:lebt",
      consecutive_error_ticks: 0,
    });
    const gesperrt: any = await ws.runWorkerTick(
      { origin: "http://t", source: "pg_cron" },
      { tickeOffeneAudits: ok, tickeAdminJobs: ok },
    );
    expect(gesperrt.uebersprungen).toBe("lease");
    expect(db.analyse_worker_heartbeat[0].lease_holder).toBe("pg_cron:lebt");

    db.analyse_worker_heartbeat[0].lease_until = iso(Date.now() - 1000); // Instanz tot, Lease abgelaufen
    const frei: any = await ws.runWorkerTick(
      { origin: "http://t", source: "windows-fallback" },
      { tickeOffeneAudits: ok, tickeAdminJobs: ok },
    );
    expect(frei.uebersprungen).toBeUndefined();
    expect(db.analyse_worker_heartbeat[0].source).toBe("windows-fallback");
    expect(db.analyse_worker_heartbeat[0].lease_until).toBeNull();
  });

  it("Lease wird auch bei Tick-Exception freigegeben und der Fehler im Heartbeat vermerkt", async () => {
    const r: any = await ws.runWorkerTick(
      { origin: "http://t", source: "pg_cron" },
      {
        tickeOffeneAudits: async () => {
          throw new Error("DB weg");
        },
        tickeAdminJobs: ok,
      },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain("DB weg");
    const hb = db.analyse_worker_heartbeat[0];
    expect(hb.lease_until).toBeNull();
    expect(hb.last_error).toContain("DB weg");
    expect(hb.consecutive_error_ticks).toBe(1);
  });
});

describe("Lock-Ablauf + Retry (echter Job-Code)", () => {
  it("prospect_audits: abgelaufener Etappen-Lock wird uebernommen; Fehler → exponentielles Retry, ab max_attempts endgueltig", async () => {
    siteHealth.mockRejectedValue(new Error("Crawler down"));
    const { audit } = await pa.startAudit({
      organizationId: ORG_A,
      userId: "u1",
      domain: "lock.ch",
      firmenname: "Lock AG",
      wettbewerber: [],
    });
    const row = db.prospect_audits[0];
    row.stage = "technik";
    row.status = "laufend";
    row.locked_until = iso(Date.now() - 5_000); // Lock eines abgestuerzten Workers
    row.max_attempts = 3;

    const t1: any = await ws.runWorkerTick({ origin: "http://t" }, { tickeAdminJobs: ok });
    expect(t1.getickt).toBe(1);
    expect(row.status).toBe("retry");
    expect(row.attempts).toBe(1);
    expect(row.last_error).toContain("Crawler down");
    // Retry-Plan bleibt erhalten (Bugfix 13.09.): ~1 min Wartezeit, Lock frei.
    expect(new Date(row.next_retry_at).getTime()).toBeGreaterThan(Date.now() + 50_000);
    expect(row.locked_until).toBeNull();

    // Waehrend der Wartezeit rührt der Worker den Job NICHT an.
    const t2: any = await ws.runWorkerTick({ origin: "http://t" }, { tickeAdminJobs: ok });
    expect(t2.getickt).toBe(0);

    // Wartezeit abgelaufen → 2. Versuch (2 min), dann 3. → endgueltig fehler.
    row.next_retry_at = iso(Date.now() - 1000);
    await ws.runWorkerTick({ origin: "http://t" }, { tickeAdminJobs: ok });
    expect(row.attempts).toBe(2);
    expect(row.status).toBe("retry");
    expect(new Date(row.next_retry_at).getTime()).toBeGreaterThan(Date.now() + 110_000);
    row.next_retry_at = iso(Date.now() - 1000);
    const t4: any = await ws.runWorkerTick({ origin: "http://t" }, { tickeAdminJobs: ok });
    expect(t4.fehler).toBe(1);
    expect(row.status).toBe("fehler");
    expect(row.attempts).toBe(3);
    expect(row.next_retry_at).toBeNull();
    // Endgueltig fehlgeschlagene Jobs werden NIE wieder aufgenommen.
    const t5: any = await ws.runWorkerTick({ origin: "http://t" }, { tickeAdminJobs: ok });
    expect(t5.getickt).toBe(0);
    void audit;
  });

  it("admin_jobs: abgelaufener Lock wird uebernommen, Fehler → Cooldown-Retry, dann endgueltig", async () => {
    db.admin_jobs.push({
      id: "job-x",
      organization_id: ORG_A,
      client_id: KUNDE_A,
      job_type: "datenlauf",
      status: "laufend",
      locked_until: iso(Date.now() - 1000),
      attempts: 0,
      max_attempts: 2,
      progress: 10,
    });
    vi.stubGlobal("fetch", async () => Response.json({ error: "kaputt" }, { status: 500 }));
    const t1: any = await ws.runWorkerTick({ origin: "http://t" }, { tickeOffeneAudits: ok });
    expect(t1.adminJobs).toEqual({ getickt: 1, fertig: 0, fehler: 0 });
    expect(db.admin_jobs[0].status).toBe("queued");
    expect(db.admin_jobs[0].attempts).toBe(1);
    expect(db.admin_jobs[0].locked_until).toBeTruthy(); // Cooldown
    db.admin_jobs[0].locked_until = iso(Date.now() - 1000);
    const t2: any = await ws.runWorkerTick({ origin: "http://t" }, { tickeOffeneAudits: ok });
    expect(t2.adminJobs.fehler).toBe(1);
    expect(db.admin_jobs[0].status).toBe("fehler");
  });
});

describe("Heartbeat-Ausfall + wiederholte Fehler", () => {
  it("bewerteHeartbeat: aktiv < 3 min, verzoegert 3–10 min, ausgefallen > 10 min oder nie", () => {
    const jetzt = Date.now();
    expect(ws.bewerteHeartbeat(null, jetzt).zustand).toBe("ausgefallen");
    expect(ws.bewerteHeartbeat({ last_run_at: iso(jetzt - 60_000) }, jetzt).zustand).toBe("aktiv");
    expect(ws.bewerteHeartbeat({ last_run_at: iso(jetzt - 5 * 60_000) }, jetzt).zustand).toBe(
      "verzoegert",
    );
    expect(ws.bewerteHeartbeat({ last_run_at: iso(jetzt - 11 * 60_000) }, jetzt).zustand).toBe(
      "ausgefallen",
    );
  });

  it("3 Fehler-Ticks in Folge → EIN Alarm je Admin (owner/admin beider Orgs), dedupliziert, Webhook genau einmal", async () => {
    process.env.WORKER_ALARM_WEBHOOK_URL = "https://n8n.test/webhook";
    const webhook = vi.fn(async () => new Response("ok", { status: 200 }));
    const schlecht = async () => ({ getickt: 1, fertig: 0, fehler: 1 });
    const deps = { tickeOffeneAudits: schlecht, tickeAdminJobs: ok, fetchImpl: webhook as any };
    const r1: any = await ws.runWorkerTick({ origin: "http://t" }, deps);
    const r2: any = await ws.runWorkerTick({ origin: "http://t" }, deps);
    expect(r1.alarm.alarm).toBe(false);
    expect(r2.alarm.alarm).toBe(false);
    expect(db.app_notifications.length).toBe(0);
    const r3: any = await ws.runWorkerTick({ origin: "http://t" }, deps);
    expect(r3.alarm.alarm).toBe(true);
    expect(r3.alarm.grund).toContain("3 Worker-Ticks in Folge");
    expect(db.analyse_worker_heartbeat[0].consecutive_error_ticks).toBe(3);
    const empfaenger = db.app_notifications.map((n) => n.recipient_user_id).sort();
    expect(empfaenger).toEqual([ADMIN_A, ADMIN_B, OWNER_A].sort()); // Member bekommt nichts
    expect(
      db.app_notifications.every((n) => n.kind === "worker_alarm" && n.client_id === null),
    ).toBe(true);
    expect(webhook).toHaveBeenCalledTimes(1);
    expect((webhook.mock.calls[0] as any)[0]).toBe("https://n8n.test/webhook");
    // 4. Fehler-Tick: gleiches 6h-Fenster → keine neuen Meldungen, kein zweiter Webhook.
    const r4: any = await ws.runWorkerTick({ origin: "http://t" }, deps);
    expect(r4.alarm.neu).toBe(0);
    expect(db.app_notifications.length).toBe(3);
    expect(webhook).toHaveBeenCalledTimes(1);
    // Ein sauberer Tick setzt die Serie zurueck.
    await ws.runWorkerTick({ origin: "http://t" }, { tickeOffeneAudits: ok, tickeAdminJobs: ok });
    expect(db.analyse_worker_heartbeat[0].consecutive_error_ticks).toBe(0);
  });

  it("≥ 3 endgueltig fehlgeschlagene Jobs in 60 min alarmieren auch ohne Fehlerserie", async () => {
    const vorhin = iso(Date.now() - 10 * 60_000);
    db.prospect_audits.push(
      { id: "f1", status: "fehler", updated_at: vorhin },
      { id: "f2", status: "fehler", updated_at: vorhin },
      { id: "alt", status: "fehler", updated_at: iso(Date.now() - 3 * 3600_000) }, // zu alt
    );
    db.admin_jobs.push({ id: "f3", status: "fehler", updated_at: vorhin });
    const r: any = await ws.runWorkerTick(
      { origin: "http://t" },
      { tickeOffeneAudits: ok, tickeAdminJobs: ok },
    );
    expect(r.alarm.alarm).toBe(true);
    expect(r.alarm.fehlerStunde).toBe(3);
    expect(db.app_notifications.length).toBe(3);
  });
});

describe("Wiedervorlagen ohne Browserbesuch (Sweep)", () => {
  const states = () =>
    db.ai_opportunity_states.push(
      {
        organization_id: ORG_A,
        client_id: KUNDE_A,
        fingerprint: "fp-zugewiesen",
        title: "Schema fehlt",
        status: "in_bearbeitung",
        resurface_on: "2026-09-10",
        assignee_user_id: MEMBER_A,
      },
      {
        organization_id: ORG_A,
        client_id: KUNDE_A,
        fingerprint: "fp-ohne",
        title: "FAQ ergänzen",
        status: "offen",
        resurface_on: "2026-09-13",
        assignee_user_id: null,
      },
      {
        organization_id: ORG_B,
        client_id: KUNDE_B,
        fingerprint: "fp-b",
        title: null,
        status: "pausiert",
        resurface_on: "2026-09-01",
        assignee_user_id: null,
      },
      {
        organization_id: ORG_A,
        client_id: KUNDE_A,
        fingerprint: "fp-zukunft",
        title: "später",
        status: "offen",
        resurface_on: "2026-09-14",
        assignee_user_id: null,
      },
      {
        organization_id: ORG_A,
        client_id: KUNDE_A,
        fingerprint: "fp-erledigt",
        title: "fertig",
        status: "erledigt",
        resurface_on: "2026-09-01",
        assignee_user_id: null,
      },
      {
        organization_id: ORG_A,
        client_id: KUNDE_A,
        fingerprint: "fp-ohne-datum",
        title: "x",
        status: "offen",
        resurface_on: null,
        assignee_user_id: null,
      },
    );

  it("faellige Eintraege → Meldung an assignee_user_id, sonst an die Org-Admins; nicht faellig/erledigt/ohne Datum nie", async () => {
    states();
    const r = await ws.sweepWiedervorlagen({ heute: "2026-09-13" });
    expect(r).toEqual({ faellig: 3, empfaenger: 4, neu: 4 });
    const n = db.app_notifications;
    const zu = (fp: string) =>
      n
        .filter((x) => x.dedupe_key.includes(`:${fp}:`))
        .map((x) => x.recipient_user_id)
        .sort();
    expect(zu("fp-zugewiesen")).toEqual([MEMBER_A]);
    expect(zu("fp-ohne")).toEqual([ADMIN_A, OWNER_A].sort());
    expect(zu("fp-b")).toEqual([ADMIN_B]);
    expect(zu("fp-zukunft")).toEqual([]);
    expect(zu("fp-erledigt")).toEqual([]);
    expect(n.every((x) => x.kind === "resurface_due" && x.link_section === "opportunities")).toBe(
      true,
    );
    expect(n.find((x) => x.dedupe_key.includes(":fp-b:"))!.title).toBe(
      "Wiedervorlage fällig: Chance",
    );
    expect(n.find((x) => x.dedupe_key.includes(":fp-ohne:"))!.client_id).toBe(KUNDE_A);
    // Zweiter Sweep (Reload, zweiter Worker, naechster Tag): keine Duplikate.
    const r2 = await ws.sweepWiedervorlagen({ heute: "2026-09-14" });
    expect(r2.neu).toBe(2); // nur fp-zukunft ist neu faellig → 2 Org-Admins
    expect(db.app_notifications.length).toBe(6);
  });

  it("der Worker-Tick sweept alle 15 Minuten von selbst — ohne Panel, ohne Browser", async () => {
    states();
    const deps = { tickeOffeneAudits: ok, tickeAdminJobs: ok };
    const r1: any = await ws.runWorkerTick({ origin: "http://t" }, deps);
    expect(r1.sweep.neu).toBeGreaterThan(0);
    expect(db.analyse_worker_heartbeat[0].last_sweep_at).toBeTruthy();
    const r2: any = await ws.runWorkerTick({ origin: "http://t" }, deps);
    expect(r2.sweep).toBeNull(); // innerhalb 15 min kein erneuter Sweep
    db.analyse_worker_heartbeat[0].last_sweep_at = iso(Date.now() - 16 * 60_000);
    const r3: any = await ws.runWorkerTick({ origin: "http://t" }, deps);
    expect(r3.sweep).not.toBeNull();
    expect(r3.sweep.neu).toBe(0); // dedupliziert
  });
});
