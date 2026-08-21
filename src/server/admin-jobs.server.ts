// Asynchrone Admin-Jobs (Admin-Ausbau 21.08.2026).
// "Datenlauf starten" legt nur noch einen persistenten Job an (sofortige
// jobId); der minuetliche Worker (gleicher Tick wie die Analyse-Jobs)
// arbeitet ihn ab. Gleiche Bausteine wie prospect_audits: DB-Lock
// (locked_until), begrenzte Versuche, Doppelstart-Schutz je Kunde+Lauftyp.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SB = supabaseAdmin as any;

export const JOB_OFFEN = ["queued", "laufend"] as const;

/** Job anlegen — existiert bereits ein offener Job fuer (org, kunde, typ), wird DIESER zurueckgegeben. */
export async function startAdminJob(opts: {
  organizationId: string;
  clientId: string | null;
  jobType: string;
  userId: string | null;
}): Promise<{ job: any; bereitsLaufend: boolean }> {
  let q = SB.from("admin_jobs")
    .select("*")
    .eq("organization_id", opts.organizationId)
    .eq("job_type", opts.jobType)
    .in("status", JOB_OFFEN as unknown as string[])
    .order("created_at", { ascending: false })
    .limit(1);
  q = opts.clientId ? q.eq("client_id", opts.clientId) : q.is("client_id", null);
  const { data: offen } = await q.maybeSingle();
  if (offen) return { job: offen, bereitsLaufend: true };

  const { data, error } = await SB.from("admin_jobs")
    .insert({
      organization_id: opts.organizationId,
      client_id: opts.clientId,
      job_type: opts.jobType,
      status: "queued",
      created_by: opts.userId,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return { job: data, bereitsLaufend: false };
}

export async function ladeAdminJob(organizationId: string, id: string) {
  const { data } = await SB.from("admin_jobs")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return data ?? null;
}

/**
 * Offene Admin-Jobs abarbeiten (vom Worker-Endpoint nach den Analyse-Jobs
 * aufgerufen). Lock-Claim = Statuswechsel queued->laufend; ueberlappende
 * Worker fahren nie denselben Job doppelt.
 */
export async function tickeAdminJobs(budgetMs: number, origin: string) {
  const start = Date.now();
  const out = { getickt: 0, fertig: 0, fehler: 0 };
  const secret = process.env.ADMIN_AUTOMATION_SECRET;
  if (!secret) return out;
  for (let i = 0; i < 10; i++) {
    const rest = budgetMs - (Date.now() - start);
    if (rest < 30_000) break; // zu wenig Budget fuer einen sinnvollen Lauf
    const nowIso = new Date().toISOString();
    const lockIso = new Date(Date.now() + 6 * 60_000).toISOString();
    const { data: rows } = await SB.from("admin_jobs")
      .select("id")
      .in("status", JOB_OFFEN as unknown as string[])
      .or(`locked_until.is.null,locked_until.lt.${nowIso}`)
      .order("updated_at", { ascending: true })
      .limit(1);
    const next = rows?.[0];
    if (!next) break;
    const { data: job } = await SB.from("admin_jobs")
      .update({ locked_until: lockIso, status: "laufend", started_at: nowIso, updated_at: nowIso })
      .eq("id", next.id)
      .in("status", JOB_OFFEN as unknown as string[])
      .or(`locked_until.is.null,locked_until.lt.${nowIso}`)
      .select("*")
      .maybeSingle();
    if (!job) continue; // anderer Worker hat den Job geclaimt
    out.getickt++;
    try {
      let result: any = null;
      if (job.job_type === "datenlauf") {
        // Self-Call auf die bestehende populate-Route (ein Kunde) — dieselbe
        // Logik wie der 12h-Lauf, kein zweiter Code-Pfad.
        const r = await fetch(`${origin}/api/admin/populate`, {
          method: "POST",
          headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
          body: JSON.stringify({ client: job.client_id }),
          signal: AbortSignal.timeout(Math.min(rest - 10_000, 230_000)),
        });
        const j: any = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(String(j?.error || `HTTP ${r.status}`));
        result = j?.summary ?? j ?? null;
      } else {
        throw new Error(`Unbekannter job_type ${job.job_type}`);
      }
      await SB.from("admin_jobs")
        .update({
          status: "fertig",
          progress: 100,
          result,
          error: null,
          locked_until: null,
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      out.fertig++;
    } catch (e) {
      const attempts = (Number(job.attempts) || 0) + 1;
      const endgueltig = attempts >= (Number(job.max_attempts) || 2);
      const msg = String((e as Error)?.message || e).slice(0, 300);
      await SB.from("admin_jobs")
        .update({
          attempts,
          status: endgueltig ? "fehler" : "queued",
          error: msg,
          // Cooldown statt Sofort-Retry im selben Tick: der naechste
          // Minuten-Tick nimmt den Job wieder auf.
          locked_until: endgueltig ? null : new Date(Date.now() + 2 * 60_000).toISOString(),
          ...(endgueltig ? { finished_at: new Date().toISOString() } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      if (endgueltig) out.fehler++;
    }
  }
  return out;
}
