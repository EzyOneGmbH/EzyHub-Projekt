// Verwalteter Analyse-/Admin-Worker (13.09.2026, Volkan): Orchestrierung EINES
// Worker-Ticks. Primaerer Scheduler ist pg_cron in der Lovable-Supabase
// (Migration 20260913180000_managed_worker_scheduler.sql): pg_net ruft
// minuetlich POST /api/agent/analyse {action:"worker", source:"pg_cron"} mit
// ADMIN_AUTOMATION_SECRET aus dem Supabase-Vault auf. Der Windows-Task
// «EzyOne-Analyse-Worker» bleibt nur als dokumentierter Notfall-Fallback
// (scripts/analyse-worker.ps1, deaktiviert).
//
// Was ein Tick tut (Reihenfolge bewusst):
//  1. Lease auf analyse_worker_heartbeat (lease_until) claimen — ueberlappende
//     Scheduler-Aufrufe (pg_cron feuert jede Minute, ein Tick darf bis 230 s
//     dauern) laufen NIE parallel; sie melden {uebersprungen:"lease"}. Eine
//     abgestuerzte Instanz blockiert hoechstens bis Lease-Ablauf.
//  2. tickeOffeneAudits (prospect_audits, Etappen-Locks + exponentielles
//     Retry) und tickeAdminJobs (admin_jobs, Cooldown-Retry) — unveraendert.
//  3. Notification-Sweep fuer faellige Wiedervorlagen (ai_opportunity_states.
//     resurface_on) alle 15 Minuten — unabhaengig von jedem Browserbesuch.
//  4. Fehler-Monitor: wiederholte Job-Fehler → Admin-Meldung (dedupliziert)
//     + optionaler Webhook. Der Heartbeat-AUSFALL selbst (kein Tick > 10 min)
//     wird bewusst NICHT hier, sondern DB-seitig vom pg_cron-Watchdog
//     (public.analyse_worker_watchdog) erkannt — die App kann ihren eigenen
//     Ausfall nicht melden.
//  5. Heartbeat schreiben (inkl. consecutive_error_ticks, source) + Lease frei.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { tickeOffeneAudits as tickeOffeneAuditsEcht } from "./prospect-audit.server";
import { tickeAdminJobs as tickeAdminJobsEcht } from "./admin-jobs.server";

const SB = supabaseAdmin as any;

export const HEARTBEAT_VERZOEGERT_MS = 3 * 60_000;
export const HEARTBEAT_AUSGEFALLEN_MS = 10 * 60_000;
export const SWEEP_INTERVALL_MS = 15 * 60_000;
export const LEASE_PUFFER_MS = 30_000;
export const FEHLER_TICKS_IN_FOLGE = 3;
export const FEHLER_JE_STUNDE = 3;
export const STANDARD_BUDGET_MS = 230_000;
/** Rollen, die «zustaendige Admins» im Sinne der Alarmierung/Wiedervorlage sind. */
export const ADMIN_ROLLEN = ["owner", "admin"] as const;

export type Heartbeat = {
  id: number;
  last_run_at: string | null;
  duration_ms: number;
  jobs_processed: number;
  errors: number;
  last_error: string | null;
  lease_until: string | null;
  lease_holder: string | null;
  consecutive_error_ticks: number;
  last_sweep_at: string | null;
  source: string | null;
};

export type TickErgebnis = { getickt: number; fertig: number; fehler: number };

type Deps = {
  tickeOffeneAudits: (budgetMs: number) => Promise<TickErgebnis>;
  tickeAdminJobs: (budgetMs: number, origin: string) => Promise<TickErgebnis>;
  fetchImpl: typeof fetch;
  jetzt: () => number;
};

const msg = (e: unknown) => String((e as any)?.message || e).slice(0, 300);
const isoTag = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// ── Heartbeat-Bewertung (pure; GET ?worker=1 und Systemcheck nutzen dieselben
//    Schwellen: aktiv < 3 min, verzoegert 3–10 min, ausgefallen > 10 min/nie).
export function bewerteHeartbeat(
  hb: Pick<Heartbeat, "last_run_at"> | null | undefined,
  jetztMs = Date.now(),
): { zustand: "aktiv" | "verzoegert" | "ausgefallen"; alterMs: number | null } {
  const alterMs = hb?.last_run_at ? jetztMs - new Date(hb.last_run_at).getTime() : null;
  const zustand =
    alterMs == null || alterMs > HEARTBEAT_AUSGEFALLEN_MS
      ? "ausgefallen"
      : alterMs > HEARTBEAT_VERZOEGERT_MS
        ? "verzoegert"
        : "aktiv";
  return { zustand, alterMs };
}

