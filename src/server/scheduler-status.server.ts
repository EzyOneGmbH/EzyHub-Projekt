// Deployment-Smoke fuer den verwalteten Scheduler (13.09.2026, Volkan):
// EIN RPC (public.scheduler_status, SECURITY DEFINER, nur service_role)
// liefert Rohdaten zu pg_cron, pg_net, Vault-Secret-NAMEN, Heartbeat,
// Watchdog und Resurface-Sweep; diese Auswertung macht daraus konkrete,
// benannte Checks fuer den Admin-Systemcheck und scripts/smoke-deploy.mjs.
// Nie Geheimnisse — nur Status, Alter, Fehlertext.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  bewerteHeartbeat,
  SWEEP_INTERVALL_MS,
  HEARTBEAT_VERZOEGERT_MS,
} from "./worker-scheduler.server";

export type SchedulerCheckStatus = "ok" | "fehlerhaft" | "fehlt" | "nicht_pruefbar";
export type SchedulerCheck = {
  id: string;
  name: string;
  status: SchedulerCheckStatus;
  detail: string;
};

export type SchedulerRoh = {
  now?: string;
  extensions?: Array<{ name: string; version: string }>;
  jobs?:
    | Array<{ jobid: number; jobname: string; schedule: string; active: boolean }>
    | { error: string };
  runs?:
    | Array<{
        jobname: string;
        status: string;
        message: string;
        start_time: string;
        end_time: string | null;
      }>
    | { error: string };
  http?:
    | Array<{
        id: number;
        status_code: number | null;
        timed_out: boolean | null;
        error_msg: string;
        content: string;
        created: string;
      }>
    | { error: string };
  vault?: Array<{ name: string; updated_at: string }> | { error: string };
  heartbeat?: Record<string, any> | null;
  watchdog?: Record<string, any> | null;
};

const minuten = (ms: number) => Math.round(ms / 6000) / 10;
const alter = (iso: string | null | undefined, jetzt: number) =>
  iso ? jetzt - new Date(iso).getTime() : null;

