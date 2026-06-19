import { createHmac, timingSafeEqual } from "node:crypto";

const SCOPES = [
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/adwords",
  "openid",
  "email",
];

export function getGoogleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const sessionSecret = process.env.SESSION_SECRET;
  if (!clientId || !clientSecret || !redirectUri || !sessionSecret) {
    throw new Error(
      "Google OAuth not configured (GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI/SESSION_SECRET missing)",
    );
  }
  return { clientId, clientSecret, redirectUri, sessionSecret };
}

export function redactSecrets(input: unknown): string {
  let s =
    input instanceof Error ? input.message : typeof input === "string" ? input : String(input);
  for (const k of [
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_CLIENT_ID",
    "SESSION_SECRET",
    "CANONRY_API_KEY",
  ] as const) {
    const v = process.env[k];
    if (v && v.length > 4) s = s.split(v).join("***REDACTED***");
  }
  s = s.replace(/Bearer\s+[A-Za-z0-9\-_.=]+/gi, "Bearer ***REDACTED***");
  s = s.replace(/ya29\.[A-Za-z0-9\-_]+/g, "***REDACTED***");
  s = s.replace(/1\/\/[A-Za-z0-9\-_]+/g, "***REDACTED***");
  return s.slice(0, 500);
}

function b64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf) : buf;
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Buffer {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

export type OAuthState = {
  org: string;
  client: string;
  user: string;
  nonce: string;
  ts: number;
};

export function signState(state: OAuthState, secret: string): string {
  const payload = b64url(JSON.stringify(state));
  const sig = b64url(createHmac("sha256", secret).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyState(token: string, secret: string): OAuthState | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  let provided: Buffer;
  try {
    provided = fromB64url(sig);
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try {
    const obj = JSON.parse(fromB64url(payload).toString("utf8")) as OAuthState;
    if (Date.now() - obj.ts > 10 * 60 * 1000) return null; // 10 min
    return obj;
  } catch {
    return null;
  }
}

export function buildAuthUrl(state: string): string {
  const { clientId, redirectUri } = getGoogleConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
};

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const { clientId, clientSecret, redirectUri } = getGoogleConfig();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Token exchange failed: HTTP ${res.status} ${redactSecrets(t)}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = getGoogleConfig();
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Token refresh failed: HTTP ${res.status} ${redactSecrets(t)}`);
  }
  return (await res.json()) as TokenResponse;
}

export function decodeIdTokenEmail(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return null;
    const claims = JSON.parse(fromB64url(payload).toString("utf8")) as { email?: string };
    return claims.email ?? null;
  } catch {
    return null;
  }
}
