import { supabaseAdmin } from "@/integrations/supabase/client.server";

// WordPress connector — per-client connection via the WP REST API using
// Application Passwords (Basic auth). Credentials are stored server-side in the
// existing oauth_connections table (provider="wordpress") so no DB migration is
// needed: scopes[0] holds the site URL, account_email the WP username,
// access_token the application password. The secret never reaches the client.

export type WpConnection = {
  siteUrl: string;
  username: string;
  appPassword: string;
};

// Normalize a site URL: ensure protocol, strip trailing slash and any /wp-json.
export function normalizeSiteUrl(raw: string): string {
  let url = String(raw || "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/\/+$/, "").replace(/\/wp-json.*$/i, "");
  return url;
}

// Load a client's stored WordPress connection (with the secret). Server-only.
export async function getWpConnection(clientId: string): Promise<WpConnection | null> {
  const { data } = await supabaseAdmin
    .from("oauth_connections")
    .select("account_email, access_token, scopes")
    .eq("client_id", clientId)
    .eq("provider", "wordpress")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.access_token) return null;
  const siteUrl = Array.isArray(data.scopes) ? String(data.scopes[0] ?? "") : "";
  if (!siteUrl) return null;
  return {
    siteUrl,
    username: String(data.account_email ?? ""),
    appPassword: String(data.access_token ?? ""),
  };
}

function authHeader(conn: WpConnection): string {
  const token = Buffer.from(`${conn.username}:${conn.appPassword}`).toString("base64");
  return `Basic ${token}`;
}

// Low-level WP REST call. Returns parsed JSON + status.
export async function wpFetch<T = any>(
  conn: WpConnection,
  path: string,
  options?: { method?: string; body?: any; query?: Record<string, string | number> },
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  // Build a URL for either permalink mode: "pretty" => /wp-json{path},
  // "plain" => /?rest_route={path} (works when pretty permalinks are off).
  const buildUrl = (mode: "pretty" | "plain") => {
    const queryEntries = options?.query
      ? Object.entries(options.query).map(([k, v]) => [k, String(v)] as [string, string])
      : [];
    if (mode === "pretty") {
      let u = `${conn.siteUrl}/wp-json${path}`;
      if (queryEntries.length) u += (path.includes("?") ? "&" : "?") + new URLSearchParams(queryEntries).toString();
      return u;
    }
    // plain: rest_route carries the path; other query params are appended separately
    const params = new URLSearchParams([["rest_route", path], ...queryEntries]);
    return `${conn.siteUrl}/?${params.toString()}`;
  };

  const doFetch = async (mode: "pretty" | "plain") => {
    const res = await fetch(buildUrl(mode), {
      method: options?.method || "GET",
      headers: {
        Authorization: authHeader(conn),
        Accept: "application/json",
        ...(options?.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let json: any = null;
    let parseFailed = false;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      parseFailed = true;
    }
    return { res, json, parseFailed };
  };

  try {
    // Try pretty permalinks first; on 404 / non-JSON, retry the plain rest_route form.
    let { res, json, parseFailed } = await doFetch("pretty");
    if (res.status === 404 || parseFailed) {
      const retry = await doFetch("plain");
      // Only adopt the retry if it actually looks better (JSON or non-404).
      if (!retry.parseFailed && retry.res.status !== 404) {
        ({ res, json, parseFailed } = retry);
      }
    }

    if (parseFailed) {
      return {
        ok: false,
        status: res.status,
        data: null,
        error: `Keine JSON-Antwort (HTTP ${res.status}). REST-API erreichbar / Permalinks aktiv?`,
      };
    }
    if (!res.ok) {
      const msg = json?.message || `HTTP ${res.status}`;
      return { ok: false, status: res.status, data: null, error: String(msg).slice(0, 300) };
    }
    return { ok: true, status: res.status, data: json as T };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: String((e as Error)?.message || e).slice(0, 300) };
  }
}

// Verify a connection by calling /wp/v2/users/me. Returns the WP user on success.
export async function verifyWpConnection(
  conn: WpConnection,
): Promise<{ ok: boolean; user?: { name: string; id: number }; error?: string }> {
  const r = await wpFetch<any>(conn, "/wp/v2/users/me", { query: { context: "edit" } });
  if (!r.ok) return { ok: false, error: r.error || "Verbindung fehlgeschlagen" };
  return { ok: true, user: { name: String(r.data?.name ?? ""), id: Number(r.data?.id ?? 0) } };
}

// Detect which SEO plugin is active (Yoast / RankMath) by probing a post's meta.
export async function detectSeoPlugin(conn: WpConnection): Promise<"yoast" | "rankmath" | null> {
  // Yoast exposes yoast_head_json on posts; RankMath exposes rank_math_* meta.
  const r = await wpFetch<any[]>(conn, "/wp/v2/posts", { query: { per_page: 1, context: "edit" } });
  const post = Array.isArray(r.data) ? r.data[0] : null;
  if (!post) return null;
  if (post.yoast_head_json || post.yoast_head) return "yoast";
  if (post.meta && Object.keys(post.meta).some((k) => k.startsWith("rank_math"))) return "rankmath";
  return null;
}
