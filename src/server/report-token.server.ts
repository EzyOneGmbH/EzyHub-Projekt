// Signierte oeffentliche Report-Links (Security-Hardening 18.08.2026).
// Token v2 bindet clientId UND organizationId: v2|clientId|orgId|exp|hmac —
// ein Link kann damit nie Kunden einer fremden Organisation ausliefern, selbst
// wenn eine clientId erraten wird. Zusaetzlich wird jeder Link in
// public_report_links registriert (Audit, Ablauf, Widerruf); der GET prueft
// beides. Pure Funktionen (Secret als Parameter) — direkt vitest-testbar.
import { createHmac, createHash, timingSafeEqual } from "node:crypto";

const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64u = (s: string) => Buffer.from(s, "base64url").toString("utf8");
const sign = (payload: string, secret: string) =>
  createHmac("sha256", secret).update(payload).digest("base64url");

export function makeReportToken(
  clientId: string,
  organizationId: string,
  days: number,
  secret: string,
  now = Date.now(),
): string {
  const exp = now + days * 864e5;
  const payload = `v2|${clientId}|${organizationId}|${exp}`;
  return b64u(`${payload}|${sign(payload, secret)}`);
}

export type ReportTokenClaims = { clientId: string; organizationId: string; exp: number };

/** null bei Manipulation, fremdem Format oder Ablauf. Legacy-v1-Tokens (ohne
 *  Org-Bindung) werden bewusst NICHT mehr akzeptiert. */
export function verifyReportToken(
  token: string,
  secret: string,
  now = Date.now(),
): ReportTokenClaims | null {
  try {
    const raw = unb64u(token);
    const i = raw.lastIndexOf("|");
    if (i <= 0) return null;
    const payload = raw.slice(0, i);
    const mac = raw.slice(i + 1);
    const want = sign(payload, secret);
    if (mac.length !== want.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(want)))
      return null;
    const teile = payload.split("|");
    if (teile.length !== 4 || teile[0] !== "v2") return null;
    const [, clientId, organizationId, expStr] = teile;
    const exp = Number(expStr);
    if (!clientId || !organizationId || !Number.isFinite(exp) || exp < now) return null;
    return { clientId, organizationId, exp };
  } catch {
    return null;
  }
}

/** Nur der Hash landet in der DB — das Token selbst bleibt beim Empfaenger. */
export function reportTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Konsumenten-Check des GET: Claims muessen exakt zum geladenen Kunden passen
 *  (Cross-Tenant-Grenze, vitest-getestet). */
export function claimsPassenZuKunde(
  claims: ReportTokenClaims,
  kunde: { id: string; organization_id: string },
): boolean {
  return claims.clientId === kunde.id && claims.organizationId === kunde.organization_id;
}
