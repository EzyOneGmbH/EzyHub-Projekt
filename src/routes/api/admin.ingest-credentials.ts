import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireTeamRole } from "@/server/team-guard.server";
import {
  KUNDEN_PURPOSES,
  generateIngestToken,
  gleichZeitkonstant,
} from "@/server/ingest-auth.server";

// Verwaltung der kundenspezifischen Ingest-Credentials (Security-Runde 3,
// 13.09.2026). Ersetzt die global verteilten Ingest-Secrets.
//
// Auth: eingeloggter Owner/Admin der Organisation (requireTeamRole) ODER
// ADMIN_AUTOMATION_SECRET (interner Betriebspfad). Der Kunde muss zur
// aktiven Organisation gehoeren (403 sonst) — auch Admins koennen keine
// Credentials fuer fremde Organisationen erzeugen.
//
// GET  ?clientId=<uuid>[&purpose=]  -> Liste OHNE Geheimnisse (nur Praefix)
// POST { action: "create", clientId, purpose, label?, expiresInDays? }
//      { action: "rotate", clientId, credentialId, label?, expiresInDays?, graceDays? }
//      { action: "revoke", clientId, credentialId, reason? }
// Der Klartext-Token erscheint GENAU EINMAL in der Antwort von create/rotate.
//
// Org-weite Variante (Read-API fuer ChatGPT, 28.09.2026): purpose "read_api"
// OHNE clientId — Token gilt fuer die ganze aktive Organisation (/api/v1/…).
// NUR eingeloggte Owner/Admin (requireTeamRole "admin"); der interne
// Admin-Secret-Pfad ist dafuer gesperrt (keine Organisation im Kontext).
// GET  ?purpose=read_api            -> { credentials, log } (log = letzte 20 Aufrufe)
// POST { action: "create", purpose: "read_api", label?, expiresInDays? }
//      { action: "rotate", credentialId, label?, expiresInDays?, graceDays? }  (ohne clientId)
//      { action: "revoke", credentialId, reason? }                             (ohne clientId)

const UUID = z.string().uuid();
const Body = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      clientId: UUID.optional(),
      purpose: z.enum([...KUNDEN_PURPOSES, "read_api"]),
      label: z.string().max(80).optional(),
      expiresInDays: z.number().int().min(1).max(730).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("rotate"),
      clientId: UUID.optional(),
      credentialId: UUID,
      label: z.string().max(80).optional(),
      expiresInDays: z.number().int().min(1).max(730).optional(),
      // Ueberlappung: altes Token bleibt so lange gueltig (Default 7 Tage).
      graceDays: z.number().int().min(0).max(30).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("revoke"),
      clientId: UUID.optional(),
      credentialId: UUID,
      reason: z.string().max(200).optional(),
    })
    .strict(),
]);

type Kontext = { organizationId: string | null; userId: string | null; intern: boolean };

/** Team-Login (Owner/Admin) oder interner Admin-Pfad. */
async function kontext(request: Request): Promise<Kontext | Response> {
  const auth = request.headers.get("authorization") || "";
  const admin = process.env.ADMIN_AUTOMATION_SECRET;
  if (admin && auth.startsWith("Bearer ") && gleichZeitkonstant(auth.slice(7).trim(), admin))
    return { organizationId: null, userId: null, intern: true };
  const team = await requireTeamRole(request, "admin");
  if (team instanceof Response) return team;
  return { organizationId: team.organizationId, userId: team.userId, intern: false };
}

/** Kunde laden und gegen die Organisation des Aufrufers pruefen. */
async function kundeImScope(ctx: Kontext, clientId: string) {
  const sb = supabaseAdmin as any;
  const { data: c } = await sb
    .from("clients")
    .select("id, organization_id, name")
    .eq("id", clientId)
    .maybeSingle();
  if (!c)
    return { error: Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 }) };
  if (!ctx.intern && String(c.organization_id) !== ctx.organizationId)
    return {
      error: Response.json(
        { ok: false, error: "Kunde gehört nicht zu deiner Organisation" },
        { status: 403 },
      ),
    };
  return { client: { id: String(c.id), organization_id: String(c.organization_id), name: c.name } };
}

const LOG_FELDER = "id, credential_id, method, path, query, status, dauer_ms, zeilen, created_at";

/** Org-weiter Kontext (read_api): nur Team-Login, nie der interne Pfad. */
function orgKontext(ctx: Kontext): { organizationId: string } | Response {
  if (ctx.intern || !ctx.organizationId)
    return Response.json(
      { ok: false, error: "Org-weite API-Tokens nur für eingeloggte Owner/Admin" },
      { status: 403 },
    );
  return { organizationId: ctx.organizationId };
}

