// First-Party-KPIs, Phase 1: Auth-Provider — JWT-Bearer-Flow mit Fake-Key,
// Token-Cache, Provider-Reihenfolge (Service Account → OAuth-Fallback),
// Key-Parsing (roh/base64/ungueltig) und Redaktion von Secrets.
import { describe, expect, it } from "vitest";
import {
  FIRST_PARTY_SCOPES,
  firstPartyProvider,
  ladeServiceAccountKey,
  oauthProvider,
  redaktiereAuth,
  serviceAccountAccessToken,
  serviceAccountProvider,
  signiereJwtRs256,
} from "./google-auth-provider.server";

async function testKey() {
  const kp = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  const b64 = Buffer.from(pkcs8).toString("base64");
  const pem = `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
  return { pem, publicKey: kp.publicKey };
}

const b64urlDecode = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

describe("Service-Account-JWT", () => {
  it("signiert RS256 gueltig (verifizierbar mit dem Public Key), Claims korrekt", async () => {
    const { pem, publicKey } = await testKey();
    const jwt = await signiereJwtRs256(
      {
        iss: "sa@test.iam",
        scope: FIRST_PARTY_SCOPES.join(" "),
        aud: "https://oauth2.googleapis.com/token",
        iat: 1,
        exp: 3601,
      },
      pem,
    );
    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(b64urlDecode(h).toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(b64urlDecode(p).toString());
    expect(claims.iss).toBe("sa@test.iam");
    expect(claims.scope).toContain("webmasters.readonly");
    expect(claims.scope).toContain("analytics.readonly");
    expect(claims.scope).not.toMatch(/analytics\.edit|auth\/webmasters"?$/);
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      b64urlDecode(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok).toBe(true);
  });

  it("tauscht das JWT gegen ein Access-Token und cached bis 60 s vor Ablauf", async () => {
    const { pem } = await testKey();
    const key = { client_email: "sa@test.iam", private_key: pem };
    let calls = 0;
    const fakeFetch = (async (_url: string, init: any) => {
      calls++;
      const body = init.body as URLSearchParams;
      expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
      expect(body.get("assertion")).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
      return new Response(JSON.stringify({ access_token: `ya29.tok${calls}`, expires_in: 3600 }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    let jetzt = 1_000_000;
    const cache = new Map();
    const dep = { fetch: fakeFetch, jetztMs: () => jetzt, cache };
    expect(await serviceAccountAccessToken(key, FIRST_PARTY_SCOPES, dep)).toBe("ya29.tok1");
    jetzt += 30 * 60_000; // 30 min spaeter: Cache greift
    expect(await serviceAccountAccessToken(key, FIRST_PARTY_SCOPES, dep)).toBe("ya29.tok1");
    jetzt += 30 * 60_000; // 60 min: innerhalb der 60-s-Reserve → neu
    expect(await serviceAccountAccessToken(key, FIRST_PARTY_SCOPES, dep)).toBe("ya29.tok2");
    expect(calls).toBe(2);
  });

  it("meldet HTTP-Fehler des Token-Endpunkts ohne Key-Material", async () => {
    const { pem } = await testKey();
    const key = { client_email: "sa@test.iam", private_key: pem };
    const fakeFetch = (async () =>
      new Response("invalid_grant: bad", { status: 400 })) as unknown as typeof fetch;
    await expect(
      serviceAccountAccessToken(key, FIRST_PARTY_SCOPES, { fetch: fakeFetch, cache: new Map() }),
    ).rejects.toThrow(/HTTP 400/);
  });
});

describe("Key-Parsing", () => {
  const json = JSON.stringify({
    type: "service_account",
    client_email: "a@b.iam",
    private_key: "-----BEGIN PRIVATE KEY-----\nX\n-----END PRIVATE KEY-----\n",
    token_uri: "https://oauth2.googleapis.com/token",
  });
  it("roh und base64", () => {
    expect(ladeServiceAccountKey(json)?.client_email).toBe("a@b.iam");
    expect(ladeServiceAccountKey(Buffer.from(json).toString("base64"))?.client_email).toBe(
      "a@b.iam",
    );
  });
  it("leer → null, ungueltig → Fehler", () => {
    expect(ladeServiceAccountKey("")).toBeNull();
    expect(ladeServiceAccountKey(undefined)).toBeNull();
    expect(() => ladeServiceAccountKey('{"type":"user"}')).toThrow(/kein Service-Account-Key/);
    expect(() => ladeServiceAccountKey("nicht-json")).toThrow();
  });
});

describe("Provider-Reihenfolge", () => {
  const oa = oauthProvider(async (clientId) => ({
    accessToken: `oauth-${clientId}`,
    email: "kunde@firma.ch",
  }));
  it("ohne Service Account → OAuth-Fallback", async () => {
    const sa = serviceAccountProvider(null);
    const p = firstPartyProvider(undefined, { sa, oauth: oa });
    expect(p.art).toBe("oauth");
    expect(await p.accessToken("c1")).toEqual({
      accessToken: "oauth-c1",
      art: "oauth",
      email: "kunde@firma.ch",
    });
  });
  it("mit Service Account → Service Account; bevorzugt=oauth erzwingt OAuth", async () => {
    const { pem } = await testKey();
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({ access_token: "ya29.sa", expires_in: 3600 }),
      )) as unknown as typeof fetch;
    const sa = serviceAccountProvider(
      { client_email: "sa@test.iam", private_key: pem },
      { fetch: fakeFetch, cache: new Map() },
    );
    expect(firstPartyProvider(undefined, { sa, oauth: oa }).art).toBe("service_account");
    expect((await firstPartyProvider(undefined, { sa, oauth: oa }).accessToken("c1")).email).toBe(
      "sa@test.iam",
    );
    expect(firstPartyProvider("oauth", { sa, oauth: oa }).art).toBe("oauth");
    await expect(serviceAccountProvider(null).accessToken("c1")).rejects.toThrow(
      /nicht konfiguriert/,
    );
  });
});

describe("Redaktion", () => {
  it("entfernt private_key und Tokens aus Fehlertexten", () => {
    const key = { client_email: "a@b.iam", private_key: "GEHEIM-PEM" };
    expect(redaktiereAuth("Fehler GEHEIM-PEM bei Bearer ya29.abc-def", key)).toBe(
      "Fehler [private_key] bei Bearer [token]",
    );
  });
});
