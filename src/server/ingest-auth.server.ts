// Mandantenfeste Ingest-Authentifizierung (Security-Runde 3, 13.09.2026).
//
// Vorher: EIN globales Secret je Schnittstelle (an alle Kunden verteilt) +
// Kunden-Aufloesung ueber clientId/Domain AUS DEM REQUEST — wer das Secret
// hatte, konnte Daten fuer JEDEN Kunden schreiben.
//
// Jetzt: kundenspezifische Credentials (ingest_credentials). Ein Token ist
// serverseitig FEST an organization_id + client_id + purpose gebunden; der
// Scope kommt ausschliesslich aus der DB-Zeile — clientId/Domain im Request
// sind hoechstens eine Konsistenzpruefung und koennen den Scope NIE erweitern.
//
// Gespeichert wird nur sha256(token) (Muster public_report_links). Der
// Klartext existiert genau einmal: in der Antwort beim Erzeugen/Rotieren.
// Ablauf (expires_at) und Widerruf (revoked_at) werden bei JEDEM Request
// geprueft. ADMIN_AUTOMATION_SECRET bleibt als INTERNER Administrationspfad
// (agent-service/Betrieb) — nie an Kunden geben.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authFailLimiter, clientIp, ingestLimiter, antwort429 } from "./rate-limit.server";

// rank_snapshot (13.09.2026): kundenspezifisches Credential fuer den Ranking-
// Snapshot-Ingest (Alternative zum internen Admin-Pfad mit Org-Stempel).
export const INGEST_PURPOSES = ["openai_ads", "ai_crawler", "rank_snapshot"] as const;
export type IngestPurpose = (typeof INGEST_PURPOSES)[number];

const PURPOSE_KURZ: Record<IngestPurpose, string> = {
  openai_ads: "oa",
  ai_crawler: "cr",
  rank_snapshot: "rs",
};
const TOKEN_RE = /^ezyi_(oa|cr|rs)_[A-Za-z0-9_-]{43}$/;

export type IngestScope =
  | {
      admin: false;
      credentialId: string;
      organizationId: string;
      clientId: string;
      purpose: IngestPurpose;
    }
  | { admin: true };

export type IngestAuthErgebnis =
  | { ok: true; scope: IngestScope }
  | { ok: false; response: Response };

// ── Token-Erzeugung / Hash ─────────────────────────────────────────────────
export function ingestTokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function istIngestTokenFormat(token: string): boolean {
  return TOKEN_RE.test(token);
}

/** Neues Token: 32 Bytes Zufall (base64url = 43 Zeichen) + lesbarer Praefix. */
export function generateIngestToken(purpose: IngestPurpose): {
  token: string;
  tokenHash: string;
  tokenPrefix: string;
} {
  const token = `ezyi_${PURPOSE_KURZ[purpose]}_${randomBytes(32).toString("base64url")}`;
  return { token, tokenHash: ingestTokenHash(token), tokenPrefix: token.slice(0, 12) };
}