export async function ladeHeartbeat(): Promise<Heartbeat | null> {
  const { data } = await SB.from("analyse_worker_heartbeat").select("*").eq("id", 1).maybeSingle();
  return (data as Heartbeat) ?? null;
}

// ── Lease: genau EIN Tick zur Zeit (atomarer Conditional-Update, wie die
//    Job-Locks). Faellt eine Instanz aus, laeuft die Lease nach dauerMs ab.
export async function claimLease(holder: string, dauerMs: number, jetztMs = Date.now()) {
  const nowIso = new Date(jetztMs).toISOString();
  const bisIso = new Date(jetztMs + dauerMs).toISOString();
  const versuch = async () => {
    const { data } = await SB.from("analyse_worker_heartbeat")
      .update({ lease_until: bisIso, lease_holder: holder })
      .eq("id", 1)
      .or(`lease_until.is.null,lease_until.lt.${nowIso}`)
      .select("id")
      .maybeSingle();
    return !!data;
  };
  if (await versuch()) return true;
  // Kein Treffer: entweder haelt jemand die Lease — oder die Zeile fehlt noch
  // (frische DB). Nur im zweiten Fall anlegen und einmal erneut versuchen.
  const { data: zeile } = await SB.from("analyse_worker_heartbeat")
    .select("id")
    .eq("id", 1)
    .maybeSingle();
  if (zeile) return false;
  await SB.from("analyse_worker_heartbeat").upsert(
    { id: 1 },
    { onConflict: "id", ignoreDuplicates: true },
  );
  return versuch();
}

export async function releaseLease(holder: string) {
  await SB.from("analyse_worker_heartbeat")
    .update({ lease_until: null, lease_holder: null })
    .eq("id", 1)
    .eq("lease_holder", holder);
}

// ── Meldungen an Personen (app_notifications.recipient_user_id) ─────────────
type MeldungRow = {
  organization_id: string;
  client_id: string | null;
  kind: string;
  severity: string;
  title: string;
  body: string;
  link_section: string;
  recipient_user_id: string;
  dedupe_key: string;
};

async function ladeAdmins(): Promise<Array<{ organization_id: string; user_id: string }>> {
  const { data } = await SB.from("app_users")
    .select("organization_id, user_id, role")
    .in("role", ADMIN_ROLLEN as unknown as string[]);
  return (data ?? []).map((r: any) => ({
    organization_id: String(r.organization_id),
    user_id: String(r.user_id),
  }));
}

/** Legt Meldungen an; dedupliziert HART ueber den Unique-Index dedupe_key.
 *  Rueckgabe: Anzahl NEU angelegter Zeilen (Duplikate werden ignoriert). */
export async function erzeugeMeldungen(rows: MeldungRow[]): Promise<number> {
  if (!rows.length) return 0;
  const { data, error } = await SB.from("app_notifications")
    .upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data.length : 0;
}

/** Optionaler Alarm-Webhook (n8n o. ae.): WORKER_ALARM_WEBHOOK_URL, Header
 *  X-Ezy-Auth = N8N_AGENT_WEBHOOK_SECRET (gleiches Muster wie der Populate-
 *  Heartbeat). Fire-and-forget mit 5 s Timeout — nie den Tick gefaehrden. */
export async function sendeAlarmWebhook(
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<string> {
  const url = process.env.WORKER_ALARM_WEBHOOK_URL;
  if (!url) return "no-url";
  const secret = process.env.N8N_AGENT_WEBHOOK_SECRET;
  try {
    const r = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(secret ? { "X-Ezy-Auth": secret } : {}) },
      body: JSON.stringify({ client: "ezyhub", agent: "analyse-worker", ...payload }),
      signal: AbortSignal.timeout(5000),
    });
    return r.ok ? "sent" : `error:HTTP ${r.status}`;
  } catch (e) {
    return `error:${msg(e).slice(0, 60)}`;
  }
}

/** Alarm an ALLE Admins (owner/admin) aller Organisationen, dedupliziert je
 *  (key, user). Webhook nur, wenn mindestens eine Meldung NEU ist. */
