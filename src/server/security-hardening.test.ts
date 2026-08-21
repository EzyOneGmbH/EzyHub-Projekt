import { describe, it, expect } from "vitest";
import {
  makeReportToken,
  verifyReportToken,
  reportTokenHash,
  claimsPassenZuKunde,
} from "./report-token.server";
import {
  encryptSecret,
  decryptSecret,
  istVerschluesselt,
  brauchtUmschluesselung,
} from "./secretbox.server";
import { rolleErlaubt } from "./team-guard.server";

// Zwei Organisationen + Kunden als Fixtures (Cross-Tenant-Beweise).
const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const KUNDE_A = { id: "11111111-1111-4111-8111-111111111111", organization_id: ORG_A };
const KUNDE_B = { id: "22222222-2222-4222-8222-222222222222", organization_id: ORG_B };
const SECRET = "test-secret-org-uebergreifend";

describe("Report-Token v2 (Org-Bindung)", () => {
  it("gueltiges Token liefert Claims fuer Kunde+Org", () => {
    const t = makeReportToken(KUNDE_A.id, ORG_A, 30, SECRET);
    const c = verifyReportToken(t, SECRET)!;
    expect(c.clientId).toBe(KUNDE_A.id);
    expect(c.organizationId).toBe(ORG_A);
    expect(claimsPassenZuKunde(c, KUNDE_A)).toBe(true);
  });

  it("Token von Org A oeffnet NIE einen Kunden von Org B", () => {
    const t = makeReportToken(KUNDE_A.id, ORG_A, 30, SECRET);
    const c = verifyReportToken(t, SECRET)!;
    expect(claimsPassenZuKunde(c, KUNDE_B)).toBe(false);
    // auch nicht, wenn nur die Org vertauscht wuerde
    expect(claimsPassenZuKunde(c, { id: KUNDE_A.id, organization_id: ORG_B })).toBe(false);
  });

  it("manipulierte IDs brechen die Signatur (negativ)", () => {
    const t = makeReportToken(KUNDE_A.id, ORG_A, 30, SECRET);
    const raw = Buffer.from(t, "base64url").toString("utf8");
    const gefaelscht = Buffer.from(raw.replace(KUNDE_A.id, KUNDE_B.id), "utf8").toString(
      "base64url",
    );
    expect(verifyReportToken(gefaelscht, SECRET)).toBeNull();
    const orgGetauscht = Buffer.from(raw.replace(ORG_A, ORG_B), "utf8").toString("base64url");
    expect(verifyReportToken(orgGetauscht, SECRET)).toBeNull();
  });

  it("Ablauf, Fremd-Secret, Legacy-v1 und Muell werden abgelehnt", () => {
    const abgelaufen = makeReportToken(KUNDE_A.id, ORG_A, 1, SECRET, Date.now() - 3 * 864e5);
    expect(verifyReportToken(abgelaufen, SECRET)).toBeNull();
    const fremd = makeReportToken(KUNDE_A.id, ORG_A, 30, "anderes-deployment");
    expect(verifyReportToken(fremd, SECRET)).toBeNull();
    // Legacy v1: clientId|exp|hmac — bewusst nicht mehr akzeptiert
    const v1 = Buffer.from(`${KUNDE_A.id}|${Date.now() + 864e5}|abc`, "utf8").toString("base64url");
    expect(verifyReportToken(v1, SECRET)).toBeNull();
    expect(verifyReportToken("nicht-mal-base64url!!", SECRET)).toBeNull();
  });

  it("in der DB liegt nur der Hash, nie das Token", () => {
    const t = makeReportToken(KUNDE_A.id, ORG_A, 30, SECRET);
    const h = reportTokenHash(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(KUNDE_A.id);
  });
});

describe("Secretbox (WordPress Application Passwords)", () => {
  const envV1 = { ADMIN_AUTOMATION_SECRET: "master-a" };
  const envV2 = { ADMIN_AUTOMATION_SECRET: "master-a", WP_SECRET_KEY_V2: "rotations-key" };
  const PASS = "abcd EFGH 1234 ijkl";

  it("Roundtrip verschluesselt/entschluesselt, nichts im Klartext", () => {
    const enc = encryptSecret(PASS, envV1);
    expect(istVerschluesselt(enc)).toBe(true);
    expect(enc).not.toContain(PASS.split(" ")[0]);
    expect(decryptSecret(enc, envV1)).toBe(PASS);
  });

  it("Key-Rotation: v2 wird genutzt, v1-Bestand bleibt lesbar", () => {
    const alt = encryptSecret(PASS, envV1); // v1
    const neu = encryptSecret(PASS, envV2); // v2
    expect(alt.startsWith("enc:v1:")).toBe(true);
    // Runde 2 (21.08.): WP_SECRET_KEY_V<N> mappt jetzt auf dedizierte w-Versionen.
    expect(neu.startsWith("enc:w2:")).toBe(true);
    expect(decryptSecret(alt, envV2)).toBe(PASS); // Rotation bricht Bestand nicht
    expect(brauchtUmschluesselung(alt, envV2)).toBe(true); // Migration faellig
    expect(brauchtUmschluesselung(neu, envV2)).toBe(false);
    expect(brauchtUmschluesselung(PASS, envV1)).toBe(true); // Klartext -> migrieren
  });

  it("fremde Umgebung (anderes Master-Secret) kann NICHT entschluesseln", () => {
    const enc = encryptSecret(PASS, envV1);
    expect(() => decryptSecret(enc, { ADMIN_AUTOMATION_SECRET: "org-b-master" })).toThrow();
  });

  it("Manipulation am Ciphertext wird erkannt (GCM-Tag)", () => {
    const enc = encryptSecret(PASS, envV1);
    const teile = enc.split(":");
    const ct = Buffer.from(teile[4], "base64url");
    ct[0] = ct[0] ^ 0xff;
    teile[4] = ct.toString("base64url");
    expect(() => decryptSecret(teile.join(":"), envV1)).toThrow();
  });

  it("Legacy-Klartext geht bis zur Migration unveraendert durch", () => {
    expect(decryptSecret(PASS, envV1)).toBe(PASS);
    expect(istVerschluesselt(PASS)).toBe(false);
  });
});

describe("Rollen-Guard (Agent-Routen)", () => {
  it("viewer kommt NIE durch, member liest, nur owner/admin mutiert", () => {
    for (const [rolle, liest, mutiert] of [
      ["owner", true, true],
      ["admin", true, true],
      ["member", true, false],
      ["viewer", false, false],
      ["", false, false],
    ] as Array<[string, boolean, boolean]>) {
      expect(rolleErlaubt(rolle, "member")).toBe(liest);
      expect(rolleErlaubt(rolle, "admin")).toBe(mutiert);
    }
  });
});
