import { supabaseAdmin } from "@/integrations/supabase/client.server";
import COST_CFG from "@/lib/cost-config.json";

// Macht direkten ANTHROPIC_API_KEY-Verbrauch der App SICHTBAR (2026-08-05).
// Hintergrund: ai.generate / content.refresh-brief riefen api.anthropic.com
// direkt an und loggten NICHTS — genau dadurch lief am 03.08. unbemerkt das
// API-Guthaben leer. Diese Helper schreibt Token/Kosten idempotent in dieselbe
// Ledger-Tabelle (api_cost_daily, RPC add_api_cost), die die AI-Visibility-
// Ingestion nutzt; der Verbrauch taucht damit im Dashboard/Abend-Report auf.
// Preis je 1 Mio Token aus cost-config.json (Provider-Label, z. B. "Claude").
// Best effort: ein Fehler hier darf den eigentlichen Request NIE scheitern lassen.

const today = () => new Date().toISOString().slice(0, 10);

export async function recordApiCost(opts: {
  provider: string;
  tokensIn: number;
  tokensOut: number;
  calls?: number;
}): Promise<void> {
  try {
    const prices = (COST_CFG as { prices: Record<string, { in: number; out: number }>; fallback: { in: number; out: number } });
    const p = prices.prices[opts.provider] || prices.fallback;
    const tIn = Math.max(0, opts.tokensIn || 0);
    const tOut = Math.max(0, opts.tokensOut || 0);
    const cost = (tIn / 1e6) * p.in + (tOut / 1e6) * p.out;
    await (supabaseAdmin as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown> }).rpc(
      "add_api_cost",
      {
        p_day: today(),
        p_provider: opts.provider,
        p_calls: opts.calls ?? 1,
        p_in: tIn,
        p_out: tOut,
        p_cost: Math.round(cost * 1e6) / 1e6,
      },
    );
  } catch {
    /* Kostenerfassung darf den Request nie scheitern lassen */
  }
}