/** Zeitkonstanter Vergleich zweier Strings (fuer den Admin-Pfad). */
export function gleichZeitkonstant(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function normDomain(d: unknown): string {
  return String(d ?? "")
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

// ── Authentifizierung ──────────────────────────────────────────────────────
function bearer(request: Request): string {
  const h = request.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

const fehl = (status: number, error: string): IngestAuthErgebnis => ({
  ok: false,
  response: Response.json({ ok: false, error }, { status }),
});

/**
 * Prueft das Bearer-Token eines Ingest-Requests fuer GENAU einen Zweck.
 * Reihenfolge: Admin-Secret (intern) -> Tokenformat -> Hash-Lookup ->
 * Widerruf/Ablauf -> Rate-Limit. 401-Fehlversuche werden je IP gebremst.
 */
export async function authenticateIngest(
  request: Request,
  purpose: IngestPurpose,
  deps: { now?: () => number } = {},
): Promise<IngestAuthErgebnis> {
  const now = deps.now ?? Date.now;
  const token = bearer(request);
  const ip = clientIp(request);

  // Brute-Force-Bremse: IP bereits zu oft abgeblitzt? (peek zaehlt nicht —
  // gezaehlt werden ausschliesslich echte 401 ueber abgelehnt()).
  const fails = authFailLimiter.peek(`ip:${ip}`, now());
  if (!fails.ok) return { ok: false, response: antwort429(fails.retryAfterMs) };
  const abgelehnt = (error: string): IngestAuthErgebnis => {
    authFailLimiter.hit(`ip:${ip}`, now());
    return fehl(401, error);
  };

  if (!token) return abgelehnt("Unauthorized");

  // Interner Administrationspfad (Betrieb/agent-service) — nie an Kunden geben.
  const admin = process.env.ADMIN_AUTOMATION_SECRET;
  if (admin && gleichZeitkonstant(token, admin)) return { ok: true, scope: { admin: true } };

  if (!istIngestTokenFormat(token)) return abgelehnt("Unauthorized");
  if (token.slice(5, 7) !== PURPOSE_KURZ[purpose]) return abgelehnt("Unauthorized");

  const sb = supabaseAdmin as any;
  const { data: cred } = await sb
    .from("ingest_credentials")
    .select("id, organization_id, client_id, purpose, expires_at, revoked_at")
    .eq("token_hash", ingestTokenHash(token))
    .eq("purpose", purpose)
    .maybeSingle();
  if (!cred) return abgelehnt("Unauthorized");
  if (cred.revoked_at) return abgelehnt("Token widerrufen");
  if (cred.expires_at && new Date(cred.expires_at).getTime() <= now())
    return abgelehnt("Token abgelaufen");

  const rl = ingestLimiter.hit(`cred:${cred.id}`, now());
  if (!rl.ok) return { ok: false, response: antwort429(rl.retryAfterMs) };

  // Nutzung protokollieren (fire-and-forget): atomarer RPC zaehlt use_count
  // hoch und setzt last_used_at (13.09.2026, vorher nur last_used_at).
  try {
    Promise.resolve(sb.rpc("ingest_credential_touch", { _credential_id: cred.id })).then(
      () => {},
      () => {},
    );
  } catch {
    /* Diagnosefeld — nie den Ingest scheitern lassen */
  }

  return {
    ok: true,
    scope: {
      admin: false,
      credentialId: String(cred.id),
      organizationId: String(cred.organization_id),
      clientId: String(cred.client_id),
      purpose,
    },
  };
}

// ── Kunden-Aufloesung im Scope ─────────────────────────────────────────────
export type ScopedClient = { id: string; organization_id: string; domain: string | null };

export type ClientErgebnis = { ok: true; client: ScopedClient } | { ok: false; response: Response };

/**
 * Loest den Kunden fuer einen Ingest-Request auf.
 *  - Token-Scope: Kunde = credential.client_id, IMMER. Angegebene clientId/
 *    Domain muessen dazu passen (sonst 403) — sie koennen nichts erweitern.
 *  - Admin-Scope (intern): clientId (UUID) oder Domain wie bisher.
 */
export async function ladeScopedClient(
  scope: IngestScope,
  body: { clientId?: string; domain?: string },
): Promise<ClientErgebnis> {
  const sb = supabaseAdmin as any;
  const nein = (status: number, error: string): ClientErgebnis => ({
    ok: false,
    response: Response.json({ ok: false, error }, { status }),
  });

  if (!scope.admin) {
    const { data: c } = await sb
      .from("clients")
      .select("id, organization_id, domain")
      .eq("id", scope.clientId)
      .maybeSingle();
    // Scope-Zeile ohne passenden Kunden oder mit fremder Organisation ->
    // fail-closed (z. B. Kunde geloescht/verschoben).
    if (!c || String(c.organization_id) !== scope.organizationId)
      return nein(403, "Token-Scope ungueltig");
    if (body.clientId && String(body.clientId).toLowerCase() !== String(c.id).toLowerCase())
      return nein(403, "clientId passt nicht zum Token");
    if (body.domain) {
      const wunsch = normDomain(body.domain);
      const eigene = normDomain(c.domain);
      const passt = !!eigene && (wunsch === eigene || wunsch.endsWith("." + eigene));
      if (!passt) return nein(403, "Domain passt nicht zum Token");
    }
    return {
      ok: true,
      client: {
        id: String(c.id),
        organization_id: String(c.organization_id),
        domain: c.domain ?? null,
      },
    };
  }

  // Interner Admin-Pfad.
  if (body.clientId) {
    const { data: c } = await sb
      .from("clients")
      .select("id, organization_id, domain")
      .eq("id", body.clientId)
      .maybeSingle();
    return c
      ? {
          ok: true,
          client: {
            id: String(c.id),
            organization_id: String(c.organization_id),
            domain: c.domain ?? null,
          },
        }
      : nein(404, "Kunde nicht gefunden");
  }
  if (body.domain) {
    const wunsch = normDomain(body.domain);
    const { data: clients } = await sb.from("clients").select("id, organization_id, domain");
    const c = (clients || []).find((x: any) => {
      const d = normDomain(x.domain);
      return d && (d === wunsch || wunsch.endsWith("." + d));
    });
    return c
      ? {
          ok: true,
          client: {
            id: String(c.id),
            organization_id: String(c.organization_id),
            domain: c.domain ?? null,
          },
        }
      : nein(404, "Kunde nicht gefunden");
  }
  return nein(400, "clientId oder domain erforderlich");
}
