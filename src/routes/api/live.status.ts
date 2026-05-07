import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

type ProbeResult = {
  configured: boolean;
  ok: boolean;
  status?: number;
  error?: string;
  latency_ms?: number;
};

type LiveStatus = {
  generated_at: string;
  providers: {
    gemini: ProbeResult;
    openai: ProbeResult;
    anthropic: ProbeResult;
    perplexity: ProbeResult;
    canonry: ProbeResult;
    ahrefs: ProbeResult;
    google_oauth: ProbeResult;
  };
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
        max_tokens: 1,
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

async function probeAhrefs(key?: string): Promise<ProbeResult> {
  if (!key) return { configured: false, ok: false, error: "AHREFS_API_KEY not configured" };
  return timedFetch(
    "https://api.ahrefs.com/v3/subscription-info/limits-and-usage",
    { method: "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } },
    [key],
  );
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
        // Auth: only owner/admin allowed
        const supabaseUrl = process.env.SUPABASE_URL;
        const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
        if (!supabaseUrl || !anonKey) {
          return Response.json({ error: "Server not configured" }, { status: 503 });
        }
        const authHeader = request.headers.get("authorization") ?? "";
        if (!authHeader.toLowerCase().startsWith("bearer ")) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        const {
          data: { user },
        } = await userClient.auth.getUser();
        if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

        const { data: memberships } = await userClient
          .from("app_users")
          .select("role")
          .eq("user_id", user.id);
        const isAdmin = (memberships ?? []).some(
          (m: { role: string }) => m.role === "owner" || m.role === "admin",
        );
        if (!isAdmin) return Response.json({ error: "Forbidden" }, { status: 403 });

        const env = process.env;
        const gemini = env.GEMINI_API_KEY;
        const openai = env.OPENAI_API_KEY;
        const anthropic = env.ANTHROPIC_API_KEY;
        const perplexity = env.PERPLEXITY_API_KEY;
        const canonryBase = env.CANONRY_BASE_URL;
        const canonryKey = env.CANONRY_API_KEY;
        const ahrefs = env.AHREFS_API_KEY;
        const gClientId = env.GOOGLE_CLIENT_ID;
        const gClientSecret = env.GOOGLE_CLIENT_SECRET;
        const gRedirect = env.GOOGLE_REDIRECT_URI;

        const [g, o, a, p, c, ah] = await Promise.all([
          probeGemini(gemini),
          probeOpenAI(openai),
          probeAnthropic(anthropic),
          probePerplexity(perplexity),
          probeCanonry(canonryBase, canonryKey),
          probeAhrefs(ahrefs),
        ]);

        const result: LiveStatus = {
          generated_at: new Date().toISOString(),
          providers: {
            gemini: g,
            openai: o,
            anthropic: a,
            perplexity: p,
            canonry: c,
            ahrefs: ah,
            google_oauth: reportGoogleOAuth(gClientId, gClientSecret, gRedirect),
          },
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