export async function meldeAdmins(input: {
  key: string;
  kind: string;
  severity: string;
  title: string;
  body: string;
  linkSection?: string;
  fetchImpl?: typeof fetch;
}) {
  const admins = await ladeAdmins();
  const rows: MeldungRow[] = admins.map((a) => ({
    organization_id: a.organization_id,
    client_id: null,
    kind: input.kind,
    severity: input.severity,
    title: input.title.slice(0, 200),
    body: input.body,
    link_section: input.linkSection || "system",
    recipient_user_id: a.user_id,
    dedupe_key: `${input.key}:${a.user_id}`,
  }));
  const neu = await erzeugeMeldungen(rows);
  const webhook =
    neu > 0
      ? await sendeAlarmWebhook(
          { status: "fehler", kind: input.kind, title: input.title, note: input.body },
          input.fetchImpl,
        )
      : "skipped";
  return { empfaenger: rows.length, neu, webhook };
}

// ── Fehler-Monitor: «wiederholt Jobs fehlschlagen» ──────────────────────────
// Regel A: >= FEHLER_TICKS_IN_FOLGE Ticks in Folge mit mindestens einem
//          endgueltigen Fehler (oder Tick-Exception).
// Regel B: >= FEHLER_JE_STUNDE endgueltig fehlgeschlagene Jobs (prospect_audits
//          + admin_jobs) in den letzten 60 Minuten.
// Dedupe: ein Alarm je 6-Stunden-Fenster und Admin.
export async function pruefeWiederholteFehler(input: {
  folge: number;
  jetztMs?: number;
  fetchImpl?: typeof fetch;
}) {
  const jetzt = input.jetztMs ?? Date.now();
  const seit = new Date(jetzt - 60 * 60_000).toISOString();
  const [a, b] = await Promise.all([
    SB.from("prospect_audits").select("id").eq("status", "fehler").gte("updated_at", seit),
    SB.from("admin_jobs").select("id").eq("status", "fehler").gte("updated_at", seit),
  ]);
  const fehlerStunde = (a.data?.length ?? 0) + (b.data?.length ?? 0);
  const grund =
    input.folge >= FEHLER_TICKS_IN_FOLGE
      ? `${input.folge} Worker-Ticks in Folge mit Fehlern`
      : fehlerStunde >= FEHLER_JE_STUNDE
        ? `${fehlerStunde} endgültig fehlgeschlagene Jobs in der letzten Stunde`
        : null;
  if (!grund) return { alarm: false as const, folge: input.folge, fehlerStunde };
  const fenster = Math.floor(jetzt / (6 * 3600_000));
  const r = await meldeAdmins({
    key: `worker:failures:${fenster}`,
    kind: "worker_alarm",
    severity: "hoch",
    title: `Analyse-Worker: wiederholte Job-Fehler (${grund})`,
    body: "Mehrere Analyse- oder Admin-Jobs sind endgültig fehlgeschlagen. Details: Admin → Systemcheck bzw. EzyAI → Analyse (Verlauf, Fehlertext); betroffene Jobs lassen sich dort manuell neu starten.",
    linkSection: "system",
    fetchImpl: input.fetchImpl,
  });
  return { alarm: true as const, grund, folge: input.folge, fehlerStunde, ...r };
}

// ── Notification-Sweep: faellige Wiedervorlagen ohne Browserbesuch ──────────
// Empfaenger: assignee_user_id, sonst alle Admins der Organisation. Dedupe je
// (Kunde, Fingerprint, Faelligkeitsdatum, Empfaenger) — ein Reload, ein
// weiterer Sweep oder ein zweiter Worker erzeugen keine Duplikate.
export async function sweepWiedervorlagen(input: { heute?: string } = {}) {
  const heute = input.heute ?? isoTag(Date.now());
  const { data: states, error } = await SB.from("ai_opportunity_states")
    .select(
      "organization_id, client_id, fingerprint, title, resurface_on, assignee_user_id, status",
    )
    .in("status", ["offen", "in_bearbeitung", "pausiert"])
    .lte("resurface_on", heute)
    .limit(500);
  if (error) throw new Error(error.message);
  const faellig = (states ?? []).filter(
    (s: any) => s.resurface_on && String(s.resurface_on) <= heute,
  );
  if (!faellig.length) return { faellig: 0, empfaenger: 0, neu: 0 };
  const admins = await ladeAdmins();
  const rows: MeldungRow[] = [];
  for (const s of faellig) {
    const empfaenger: string[] = s.assignee_user_id
      ? [String(s.assignee_user_id)]
      : admins.filter((a) => a.organization_id === String(s.organization_id)).map((a) => a.user_id);
    for (const uid of empfaenger)
      rows.push({
        organization_id: String(s.organization_id),
        client_id: String(s.client_id),
        kind: "resurface_due",
        severity: "info",
        title: `Wiedervorlage fällig: ${s.title || "Chance"}`.slice(0, 200),
        body: "Wiedervorlage fällig — Chance im Bereich «Chancen» prüfen.",
        link_section: "opportunities",
        recipient_user_id: uid,
        dedupe_key: `resurface:${s.client_id}:${String(s.fingerprint).slice(0, 80)}:${s.resurface_on}:${uid}`,
      });
  }
  const neu = await erzeugeMeldungen(rows);
  return { faellig: faellig.length, empfaenger: rows.length, neu };
}