const OEFFENTLICH =
  "id, client_id, purpose, token_prefix, label, created_at, expires_at, revoked_at, revoked_reason, rotated_from, last_used_at, use_count";
const OEFFENTLICH_FELDER = OEFFENTLICH.split(",").map((c) => c.trim());

/** RPC-Zeilen enthalten token_hash — nach aussen nur die oeffentlichen Felder. */
function oeffentlich(row: any) {
  if (!row) return null;
  const out: Record<string, unknown> = {};
  for (const k of OEFFENTLICH_FELDER) if (k in row) out[k] = row[k];
  return out;
}

/** Fehler der Lifecycle-RPCs (SQLSTATE P0002 = nicht gefunden, P0003 = Konflikt). */
function rpcFehler(error: any): Response {
  const code = String(error?.code || "");
  const status = code === "P0002" ? 404 : code === "P0003" ? 409 : 500;
  return Response.json({ ok: false, error: String(error?.message || "RPC-Fehler") }, { status });
}

function ablauf(days: number | undefined, def = 365): string {
  return new Date(Date.now() + (days ?? def) * 864e5).toISOString();
}

type BodyT = z.infer<typeof Body>;

/** Lifecycle org-weiter read_api-Tokens — immer an die aktive Organisation gebunden. */
async function orgWeit(b: BodyT, organizationId: string, userId: string | null) {
  const sb = supabaseAdmin as any;
  if (b.action === "create") {
    const t = generateIngestToken("read_api");
    const { data, error } = await sb.rpc("ingest_credential_create", {
      _organization_id: organizationId,
      _client_id: null,
      _purpose: "read_api",
      _token_hash: t.tokenHash,
      _token_prefix: t.tokenPrefix,
      _label: b.label ?? null,
      _expires_at: ablauf(b.expiresInDays),
      _created_by: userId,
    });
    if (error) return rpcFehler(error);
    // Klartext GENAU EINMAL — wird nirgends gespeichert oder geloggt.
    return Response.json({ ok: true, credential: oeffentlich(data), token: t.token });
  }

  // Bestehendes Token muss org-weit sein UND zu DIESER Organisation gehoeren.
  const { data: alt } = await sb
    .from("ingest_credentials")
    .select("id, client_id, organization_id, purpose, expires_at, revoked_at")
    .eq("id", b.credentialId)
    .eq("organization_id", organizationId)
    .eq("purpose", "read_api")
    .maybeSingle();
  if (!alt || alt.client_id != null)
    return Response.json({ ok: false, error: "Credential nicht gefunden" }, { status: 404 });

  if (b.action === "revoke") {
    const { data, error } = await sb.rpc("ingest_credential_revoke", {
      _credential_id: alt.id,
      _client_id: null,
      _reason: b.reason ?? null,
      _organization_id: organizationId,
    });
    if (error) return rpcFehler(error);
    return Response.json({ ok: true, revoked: alt.id, credential: oeffentlich(data) });
  }

  if (alt.revoked_at)
    return Response.json(
      { ok: false, error: "Widerrufenes Credential kann nicht rotiert werden" },
      { status: 409 },
    );
  const t = generateIngestToken("read_api");
  const { data: neu, error } = await sb.rpc("ingest_credential_rotate", {
    _credential_id: alt.id,
    _client_id: null,
    _token_hash: t.tokenHash,
    _token_prefix: t.tokenPrefix,
    _label: b.label ?? null,
    _expires_at: ablauf(b.expiresInDays),
    _grace_until: new Date(Date.now() + (b.graceDays ?? 7) * 864e5).toISOString(),
    _created_by: userId,
    _organization_id: organizationId,
  });
  if (error) return rpcFehler(error);
  return Response.json({
    ok: true,
    credential: oeffentlich(neu),
    token: t.token,
    rotatedFrom: alt.id,
  });
}

