import { describe, it, expect } from "vitest";
import { waehleMitgliedschaft } from "./team-guard.server";
import {
  encryptSecret,
  decryptSecret,
  brauchtUmschluesselung,
  secretStatus,
} from "./secretbox.server";

// ── Ziel 2: Mehrfach-Mitgliedschaften ───────────────────────────────────────
const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORG_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("waehleMitgliedschaft (Mehrfach-Mitgliedschaften)", () => {
  const beide = [
    { organizationId: ORG_A, role: "admin" },
    { organizationId: ORG_B, role: "member" },
  ];

  it("keine Mitgliedschaft -> keine", () => {
    expect(waehleMitgliedschaft([], null)).toEqual({ ok: false, grund: "keine" });
  });

  it("genau eine Mitgliedschaft ohne Wunsch -> diese", () => {
    const r = waehleMitgliedschaft([{ organizationId: ORG_A, role: "member" }], null);
    expect(r).toEqual({ ok: true, aktiv: { organizationId: ORG_A, role: "member" } });
  });

  it("mehrere Mitgliedschaften ohne Wunsch -> mehrdeutig (NIE einfach die erste)", () => {
    expect(waehleMitgliedschaft(beide, null)).toEqual({ ok: false, grund: "mehrdeutig" });
  });

  it("Wunsch-Org waehlt die Rolle EXAKT in dieser Organisation", () => {
    expect(waehleMitgliedschaft(beide, ORG_A)).toEqual({
      ok: true,
      aktiv: { organizationId: ORG_A, role: "admin" },
    });
    expect(waehleMitgliedschaft(beide, ORG_B)).toEqual({
      ok: true,
      aktiv: { organizationId: ORG_B, role: "member" },
    });
  });

  it("fremde oder formungueltige Wunsch-Org -> fremd (fail-closed)", () => {
    expect(waehleMitgliedschaft(beide, ORG_C)).toEqual({ ok: false, grund: "fremd" });
    expect(waehleMitgliedschaft(beide, "org-a-slug")).toEqual({ ok: false, grund: "fremd" });
    expect(waehleMitgliedschaft(beide, "'; DROP TABLE app_users; --")).toEqual({
      ok: false,
      grund: "fremd",
    });
  });
});

// ── Ziel 3: dedizierter WP_SECRET_KEY_V1 + Migration + Strict-Modus ─────────
const NUR_LEGACY = { ADMIN_AUTOMATION_SECRET: "altes-automation-secret" };
const MIT_DEDIZIERT = { ...NUR_LEGACY, WP_SECRET_KEY_V1: "dedizierter-wp-schluessel" };
const ROTIERT = { ...MIT_DEDIZIERT, WP_SECRET_KEY_V2: "rotierter-wp-schluessel" };

describe("Secretbox Runde 2 (dedizierter Schluessel)", () => {
  it("mit WP_SECRET_KEY_V1 verschluesselt encryptSecret als w1 — nie mehr Legacy-v1", () => {
    const c = encryptSecret("geheim", MIT_DEDIZIERT);
    expect(c.startsWith("enc:w1:")).toBe(true);
    expect(decryptSecret(c, MIT_DEDIZIERT)).toBe("geheim");
  });

  it("Migration: Legacy-v1-Ciphertext bleibt lesbar und wird als umzuschluesseln erkannt", () => {
    const legacy = encryptSecret("bestand", NUR_LEGACY); // v1 (HKDF)
    expect(legacy.startsWith("enc:v1:")).toBe(true);
    // Nach Setzen des dedizierten Schluessels: lesbar + brauchtUmschluesselung.
    expect(decryptSecret(legacy, MIT_DEDIZIERT)).toBe("bestand");
    expect(brauchtUmschluesselung(legacy, MIT_DEDIZIERT)).toBe(true);
    // Sichere Migration = decrypt + encrypt mit neuem Schluessel.
    const migriert = encryptSecret(decryptSecret(legacy, MIT_DEDIZIERT), MIT_DEDIZIERT);
    expect(migriert.startsWith("enc:w1:")).toBe(true);
    expect(decryptSecret(migriert, MIT_DEDIZIERT)).toBe("bestand");
    expect(brauchtUmschluesselung(migriert, MIT_DEDIZIERT)).toBe(false);
    // Auch NACH Entfernen des ADMIN-Secrets aus der Registry lesbar (Entkopplung).
    expect(decryptSecret(migriert, { WP_SECRET_KEY_V1: MIT_DEDIZIERT.WP_SECRET_KEY_V1 })).toBe(
      "bestand",
    );
  });

  it("Key-Rotation V2: neue Secrets nutzen w2, w1-Bestand bleibt lesbar", () => {
    const alt = encryptSecret("wert", MIT_DEDIZIERT); // w1
    const neu = encryptSecret("wert", ROTIERT);
    expect(neu.startsWith("enc:w2:")).toBe(true);
    expect(decryptSecret(alt, ROTIERT)).toBe("wert");
    expect(brauchtUmschluesselung(alt, ROTIERT)).toBe(true);
    expect(brauchtUmschluesselung(neu, ROTIERT)).toBe(false);
  });

  it("Klartext-Fallback: tolerant ohne, VERWEIGERT mit WP_SECRETS_STRICT=1", () => {
    expect(decryptSecret("klartext-passwort", MIT_DEDIZIERT)).toBe("klartext-passwort");
    let msg = "";
    try {
      decryptSecret("klartext-passwort", { ...MIT_DEDIZIERT, WP_SECRETS_STRICT: "1" });
    } catch (e) {
      msg = String((e as Error).message);
    }
    expect(msg).toContain("Klartext-Secret verweigert");
    // Die Fehlermeldung enthaelt NIE den Secret-Inhalt.
    expect(msg).not.toContain("klartext-passwort");
  });

  it("secretStatus kategorisiert ohne Inhalte: aktuell/veraltet/klartext/fehlerhaft", () => {
    const w1 = encryptSecret("x", MIT_DEDIZIERT);
    const legacy = encryptSecret("x", NUR_LEGACY);
    expect(secretStatus(w1, MIT_DEDIZIERT)).toBe("aktuell");
    expect(secretStatus(legacy, MIT_DEDIZIERT)).toBe("veraltet");
    expect(secretStatus("klartext", MIT_DEDIZIERT)).toBe("klartext");
    // Manipulierter Ciphertext (GCM-Tag bricht) und unbekannte Version.
    expect(secretStatus(w1.slice(0, -4) + "AAAA", MIT_DEDIZIERT)).toBe("fehlerhaft");
    expect(secretStatus("enc:w9:aaaa:bbbb:cccc", MIT_DEDIZIERT)).toBe("fehlerhaft");
  });
});
