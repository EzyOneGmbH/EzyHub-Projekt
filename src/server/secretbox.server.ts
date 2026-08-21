// Anwendungsseitige Secret-Verschluesselung (Security-Hardening 18.08.2026,
// Runde 2 21.08.2026). Einsatz: WordPress Application Passwords in
// oauth_connections.access_token — AES-256-GCM mit VERSIONIERTEM Schluessel.
//
// Format:  enc:<version>:<iv b64url>:<tag b64url>:<ciphertext b64url>
//
// Schluessel-Registry (Runde 2):
//  - w1..w9  = DEDIZIERTE Schluessel aus WP_SECRET_KEY_V1..V9 (sha256 des
//    Env-Werts). Das ist der dauerhafte Weg: der Verschluesselungsschluessel
//    haengt NICHT mehr am breit geteilten ADMIN_AUTOMATION_SECRET.
//  - v1      = LEGACY, per HKDF aus ADMIN_AUTOMATION_SECRET abgeleitet.
//    Bleibt NUR LESBAR, damit der Bestand migriert werden kann — neue
//    Secrets werden nie mehr mit v1 verschluesselt, sobald ein wN existiert.
//    (Die frueheren v2..v9-Slots wurden nie benutzt; Prod kennt nur v1.)
//
// Key-Rotation: WP_SECRET_KEY_V2 setzen -> neue Secrets nutzen automatisch die
// hoechste w-Version; alte w-Versionen bleiben lesbar; POST
// /api/admin/secure-migrate verschluesselt den Bestand um. Rollback: alten
// Schluessel gesetzt lassen (nur lesbar) und erneut migrieren.
//
// Klartext-Fallback: decryptSecret laesst Legacy-Klartext (ohne enc:-Praefix)
// unveraendert durch, DAMIT der Bestand bis zur Migration funktioniert.
// Nach erfolgreicher Migration WP_SECRETS_STRICT=1 setzen — dann wird
// Klartext VERWEIGERT (fail-closed) statt durchgereicht.
//
// Regeln: Klartexte NIE loggen, NIE an den Browser geben; Fehlermeldungen
// enthalten NIE Secret-Inhalte (nur Versionskennungen/Zaehler).
import { createCipheriv, createDecipheriv, hkdfSync, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc:";

function keyRegistry(
  env: Record<string, string | undefined> = process.env as any,
): Map<string, Buffer> {
  const keys = new Map<string, Buffer>();
  // Legacy v1 (nur lesen): HKDF aus ADMIN_AUTOMATION_SECRET.
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
  // Dedizierte Schluessel w1..w9 aus WP_SECRET_KEY_V1..V9.
  for (let n = 1; n <= 9; n++) {
    const raw = env[`WP_SECRET_KEY_V${n}`];
    if (raw) keys.set(`w${n}`, createHash("sha256").update(raw, "utf8").digest());
  }
  return keys;
}

/** Hoechste dedizierte w-Version; Legacy-v1 nur als letzter Fallback. */
function neuesteVersion(keys: Map<string, Buffer>): string | null {
  let bestW: number = 0;
  for (const v of keys.keys()) {
    if (v.startsWith("w")) bestW = Math.max(bestW, Number(v.slice(1)) || 0);
  }
  if (bestW) return `w${bestW}`;
  return keys.has("v1") ? "v1" : null;
}

export function istVerschluesselt(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function encryptSecret(plain: string, env?: Record<string, string | undefined>): string {
  const keys = keyRegistry(env);
  const version = neuesteVersion(keys);
  if (!version)
    throw new Error("Secretbox: kein Schluessel konfiguriert (WP_SECRET_KEY_V1 setzen)");
  const key = keys.get(version)!;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${version}:${iv.toString("base64url")}:${tag.toString("base64url")}:${ct.toString("base64url")}`;
}

/**
 * Entschluesselt enc:-Werte. Legacy-Klartext geht unveraendert durch, AUSSER
 * WP_SECRETS_STRICT=1 ist gesetzt (nach der Migration): dann wird Klartext
 * verweigert — fail-closed, ohne den Inhalt in der Meldung zu nennen.
 */
export function decryptSecret(stored: string, env?: Record<string, string | undefined>): string {
  const e = env ?? (process.env as any);
  if (!istVerschluesselt(stored)) {
    if (String(e.WP_SECRETS_STRICT || "") === "1")
      throw new Error("Secretbox: Klartext-Secret verweigert (WP_SECRETS_STRICT=1)");
    return stored;
  }
  const [, version, ivB, tagB, ctB] = stored.split(":");
  const keys = keyRegistry(e);
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

export type SecretStatus = "aktuell" | "veraltet" | "klartext" | "fehlerhaft";

/**
 * Status EINES gespeicherten Secrets — ausschliesslich als Kategorie, nie mit
 * Inhalten: "aktuell" (neueste Version, entschluesselbar), "veraltet" (alte
 * Version oder Legacy-v1, aber entschluesselbar), "klartext" (unverschluesselt),
 * "fehlerhaft" (enc:-Format, aber nicht entschluesselbar).
 */
export function secretStatus(
  stored: string,
  env?: Record<string, string | undefined>,
): SecretStatus {
  if (!istVerschluesselt(stored)) return "klartext";
  const keys = keyRegistry(env ?? (process.env as any));
  const aktuell = neuesteVersion(keys);
  try {
    // Probe-Decrypt OHNE Strict-Gate (enc:-Werte sind nie Klartext).
    const [, version, ivB, tagB, ctB] = stored.split(":");
    const key = keys.get(version);
    if (!key) return "fehlerhaft";
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64url"));
    d.setAuthTag(Buffer.from(tagB, "base64url"));
    Buffer.concat([d.update(Buffer.from(ctB, "base64url")), d.final()]);
    return stored.split(":")[1] === aktuell ? "aktuell" : "veraltet";
  } catch {
    return "fehlerhaft";
  }
}