// ── Der Tick ────────────────────────────────────────────────────────────────
export async function runWorkerTick(
  opts: { budgetMs?: number; origin: string; source?: string },
  depsTeil: Partial<Deps> = {},
) {
  const deps: Deps = {
    tickeOffeneAudits: tickeOffeneAuditsEcht,
    tickeAdminJobs: tickeAdminJobsEcht,
    fetchImpl: globalThis.fetch,
    jetzt: () => Date.now(),
    ...depsTeil,
  };
  const budget = opts.budgetMs && opts.budgetMs > 0 ? opts.budgetMs : STANDARD_BUDGET_MS;
  const source = opts.source || "unbekannt";
  const holder = `${source}:${crypto.randomUUID().slice(0, 8)}`;
  const t0 = deps.jetzt();
  if (!(await claimLease(holder, budget + LEASE_PUFFER_MS, t0)))
    return { ok: true as const, uebersprungen: "lease" as const, quelle: source };

  let audits: TickErgebnis = { getickt: 0, fertig: 0, fehler: 0 };
  let adminJobs: TickErgebnis = { getickt: 0, fertig: 0, fehler: 0 };
  let lastError: string | null = null;
  let sweep: any = null;
  let alarm: any = null;
  try {
    try {
      // Analyse-Jobs zuerst (max 150 s), Admin-Jobs (z.B. Datenlaeufe)
      // bekommen das Restbudget desselben Ticks — wie bisher.
      audits = await deps.tickeOffeneAudits(Math.min(budget, 150_000));
      adminJobs = await deps.tickeAdminJobs(budget - (deps.jetzt() - t0), opts.origin);
    } catch (e) {
      lastError = msg(e);
    }
    const hbAlt = await ladeHeartbeat();
    const fehlerTick = audits.fehler + adminJobs.fehler > 0 || !!lastError;
    const folge = fehlerTick ? (Number(hbAlt?.consecutive_error_ticks) || 0) + 1 : 0;

    const jetzt = deps.jetzt();
    const sweepFaellig =
      !hbAlt?.last_sweep_at ||
      jetzt - new Date(hbAlt.last_sweep_at).getTime() >= SWEEP_INTERVALL_MS;
    if (sweepFaellig) {
      try {
        sweep = await sweepWiedervorlagen({ heute: isoTag(jetzt) });
      } catch (e) {
        sweep = { fehler: msg(e) };
      }
    }
    try {
      alarm = await pruefeWiederholteFehler({ folge, jetztMs: jetzt, fetchImpl: deps.fetchImpl });
    } catch (e) {
      alarm = { fehler: msg(e) };
    }
    // Heartbeat: sichtbar machen, dass, wie und von wem der Worker lief.
    await SB.from("analyse_worker_heartbeat").upsert({
      id: 1,
      last_run_at: new Date(jetzt).toISOString(),
      duration_ms: jetzt - t0,
      jobs_processed: audits.getickt + adminJobs.getickt,
      errors: audits.fehler + adminJobs.fehler + (lastError ? 1 : 0),
      last_error: lastError,
      consecutive_error_ticks: folge,
      source,
      ...(sweepFaellig ? { last_sweep_at: new Date(jetzt).toISOString() } : {}),
    });
  } finally {
    try {
      await releaseLease(holder);
    } catch {
      /* Lease laeuft spaetestens nach budget+Puffer ab */
    }
  }
  return {
    ok: !lastError,
    ...audits,
    adminJobs,
    sweep,
    alarm,
    quelle: source,
    ...(lastError ? { error: lastError } : {}),
  };
}
