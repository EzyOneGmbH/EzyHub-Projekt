// Deployment-Smoke-Auswertung (13.09.2026): bewerteScheduler macht aus den
// Rohdaten von scheduler_status() konkrete, benannte Befunde — je Komponente
// (pg_cron, pg_net, Vault, Heartbeat, Watchdog, Sweep) ein klarer Fehlertext.
import { describe, it, expect } from "vitest";
import { bewerteScheduler, type SchedulerRoh } from "./scheduler-status.server";

const JETZT = Date.parse("2026-09-13T20:15:50Z");
const vor = (sek: number) => new Date(JETZT - sek * 1000).toISOString();

// Form wie die Live-Antwort von public.scheduler_status() (alles gruen).
const gesund = (): SchedulerRoh => ({
  now: new Date(JETZT).toISOString(),
  extensions: [
    { name: "supabase_vault", version: "0.3.1" },
    { name: "pg_cron", version: "1.6.4" },
    { name: "pg_net", version: "0.20.0" },
  ],
  jobs: [
    { jobid: 1, jobname: "ezy-analyse-worker", schedule: "* * * * *", active: true },
    { jobid: 2, jobname: "ezy-analyse-watchdog", schedule: "*/5 * * * *", active: true },
  ],
  runs: [
    {
      jobname: "ezy-analyse-worker",
      status: "succeeded",
      message: "1 row",
      start_time: vor(50),
      end_time: vor(49),
    },
    {
      jobname: "ezy-analyse-watchdog",
      status: "succeeded",
      message: "1 row",
      start_time: vor(50),
      end_time: vor(49),
    },
    {
      jobname: "ezy-analyse-worker",
      status: "succeeded",
      message: "1 row",
      start_time: vor(110),
      end_time: vor(109),
    },
  ],
  http: [
    {
      id: 147,
      status_code: 200,
      timed_out: false,
      error_msg: "",
      content: '{"ok":true}',
      created: vor(50),
    },
  ],
  vault: [{ name: "admin_automation_secret", updated_at: vor(8000) }],
  heartbeat: {
    id: 1,
    errors: 0,
    source: "pg_cron",
    last_error: null,
    duration_ms: 427,
    last_run_at: vor(49),
    lease_until: null,
    last_sweep_at: vor(290),
    jobs_processed: 0,
    consecutive_error_ticks: 0,
  },
  watchdog: { zustand: "aktiv", alter_min: 0 },
});

const status = (roh: SchedulerRoh) =>
  Object.fromEntries(bewerteScheduler(roh, JETZT).map((c) => [c.id, c]));

describe("bewerteScheduler", () => {
  it("gesunder Stand: alle Checks ok, mit Alter/Version im Detail", () => {
    const s = status(gesund());
    expect(Object.values(s).every((c) => c.status === "ok")).toBe(true);
    expect(Object.keys(s).sort()).toEqual(
      [
        "cron_ezy-analyse-watchdog",
        "cron_ezy-analyse-worker",
        "ext_pg_cron",
        "ext_pg_net",
        "ext_supabase_vault",
        "heartbeat",
        "pg_net",
        "sweep",
        "vault",
        "watchdog",
      ].sort(),
    );
    expect(s.ext_pg_cron.detail).toBe("v1.6.4");
    expect(s.heartbeat.detail).toMatch(/aktiv via pg_cron/);
  });

  it("pg_net 401 benennt das abweichende Vault-Secret konkret", () => {
    const roh = gesund();
    (roh.http as any[])[0] = {
      ...(roh.http as any[])[0],
      status_code: 401,
      content: '{"ok":false,"error":"Unauthorized"}',
    };
    expect(status(roh).pg_net).toMatchObject({
      status: "fehlerhaft",
      detail: expect.stringMatching(/401.*admin_automation_secret/),
    });
  });

  it("fehlender/deaktivierter/veralteter Cron-Job wird je eigen benannt", () => {
    const ohne = gesund();
    ohne.jobs = (ohne.jobs as any[]).filter((j) => j.jobname !== "ezy-analyse-watchdog");
    expect(status(ohne)["cron_ezy-analyse-watchdog"]).toMatchObject({ status: "fehlt" });

    const inaktiv = gesund();
    (inaktiv.jobs as any[])[0].active = false;
    expect(status(inaktiv)["cron_ezy-analyse-worker"].detail).toMatch(/deaktiviert/);

    const alt = gesund();
    (alt.runs as any[]).forEach((r) => (r.start_time = vor(15 * 60)));
    expect(status(alt)["cron_ezy-analyse-worker"].detail).toMatch(
      /vor 15 min.*pg_cron laeuft nicht/,
    );

    const fehl = gesund();
    (fehl.runs as any[])[0] = {
      ...(fehl.runs as any[])[0],
      status: "failed",
      message: "permission denied",
    };
    expect(status(fehl)["cron_ezy-analyse-worker"].detail).toMatch(/failed: permission denied/);
  });

  it("Heartbeat: Ausfall, Verzoegerung, Fallback-Quelle und Fehlerserie", () => {
    const aus = gesund();
    aus.heartbeat!.last_run_at = vor(12 * 60);
    expect(status(aus).heartbeat.detail).toMatch(/kein Tick seit 12 min/);

    const spaet = gesund();
    spaet.heartbeat!.last_run_at = vor(5 * 60);
    expect(status(spaet).heartbeat).toMatchObject({ status: "fehlerhaft" });

    const fallback = gesund();
    fallback.heartbeat!.source = "windows-fallback";
    expect(status(fallback).heartbeat.detail).toMatch(/windows-fallback.*statt pg_cron/);

    const serie = gesund();
    serie.heartbeat!.consecutive_error_ticks = 3;
    serie.heartbeat!.last_error = "DB weg";
    expect(status(serie).heartbeat.detail).toMatch(/3 Fehler-Ticks in Folge: DB weg/);
  });

  it("Vault-Secret fehlt → Anleitung; Watchdog-Fehler und Sweep-Rueckstand sichtbar", () => {
    const roh = gesund();
    roh.vault = [];
    roh.watchdog = { error: 'relation "vault.decrypted_secrets" does not exist' };
    roh.heartbeat!.last_sweep_at = vor(45 * 60);
    const s = status(roh);
    expect(s.vault).toMatchObject({
      status: "fehlt",
      detail: expect.stringMatching(/vault.create_secret/),
    });
    expect(s.watchdog).toMatchObject({
      status: "fehlerhaft",
      detail: expect.stringMatching(/decrypted_secrets/),
    });
    expect(s.sweep).toMatchObject({
      status: "fehlerhaft",
      detail: expect.stringMatching(/vor 45 min/),
    });
  });

  it("Rohdaten mit Lesefehlern (z. B. cron-Schema gesperrt) → nicht_pruefbar statt Absturz", () => {
    const roh = gesund();
    roh.jobs = { error: "permission denied for schema cron" };
    roh.http = { error: "permission denied for schema net" };
    const s = status(roh);
    expect(s["cron_ezy-analyse-worker"]).toMatchObject({ status: "nicht_pruefbar" });
    expect(s.pg_net).toMatchObject({ status: "nicht_pruefbar" });
  });
});
