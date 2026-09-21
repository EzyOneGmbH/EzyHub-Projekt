import { createFileRoute } from "@tanstack/react-router";
import { requireTeamRole } from "@/server/team-guard.server";
import { supabaseKeyTyp, type SupabaseKeyTyp } from "@/integrations/supabase/client.server";
import { fetchAhrefsLimits, type AhrefsUnits } from "@/server/backlink-overview.server";

type ProbeResult = {
  configured: boolean;
  ok: boolean;
  status?: number;
  error?: string;
  latency_ms?: number;
  /** Zusatzinformationen (z. B. Ahrefs-Kontingent) — nie Secrets. */
  details?: Record<string, unknown>;
};

type LiveStatus = {
  generated_at: string;
  providers: {
    gemini: ProbeResult;
    openai: ProbeResult;
    anthropic: ProbeResult;
    perplexity: ProbeResult;
    canonry: ProbeResult;
    dataforseo: ProbeResult;
    ahrefs: ProbeResult;
    google_oauth: ProbeResult;
  };
  /** Supabase-API-Key-Umstellung (21.09.2026): welcher Key-Typ serverseitig aktiv ist. */
  supabase_keys: SupabaseKeyTyp;
};

/**
 * Strip secret values from any string so they never leak in error messages.
 */
function redact(input: unknown, secrets: Array<string | undefined>): string {
  let s =
    typeof input === "string" ? input : input instanceof Error ? input.message : String(input);
  for (const v of secrets) {
    if (!v || v.length < 4) continue;
    s = s.split(v).join("***REDACTED***");
  }
  // also scrub bearer tokens in error strings
  s = s.replace(/Bearer\s+[A-Za-z0-9\-_.=]+/gi, "Bearer ***REDACTED***");
  s = s.replace(/sk-[A-Za-z0-9\-_]{10,}/g, "***REDACTED***");
  return s.slice(0, 500);
}

async function timedFetch(
  url: string,
  init: RequestInit,
  secrets: Array<string | undefined>,
  timeoutMs = 6000,
): Promise<ProbeResult> {
  const start = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const latency_ms = Date.now() - start;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        configured: true,
        ok: false,
        status: res.status,
        latency_ms,
        error: redact(`HTTP ${res.status}: ${text}`, secrets),
      };
    }
    return { configured: true, ok: true, status: res.status, latency_ms };
  } catch (e) {
    return {
      configured: true,
      ok: false,
      latency_ms: Date.now() - start,
      error: redact(e, secrets),
    };
  } finally {
    clearTimeout(t);
  }
}

async function probeGemini(key?: string): Promise<ProbeResult> {
  if (!key) return { configured: false, ok: false, error: "GEMINI_API_KEY not configured" };
  return timedFetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
    { method: "GET" },
    [key],
  );
}

// OpenAI: reiner Schlüssel-/Erreichbarkeits-Check über /v1/models (kostenlos).
// Die Markennennungs-Messung selbst läuft seit 21.09.2026 über /v1/responses
// (admin.aivis-sync.ts) — chat/completions bleibt unterstützt, Tool-Calling
// (Web-Suche) gibt es bei neuen Modellen aber nur noch in der Responses-API.
async function probeOpenAI(key?: string): Promise<ProbeResult> {
  if (!key) return { configured: false, ok: false, error: "OPENAI_API_KEY not configured" };
  return timedFetch(
    "https://api.openai.com/v1/models",
    { method: "GET", headers: { Authorization: `Bearer ${key}` } },
    [key],
  );
}

async function probeAnthropic(key?: string): Promise<ProbeResult> {
  if (!key) return { configured: false, ok: false, error: "ANTHROPIC_API_KEY not configured" };
  return timedFetch(
    "https://api.anthropic.com/v1/models",
    {
      method: "GET",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    },
    [key],
  );
}

async function probePerplexity(key?: string): Promise<ProbeResult> {
  if (!key) return { configured: false, ok: false, error: "PERPLEXITY_API_KEY not configured" };
  // Perplexity has no public /models endpoint; use a tiny chat completion as ping.
  return timedFetch(
    "https://api.perplexity.ai/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 16,
      }),
    },
    [key],
  );
}

async function probeCanonry(baseUrl?: string, key?: string): Promise<ProbeResult> {
  if (!baseUrl || !key) {
    return {
      configured: false,
      ok: false,
      error: "CANONRY_BASE_URL or CANONRY_API_KEY not configured",
    };
  }
  const url = baseUrl.replace(/\/+$/, "") + "/health";
  return timedFetch(url, { method: "GET", headers: { Authorization: `Bearer ${key}` } }, [
    key,
    baseUrl,
  ]);
}

