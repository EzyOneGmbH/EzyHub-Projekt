// Anwendungsseitige Secret-Verschluesselung (Security-Hardening 18.08.2026).
// Einsatz: WordPress Application Passwords in oauth_connections.access_token —
// bisher Klartext, jetzt AES-256-GCM mit VERSIONIERTEM Schluessel.
//
// Format:  enc:v<N>:<iv b64url>:<tag b64url>:<ciphertext b64url>
//
// Schluessel-Registry:
//  - v1 wird deterministisch per HKDF aus ADMIN_AUTOMATION_SECRET abgeleitet —
//    sofort einsatzfaehig, KEIN neues Env noetig (Lovable-Env-Falle).
//  - v2..vN kommen aus WP_SECRET_KEY_V2.. (beliebiger String, wird gehasht).
//    Key-Rotation: neues Env setzen -> neue Secrets nutzen automatisch die
//    hoechste Version; alte Versionen bleiben lesbar; /api/admin/secure-migrate
//    verschluesselt Bestand auf die aktuelle Version um.
//
// Regeln: Klartexte NIE loggen, NIE an den Browser geben; decryptSecret gibt
// Legacy-Klartext (ohne enc:-Praefix) unveraendert zurueck, damit bestehende
// Eintraege bis zur Migration weiter funktionieren.
import { createCipheriv, createDecipheriv, hkdfSync, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc:";

function keyRegistry(
  env: Record<string, string | undefined> = process.env as any,
): Map<string, Buffer> {
  const keys = new Map<string, Buffer>();
  const master = env.ADMIN_AUTOMATION_SECRET;
  if (master) {
    keys.set(
      "v1",
      Buffer.from(
        hkdfSync(
          "sha256",
          Buffer.from(master, "utf8"),
          Buffer.alloc(0),
          "ezyhub-wp-secrets-v1",
          32,
        ),
      ),
    );
  }
  for (let n = 2; n <= 9; n++) {
    const raw = env[`WP_SECRET_KEY_V${n}`];
    if (raw) keys.set(`v${n}`, createHash("sha256").update(raw, "utf8").digest());
  }
  return keys;
}

function neuesteVersion(keys: Map<string, Buffer>): string | null {
  let best: string | null = null;
  for (const v of keys.keys()) {
    if (!best || Number(v.slice(1)) > Number(best.slice(1))) best = v;
  }
  return best;
}

export function istVerschluesselt(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function encryptSecret(plain: string, env?: Record<string, string | undefined>): string {
  const keys = keyRegistry(env);
  const version = neuesteVersion(keys);
  if (!version)
    throw new Error("Secretbox: kein Schluessel konfiguriert (ADMIN_AUTOMATION_SECRET fehlt)");
  const key = keys.get(version)!;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${version}:${iv.toString("base64url")}:${tag.toString("base64url")}:${ct.toString("base64url")}`;
}

/** Entschluesselt enc:-Werte; Legacy-Klartext geht unveraendert durch. */
export function decryptSecret(stored: string, env?: Record<string, string | undefined>): string {
  if (!istVerschluesselt(stored)) return stored;
  const [, version, ivB, tagB, ctB] = stored.split(":");
  const keys = keyRegistry(env);
  const key = keys.get(version);
  if (!key)
    throw new Error(`Secretbox: Schluessel ${version} nicht verfuegbar (Rotation unvollstaendig?)`);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]).toString(
    "utf8",
  );
}

/** Fuer Rotation/Migration: neu verschluesseln, wenn Klartext oder alte Version. */
export function brauchtUmschluesselung(
  stored: string,
  env?: Record<string, string | undefined>,
): boolean {
  const keys = keyRegistry(env);
  const aktuell = neuesteVersion(keys);
  if (!aktuell) return false;
  if (!istVerschluesselt(stored)) return true;
  return stored.split(":")[1] !== aktuell;
}
