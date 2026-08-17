// Interaktive Content-Generierung der App über die Claude-SUBSCRIPTION statt
// über das ANTHROPIC_API_KEY-Guthaben (2026-08-05).
//
// Der agent-service (Cloud-PC, erreichbar über AGENT_BASE_URL) macht einen
// werkzeuglosen One-Shot-Lauf und rechnet über denselben Auth-Failover ab wie
// die Agenten — Subscription zuerst, API nur als Notpuffer. Er loggt den Lauf im
// cost-log.jsonl (authMode). Ist der Dienst nicht erreichbar oder liefert er
// keinen Text, gibt diese Funktion `null` zurück; der Aufrufer weicht dann auf
// den direkten API-Aufruf aus (dessen Verbrauch via recordApiCost sichtbar wird).

export type GenResult = {
  text: string;
  authMode: string | null;
  usage: { input_tokens?: number; output_tokens?: number } | null;
};

export async function generateViaSubscription(opts: {
  system?: string;
  prompt: string;
  model?: string;
  clientId?: string | null;
  clientName?: string | null;
  label?: string;
  timeoutMs?: number;
  /** Standard 1 (One-Shot). Laengere Prompts brauchen gelegentlich 2–3 Turns —
   *  Befund 17.08.: "Reached maximum number of turns (1)" beim Themen-Prompt. */
  maxTurns?: number;
}): Promise<GenResult | null> {
  const base = process.env.AGENT_BASE_URL?.replace(/\/+$/, "");
  const secret = process.env.AGENT_SHARED_SECRET;
  if (!base || !secret) return null; // nicht konfiguriert -> Aufrufer nutzt Direktweg

  try {
    const r = await fetch(`${base}/generate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        system: opts.system,
        prompt: opts.prompt,
        model: opts.model,
        authPrefer: "subscription",
        maxTurns: opts.maxTurns,
        clientId: opts.clientId ?? null,
        clientName: opts.clientName ?? null,
        label: opts.label ?? "App-Generierung",
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 150_000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { ok?: boolean; text?: unknown; authMode?: string | null; usage?: GenResult["usage"] };
    if (!j?.ok || typeof j.text !== "string" || !j.text.trim()) return null;
    return { text: j.text, authMode: j.authMode ?? "subscription", usage: j.usage ?? null };
  } catch {
    return null; // Timeout / Dienst offline -> Aufrufer weicht auf Direktweg aus
  }
}
