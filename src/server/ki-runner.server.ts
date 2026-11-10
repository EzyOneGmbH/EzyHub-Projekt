// KI-Aufrufe über den Runner auf dem Cloud-PC (gsc-runner.ezyhub.ch, POST /agent):
// dort läuft Claude Code headless (claude -p) mit dem Claude-Abo statt API-Guthaben.
// Ein Job kann länger dauern als ein Worker-Takt. Darum merken wir die Job-ID
// (in ahrefs_cache unter endpoint «ki-runner», Schlüssel = Hash der Eingabe) und werfen KiLaeuftNoch; der
// nächste Takt ruft dieselbe Phase erneut auf und holt das Ergebnis ab.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export class KiLaeuftNoch extends Error {
  constructor() {
    super("KI arbeitet noch");
    this.name = "KiLaeuftNoch";
  }
}

const URL_RUNNER = () =>
  (process.env.AGENT_RUNNER_URL || "https://gsc-runner.ezyhub.ch").replace(/\/+$/, "");
const SECRET = () => (process.env.AGENT_RUNNER_SECRET || "").trim().replace(/^["']|["']$/g, "");

/** Runner statt API, sobald das Runner-Secret gesetzt ist (BLOG_KI=api erzwingt die API). */
export function runnerAktiv(): boolean {
  return !!SECRET() && process.env.BLOG_KI !== "api";
}

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

const SB = supabaseAdmin as any;
const ENDPOINT = "ki-runner";
const vergessen = (hash: string) =>
  SB.from("ahrefs_cache").delete().eq("endpoint", ENDPOINT).eq("params_hash", hash);
const warte = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runner(pfad: string, init?: RequestInit) {
  const r = await fetch(`${URL_RUNNER()}${pfad}`, {
    ...init,
    headers: { "Content-Type": "application/json", "x-runner-secret": SECRET() },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`KI-Runner HTTP ${r.status}`);
  return (await r.json()) as any;
}

export async function runnerText(opts: {
  system: string;
  prompt: string;
  websuche?: number;
  timeoutMs: number;
}): Promise<string> {
  const model = process.env.BLOG_RUNNER_MODEL || "sonnet";
  const websearch = opts.websuche ?? 0;
  const hash = await sha256(`${model}|${websearch}|${opts.system}|${opts.prompt}`);
  const { data: vorher } = await SB.from("ahrefs_cache")
    .select("response, fetched_at")
    .eq("endpoint", ENDPOINT)
    .eq("params_hash", hash)
    .maybeSingle();
  let jobId: string | null =
    vorher?.response?.job_id && Date.now() - new Date(vorher.fetched_at).getTime() < 20 * 3600_000
      ? String(vorher.response.job_id)
      : null;
  if (!jobId) {
    const s = await runner("/agent", {
      method: "POST",
      body: JSON.stringify({ system: opts.system, prompt: opts.prompt, model, websearch }),
    });
    if (!s?.ok || !s.job_id) throw new Error(`KI-Runner: ${s?.message || "Start fehlgeschlagen"}`);
    jobId = String(s.job_id);
    await SB.from("ahrefs_cache").upsert({
      endpoint: ENDPOINT,
      params_hash: hash,
      params: { model, websearch },
      response: { job_id: jobId },
      units: 0,
      fetched_at: new Date().toISOString(),
    });
  }
  const ende = Date.now() + opts.timeoutMs;
  for (;;) {
    const j = await runner(`/agent/${jobId}`);
    if (j?.status === "fertig") {
      await vergessen(hash);
      return String(j.text || "");
    }
    if (j?.status !== "laeuft") {
      await vergessen(hash);
      throw new Error(`KI-Runner: ${String(j?.message || j?.error || "Fehler").slice(0, 200)}`);
    }
    if (Date.now() + 4000 > ende) throw new KiLaeuftNoch();
    await warte(4000);
  }
}