export const Route = createFileRoute("/api/admin/ingest-credentials")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const ctx = await kontext(request);
        if (ctx instanceof Response) return ctx;
        const url = new URL(request.url);
        const clientId = url.searchParams.get("clientId") || "";
        const purpose = url.searchParams.get("purpose") || "";
        const sb = supabaseAdmin as any;

        // Org-weite Read-API-Tokens + letzte 20 Aufrufe.
        if (purpose === "read_api" && !clientId) {
          const org = orgKontext(ctx);
          if (org instanceof Response) return org;
          const { data, error } = await sb
            .from("ingest_credentials")
            .select(OEFFENTLICH)
            .eq("organization_id", org.organizationId)
            .eq("purpose", "read_api")
            .order("created_at", { ascending: false });
          if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
          const { data: log } = await sb
            .from("read_api_log")
            .select(LOG_FELDER)
            .eq("organization_id", org.organizationId)
            .order("created_at", { ascending: false })
            .limit(20);
          return Response.json({ ok: true, credentials: data || [], log: log || [] });
        }

        if (!UUID.safeParse(clientId).success)
          return Response.json(
            { ok: false, error: "clientId (uuid) erforderlich" },
            { status: 400 },
          );
        const k = await kundeImScope(ctx, clientId);
        if ("error" in k) return k.error;
        let q = sb
          .from("ingest_credentials")
          .select(OEFFENTLICH)
          .eq("client_id", k.client.id)
          .order("created_at", { ascending: false });
        if (purpose && (KUNDEN_PURPOSES as readonly string[]).includes(purpose))
          q = q.eq("purpose", purpose);
        const { data, error } = await q;
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        return Response.json({ ok: true, credentials: data || [] });
      },

      POST: async ({ request }) => {
        const ctx = await kontext(request);
        if (ctx instanceof Response) return ctx;
        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Ungueltige Eingabe" }, { status: 400 });
        const b = parsed.data;
        const sb = supabaseAdmin as any;

        // Org-weite Variante: read_api-Create bzw. rotate/revoke ohne clientId.
        if (b.action === "create" ? b.purpose === "read_api" : !b.clientId) {
          if (b.clientId)
            return Response.json(
              { ok: false, error: "read_api-Tokens sind org-weit — keine clientId angeben" },
              { status: 400 },
            );
          const org = orgKontext(ctx);
          if (org instanceof Response) return org;
          return orgWeit(b, org.organizationId, ctx.userId);
        }
        if (!b.clientId)
          return Response.json(
            { ok: false, error: "clientId (uuid) erforderlich" },
            { status: 400 },
          );

        const k = await kundeImScope(ctx, b.clientId);
        if ("error" in k) return k.error;

        // Lifecycle (13.09.2026): transaktionale SECURITY-DEFINER-RPCs
        // (Migration 20260913210000) statt mehrerer REST-Schritte.
        if (b.action === "create") {
          const t = generateIngestToken(b.purpose);
          const { data, error } = await sb.rpc("ingest_credential_create", {
            _organization_id: k.client.organization_id,
            _client_id: k.client.id,
            _purpose: b.purpose,
            _token_hash: t.tokenHash,
            _token_prefix: t.tokenPrefix,
            _label: b.label ?? null,
            _expires_at: ablauf(b.expiresInDays),
            _created_by: ctx.userId,
          });
          if (error) return rpcFehler(error);
          // Klartext GENAU EINMAL — wird nirgends gespeichert oder geloggt.
          return Response.json({ ok: true, credential: oeffentlich(data), token: t.token });
        }

        // rotate / revoke: bestehendes Credential muss zu DIESEM Kunden gehoeren.
        const { data: alt } = await sb
          .from("ingest_credentials")
          .select("id, client_id, organization_id, purpose, expires_at, revoked_at")
          .eq("id", b.credentialId)
          .maybeSingle();
        if (!alt || String(alt.client_id) !== k.client.id)
          return Response.json({ ok: false, error: "Credential nicht gefunden" }, { status: 404 });

        if (b.action === "revoke") {
          const { data, error } = await sb.rpc("ingest_credential_revoke", {
            _credential_id: alt.id,
            _client_id: k.client.id,
            _reason: b.reason ?? null,
            _organization_id: k.client.organization_id,
          });
          if (error) return rpcFehler(error);
          return Response.json({ ok: true, revoked: alt.id, credential: oeffentlich(data) });
        }

        // rotate
        if (alt.revoked_at)
          return Response.json(
            { ok: false, error: "Widerrufenes Credential kann nicht rotiert werden" },
            { status: 409 },
          );
        // Atomar: neues Credential anlegen UND altes Ablaufdatum setzen (nie
        // verlaengern) in EINER Transaktion — kein Zwischenzustand mehr.
        const t = generateIngestToken(alt.purpose);
        const { data: neu, error } = await sb.rpc("ingest_credential_rotate", {
          _credential_id: alt.id,
          _client_id: k.client.id,
          _token_hash: t.tokenHash,
          _token_prefix: t.tokenPrefix,
          _label: b.label ?? null,
          _expires_at: ablauf(b.expiresInDays),
          _grace_until: new Date(Date.now() + (b.graceDays ?? 7) * 864e5).toISOString(),
          _created_by: ctx.userId,
          _organization_id: k.client.organization_id,
        });
        if (error) return rpcFehler(error);
        return Response.json({
          ok: true,
          credential: oeffentlich(neu),
          token: t.token,
          rotatedFrom: alt.id,
        });
      },
    },
  },
});