// 2026-08-07: Ahrefs-Probe durch DataForSEO ersetzt (Ahrefs-Ablösung 06.08.) —
// appendix/user_data ist der leichtgewichtige Konto-/Balance-Check.
async function probeDataForSEO(login?: string, pass?: string): Promise<ProbeResult> {
  if (!login || !pass)
    return { configured: false, ok: false, error: "DATAFORSEO_LOGIN/PASSWORD not configured" };
  const basic = Buffer.from(`${login}:${pass}`).toString("base64");
  return timedFetch(
    "https://api.dataforseo.com/v3/appendix/user_data",
    { method: "GET", headers: { Authorization: `Basic ${basic}`, Accept: "application/json" } },
    [pass, basic],
  );
}

// 2026-09-09: Ahrefs wieder aktiv (Backlinks & Autorität, Site-Audit, Brand
// Radar). limits-and-usage ist der leichtgewichtige Schlüssel-/Kontingent-Check.
// 21.09.2026: die Antwort wird ausgewertet — details trägt Units-Limit,
// -Verbrauch, Anteil und Reset-Datum (Endpunkt ist kostenlos, keine Units).
async function probeAhrefs(key?: string): Promise<ProbeResult> {
  if (!key) return { configured: false, ok: false, error: "AHREFS_API_KEY not configured" };
  const start = Date.now();
  const r = await fetchAhrefsLimits(`Bearer ${key}`, 6000);
  const latency_ms = Date.now() - start;
  if (!r.ok) {
    return {
      configured: true,
      ok: false,
      status: r.status,
      latency_ms,
      error: redact(r.error, [key]),
    };
  }
  const u: AhrefsUnits = r.units;
  return {
    configured: true,
    ok: true,
    status: r.status,
    latency_ms,
    details: {
      subscription: u.subscription,
      units_limit: u.units_limit_api_key,
      units_usage: u.units_usage_api_key,
      units_verbrauch_anteil: u.verbrauchAnteil,
      units_limit_workspace: u.units_limit_workspace,
      units_usage_workspace: u.units_usage_workspace,
      usage_reset_date: u.usage_reset_date,
      api_key_expiration_date: u.api_key_expiration_date,
    },
  };
}

function reportGoogleOAuth(
  clientId?: string,
  clientSecret?: string,
  redirect?: string,
): ProbeResult {
  const missing: string[] = [];
  if (!clientId) missing.push("GOOGLE_CLIENT_ID");
  if (!clientSecret) missing.push("GOOGLE_CLIENT_SECRET");
  if (!redirect) missing.push("GOOGLE_REDIRECT_URI");
  if (missing.length) {
    return { configured: false, ok: false, error: `Missing: ${missing.join(", ")}` };
  }
  return { configured: true, ok: true };
}

export const Route = createFileRoute("/api/live/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Auth: Owner/Admin EXAKT in der aktiven Organisation (13.09.2026) —
        // vorher genuegte Admin in IRGENDEINER Organisation.
        const team = await requireTeamRole(request, "admin");
        if (team instanceof Response) return team;

        const env = process.env;
        const gemini = env.GEMINI_API_KEY;
        const openai = env.OPENAI_API_KEY;
        const anthropic = env.ANTHROPIC_API_KEY;
        const perplexity = env.PERPLEXITY_API_KEY;
        const canonryBase = env.CANONRY_BASE_URL;
        const canonryKey = env.CANONRY_API_KEY;
        const dfsLogin = env.DATAFORSEO_LOGIN;
        const dfsPass = env.DATAFORSEO_PASSWORD;
        const ahrefsKey = env.AHREFS_API_KEY;
        const gClientId = env.GOOGLE_CLIENT_ID;
        const gClientSecret = env.GOOGLE_CLIENT_SECRET;
        const gRedirect = env.GOOGLE_REDIRECT_URI;

        const [g, o, a, p, c, dfs, ah] = await Promise.all([
          probeGemini(gemini),
          probeOpenAI(openai),
          probeAnthropic(anthropic),
          probePerplexity(perplexity),
          probeCanonry(canonryBase, canonryKey),
          probeDataForSEO(dfsLogin, dfsPass),
          probeAhrefs(ahrefsKey),
        ]);

        const result: LiveStatus = {
          generated_at: new Date().toISOString(),
          providers: {
            gemini: g,
            openai: o,
            anthropic: a,
            perplexity: p,
            canonry: c,
            dataforseo: dfs,
            ahrefs: ah,
            google_oauth: reportGoogleOAuth(gClientId, gClientSecret, gRedirect),
          },
          supabase_keys: supabaseKeyTyp(),
        };

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
