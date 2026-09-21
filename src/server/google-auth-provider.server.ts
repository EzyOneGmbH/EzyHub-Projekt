// Google-Auth-Provider (First-Party-KPIs, Phase 1, 22.09.2026, Volkan):
// Zwei Wege zum Access-Token, hinter einem Interface, damit der Datenlauf
// nicht wissen muss, wie autorisiert wird:
//   - service_account: JWT-Bearer-Flow mit dem dedizierten Service Account
//     (Key NUR serverseitig in GOOGLE_SERVICE_ACCOUNT_JSON — roh oder base64;
//     nie im Client, nie im Repo, nie in Logs). Scopes rein lesend.
//   - oauth: bestehende Kunden-Verbindung (oauth_connections) als Fallback,
//     solange der Service Account in der Property noch nicht eingetragen ist.
// Signatur ueber WebCrypto (RSASSA-PKCS1-v1_5/SHA-256) — laeuft in Node UND
// auf Cloudflare Workers ohne node:crypto.
import { getGoogleAccessToken } from "./google-tokens.server";

export const FIRST_PARTY_SCOPES = [
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
] as const;

export type AuthArt = "service_account" | "oauth";

export type GoogleToken = { accessToken: string; art: AuthArt; email: string | null };

export interface GoogleAuthProvider {
  readonly art: AuthArt;
  /** Ist dieser Provider grundsaetzlich einsatzbereit (Konfiguration vorhanden)? */
  verfuegbar(): boolean;
  /** Access-Token fuer diesen Kunden (wirft bei fehlender Berechtigung/Konfiguration). */
  accessToken(clientId: string): Promise<GoogleToken>;
}

export type ServiceAccountKey = {
  client_email: string;
  private_key: string;
  token_uri?: string;
  project_id?: string;
};

/** Key aus der Env lesen (JSON roh oder base64). Gibt null zurueck, wenn nicht gesetzt. */
export function ladeServiceAccountKey(
  roh: string | undefined = process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
): ServiceAccountKey | null {
  const s = (roh || "").trim();
  if (!s) return null;
  let text = s;
  if (!s.startsWith("{")) {
    try {
      text = typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("utf8");
    } catch {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON ist weder JSON noch base64");
    }
  }
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON: JSON nicht lesbar");
  }
  if (j?.type !== "service_account" || !j.client_email || !j.private_key)
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON: kein Service-Account-Key (type/client_email/private_key)",
    );
  return {
    client_email: String(j.client_email),
    private_key: String(j.private_key),
    token_uri: j.token_uri ? String(j.token_uri) : undefined,
    project_id: j.project_id ? String(j.project_id) : undefined,
  };
}

const b64url = (bytes: Uint8Array | string): string => {
  const bin =
    typeof bytes === "string"
      ? bytes
      : Array.from(bytes)
          .map((b) => String.fromCharCode(b))
          .join("");
  const b64 =
    typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

function pemZuPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s+/g, "");
  const bin =
    typeof atob === "function" ? atob(body) : Buffer.from(body, "base64").toString("binary");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** Signiertes JWT (RS256) fuer den Google-JWT-Bearer-Flow. */
export async function signiereJwtRs256(
  claims: Record<string, unknown>,
  privateKeyPem: string,
): Promise<string> {
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = b64url(enc.encode(JSON.stringify(claims)));
  const input = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemZuPkcs8(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

type TokenCache = Map<string, { token: string; laeuftAbMs: number }>;
const cache: TokenCache = new Map();

export type TokenAbhaengigkeiten = {
  fetch?: typeof fetch;
  jetztMs?: () => number;
  cache?: TokenCache;
};

/** Access-Token des Service Accounts (gecacht bis 60 s vor Ablauf). */
export async function serviceAccountAccessToken(
  key: ServiceAccountKey,
  scopes: readonly string[] = FIRST_PARTY_SCOPES,
  dep: TokenAbhaengigkeiten = {},
): Promise<string> {
  const f = dep.fetch ?? fetch;
  const jetzt = dep.jetztMs ?? Date.now;
  const c = dep.cache ?? cache;
  const cacheKey = `${key.client_email}|${scopes.join(" ")}`;
  const hit = c.get(cacheKey);
  if (hit && hit.laeuftAbMs - 60_000 > jetzt()) return hit.token;

  const tokenUri = key.token_uri || "https://oauth2.googleapis.com/token";
  const iat = Math.floor(jetzt() / 1000);
  const assertion = await signiereJwtRs256(
    { iss: key.client_email, scope: scopes.join(" "), aud: tokenUri, iat, exp: iat + 3600 },
    key.private_key,
  );
  const r = await f(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Service-Account-Token HTTP ${r.status}: ${text.slice(0, 200)}`);
  const j = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new Error("Service-Account-Token: access_token fehlt");
  c.set(cacheKey, { token: j.access_token, laeuftAbMs: jetzt() + (j.expires_in ?? 3600) * 1000 });
  return j.access_token;
}

export function serviceAccountProvider(
  key: ServiceAccountKey | null = ladeServiceAccountKey(),
  dep: TokenAbhaengigkeiten = {},
): GoogleAuthProvider {
  return {
    art: "service_account",
    verfuegbar: () => !!key,
    async accessToken() {
      if (!key) throw new Error("Service Account nicht konfiguriert (GOOGLE_SERVICE_ACCOUNT_JSON)");
      const accessToken = await serviceAccountAccessToken(key, FIRST_PARTY_SCOPES, dep);
      return { accessToken, art: "service_account", email: key.client_email };
    },
  };
}

export function oauthProvider(
  holeToken: (
    clientId: string,
  ) => Promise<{ accessToken: string; email: string | null }> = getGoogleAccessToken,
): GoogleAuthProvider {
  return {
    art: "oauth",
    verfuegbar: () => true,
    async accessToken(clientId) {
      const t = await holeToken(clientId);
      return { accessToken: t.accessToken, art: "oauth", email: t.email };
    },
  };
}

/**
 * Reihenfolge fuer First-Party-Daten: Service Account, wenn konfiguriert,
 * sonst OAuth des Kunden. `bevorzugt` erzwingt einen Weg (Verbindungstest).
 */
export function firstPartyProvider(
  bevorzugt?: AuthArt,
  provider: { sa?: GoogleAuthProvider; oauth?: GoogleAuthProvider } = {},
): GoogleAuthProvider {
  const sa = provider.sa ?? serviceAccountProvider();
  const oa = provider.oauth ?? oauthProvider();
  if (bevorzugt === "oauth") return oa;
  if (bevorzugt === "service_account") return sa;
  return sa.verfuegbar() ? sa : oa;
}

/** Klartext-Schluessel und Tokens aus Fehlermeldungen entfernen. */
export function redaktiereAuth(text: string, key: ServiceAccountKey | null): string {
  let t = text;
  if (key?.private_key) t = t.split(key.private_key).join("[private_key]");
  return t
    .replace(/ya29\.[A-Za-z0-9_-]+/g, "[token]")
    .replace(/Bearer [A-Za-z0-9._-]+/g, "Bearer [token]");
}