/** Pure Auswertung (vitest-gedeckt): Rohdaten → konkrete Checks. */
export function bewerteScheduler(roh: SchedulerRoh, jetztMs = Date.now()): SchedulerCheck[] {
  const checks: SchedulerCheck[] = [];
  const push = (id: string, name: string, status: SchedulerCheckStatus, detail: string) =>
    checks.push({ id, name, status, detail });

  // Extensions
  const ext = new Map((roh.extensions ?? []).map((e) => [e.name, e.version]));
  for (const [name, label] of [
    ["pg_cron", "Extension pg_cron"],
    ["pg_net", "Extension pg_net"],
    ["supabase_vault", "Extension supabase_vault"],
  ] as const) {
    if (ext.has(name)) push(`ext_${name}`, label, "ok", `v${ext.get(name)}`);
    else
      push(
        `ext_${name}`,
        label,
        "fehlt",
        "nicht installiert — Migration 20260913180000 ausfuehren",
      );
  }

  // Cron-Jobs
  const jobs = Array.isArray(roh.jobs) ? roh.jobs : [];
  const jobsFehler = !Array.isArray(roh.jobs) && roh.jobs?.error;
  const runs = Array.isArray(roh.runs) ? roh.runs : [];
  for (const [jobname, schedule, maxAlterMs] of [
    ["ezy-analyse-worker", "* * * * *", 3 * 60_000],
    ["ezy-analyse-watchdog", "*/5 * * * *", 7 * 60_000],
    // ChatGPT-Ads Auto-Sync (21.09.2026): alle 12 h, Toleranz 13 h.
    ["ezy-chatgpt-ads-sync", "15 */12 * * *", 13 * 3_600_000],
  ] as const) {
    const id = `cron_${jobname}`;
    if (jobsFehler) {
      push(id, `Cron-Job ${jobname}`, "nicht_pruefbar", `cron.job nicht lesbar: ${jobsFehler}`);
      continue;
    }
    const j = jobs.find((x) => x.jobname === jobname);
    if (!j) {
      push(
        id,
        `Cron-Job ${jobname}`,
        "fehlt",
        "nicht registriert — cron.schedule aus Migration 20260913180000",
      );
      continue;
    }
    if (!j.active) {
      push(id, `Cron-Job ${jobname}`, "fehlerhaft", "deaktiviert (cron.job.active = false)");
      continue;
    }
    if (j.schedule.trim() !== schedule) {
      push(id, `Cron-Job ${jobname}`, "fehlerhaft", `Takt '${j.schedule}' statt '${schedule}'`);
      continue;
    }
    const letzter = runs.find((r) => r.jobname === jobname);
    if (!letzter) {
      push(
        id,
        `Cron-Job ${jobname}`,
        "fehlerhaft",
        "aktiv, aber noch kein Lauf in cron.job_run_details",
      );
      continue;
    }
    const a = alter(letzter.start_time, jetztMs) ?? Infinity;
    if (letzter.status !== "succeeded")
      push(
        id,
        `Cron-Job ${jobname}`,
        "fehlerhaft",
        `letzter Lauf ${letzter.status}: ${letzter.message || "ohne Meldung"}`,
      );
    else if (a > maxAlterMs)
      push(
        id,
        `Cron-Job ${jobname}`,
        "fehlerhaft",
        `letzter Lauf vor ${minuten(a)} min (erwartet ≤ ${minuten(maxAlterMs)} min) — pg_cron laeuft nicht`,
      );
    else
      push(id, `Cron-Job ${jobname}`, "ok", `${j.schedule} · letzter Lauf vor ${minuten(a)} min`);
  }

  // pg_net: letzte Antwort der App
  if (!Array.isArray(roh.http))
    push(
      "pg_net",
      "pg_net → App",
      "nicht_pruefbar",
      `net._http_response nicht lesbar: ${roh.http?.error ?? "?"}`,
    );
  else if (!roh.http.length)
    push("pg_net", "pg_net → App", "fehlerhaft", "noch keine HTTP-Antwort protokolliert");
  else {
    const h = roh.http[0];
    const a = alter(h.created, jetztMs) ?? Infinity;
    if (h.timed_out)
      push(
        "pg_net",
        "pg_net → App",
        "fehlerhaft",
        `letzter Aufruf Timeout (${h.error_msg || "ohne Meldung"})`,
      );
    else if (h.status_code === 401)
      push(
        "pg_net",
        "pg_net → App",
        "fehlerhaft",
        "HTTP 401 — Vault-Secret admin_automation_secret weicht von ADMIN_AUTOMATION_SECRET der App ab",
      );
    else if (h.status_code == null || h.status_code >= 400)
      push(
        "pg_net",
        "pg_net → App",
        "fehlerhaft",
        `HTTP ${h.status_code ?? "—"}: ${h.error_msg || h.content.slice(0, 120)}`,
      );
    else if (a > 3 * 60_000)
      push(
        "pg_net",
        "pg_net → App",
        "fehlerhaft",
        `letzte Antwort vor ${minuten(a)} min (erwartet ≤ 3 min)`,
      );
    else push("pg_net", "pg_net → App", "ok", `HTTP ${h.status_code} vor ${minuten(a)} min`);
  }

  // Vault-Secret (nur Name)
  const vault = Array.isArray(roh.vault) ? roh.vault : [];
  if (!Array.isArray(roh.vault))
    push(
      "vault",
      "Vault-Secret admin_automation_secret",
      "nicht_pruefbar",
      `vault.secrets nicht lesbar: ${roh.vault?.error ?? "?"}`,
    );
  else if (vault.some((v) => v.name === "admin_automation_secret"))
    push("vault", "Vault-Secret admin_automation_secret", "ok", "vorhanden");
  else
    push(
      "vault",
      "Vault-Secret admin_automation_secret",
      "fehlt",
      "vault.create_secret(<ADMIN_AUTOMATION_SECRET>, 'admin_automation_secret', …) ausfuehren",
    );

  // Heartbeat
  const hb = roh.heartbeat ?? null;
  const { zustand, alterMs } = bewerteHeartbeat(hb as any, jetztMs);
  if (!hb)
    push("heartbeat", "Worker-Heartbeat", "fehlt", "analyse_worker_heartbeat hat keine Zeile id=1");
  else if (zustand === "ausgefallen")
    push(
      "heartbeat",
      "Worker-Heartbeat",
      "fehlerhaft",
      `kein Tick seit ${alterMs == null ? "je" : minuten(alterMs) + " min"} (> 10 min)`,
    );
  else if (zustand === "verzoegert")
    push(
      "heartbeat",
      "Worker-Heartbeat",
      "fehlerhaft",
      `letzter Tick vor ${minuten(alterMs ?? 0)} min (> ${minuten(HEARTBEAT_VERZOEGERT_MS)} min)`,
    );
  else if (hb.source !== "pg_cron")
    push(
      "heartbeat",
      "Worker-Heartbeat",
      "fehlerhaft",
      `aktiv, aber Quelle '${hb.source ?? "unbekannt"}' statt pg_cron (Fallback laeuft?)`,
    );
  else if (Number(hb.consecutive_error_ticks) >= 3)
    push(
      "heartbeat",
      "Worker-Heartbeat",
      "fehlerhaft",
      `${hb.consecutive_error_ticks} Fehler-Ticks in Folge: ${hb.last_error || "ohne Meldung"}`,
    );
  else
    push(
      "heartbeat",
      "Worker-Heartbeat",
      "ok",
      `aktiv via ${hb.source}, vor ${minuten(alterMs ?? 0)} min`,
    );

  // Watchdog-Probe (Funktion aufgerufen — Ergebnis = Zustand)
  const wd = roh.watchdog ?? null;
  if (!wd)
    push(
      "watchdog",
      "Watchdog analyse_worker_watchdog()",
      "fehlt",
      "Funktion fehlt — Migration 20260913180000",
    );
  else if (wd.error)
    push(
      "watchdog",
      "Watchdog analyse_worker_watchdog()",
      "fehlerhaft",
      String(wd.error).slice(0, 160),
    );
  else if (wd.zustand === "ausgefallen")
    push(
      "watchdog",
      "Watchdog analyse_worker_watchdog()",
      "fehlerhaft",
      `meldet Ausfall (${wd.alter_min} min), ${wd.neue_meldungen ?? 0} neue Meldungen`,
    );
  else push("watchdog", "Watchdog analyse_worker_watchdog()", "ok", `Probe: ${wd.zustand}`);

  // Resurface-Sweep
  const sweepAlter = alter(hb?.last_sweep_at, jetztMs);
  if (!hb) push("sweep", "Wiedervorlage-Sweep", "nicht_pruefbar", "kein Heartbeat");
  else if (sweepAlter == null)
    push("sweep", "Wiedervorlage-Sweep", "fehlerhaft", "noch nie gelaufen (last_sweep_at leer)");
  else if (sweepAlter > SWEEP_INTERVALL_MS + 5 * 60_000)
    push(
      "sweep",
      "Wiedervorlage-Sweep",
      "fehlerhaft",
      `letzter Sweep vor ${minuten(sweepAlter)} min (erwartet ≤ ${minuten(SWEEP_INTERVALL_MS)} min)`,
    );
  else push("sweep", "Wiedervorlage-Sweep", "ok", `vor ${minuten(sweepAlter)} min`);

  return checks;
}

export async function ladeSchedulerStatus(): Promise<{
  ok: boolean;
  checks: SchedulerCheck[];
  roh: SchedulerRoh | null;
  fehler?: string;
}> {
  const sb = supabaseAdmin as any;
  try {
    const { data, error } = await sb.rpc("scheduler_status");
    if (error) {
      const fehlt = /could not find the function|does not exist/i.test(String(error.message));
      return {
        ok: false,
        checks: [
          {
            id: "rpc",
            name: "RPC scheduler_status()",
            status: fehlt ? "fehlt" : "fehlerhaft",
            detail: fehlt
              ? "Funktion fehlt — Migration 20260913210000 ausfuehren"
              : String(error.message).slice(0, 160),
          },
        ],
        roh: null,
        fehler: String(error.message),
      };
    }
    const checks = bewerteScheduler((data ?? {}) as SchedulerRoh);
    return { ok: checks.every((c) => c.status === "ok"), checks, roh: data ?? null };
  } catch (e) {
    const msg = String((e as any)?.message || e);
    return {
      ok: false,
      checks: [
        {
          id: "rpc",
          name: "RPC scheduler_status()",
          status: "fehlerhaft",
          detail: msg.slice(0, 160),
        },
      ],
      roh: null,
      fehler: msg,
    };
  }
}
