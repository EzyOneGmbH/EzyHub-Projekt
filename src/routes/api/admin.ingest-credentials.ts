import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireTeamRole } from "@/server/team-guard.server";
import {
  INGEST_PURPOSES,
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

const UUID = z.string().uuid();
const Body = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      clientId: UUID,
      purpose: z.enum(INGEST_PURPOSES),
      label: z.string().max(80).optional(),
      expiresInDays: z.number().int().min(1).max(730).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("rotate"),
      clientId: UUID,
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
      clientId: UUID,
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

const OEFFENTLICH =
  "id, client_id, purpose, token_prefix, label, created_at, expires_at, revoked_at, revoked_reason, rotated_from, last_used_at, use_count";

function ablauf(days: number | undefined, def = 365): string {
  return new Date(Date.now() + (days ?? def) * 864e5).toISOString();
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
        if (!UUID.safeParse(clientId).success)
          return Response.json(
            { ok: false, error: "clientId (uuid) erforderlich" },
            { status: 400 },
          );
        const k = await kundeImScope(ctx, clientId);
        if ("error" in k) return k.error;
        const sb = supabaseAdmin as any;
        let q = sb
          .from("ingest_credentials")
          .select(OEFFENTLICH)
          .eq("client_id", k.client.id)
          .order("created_at", { ascending: false });
        if (purpose && (INGEST_PURPOSES as readonly string[]).includes(purpose))
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
        const k = await kundeImScope(ctx, b.clientId);
        if ("error" in k) return k.error;
        const sb = supabaseAdmin as any;
        const nowIso = new Date().toISOString();

        if (b.action === "create") {
          const t = generateIngestToken(b.purpose);
          const { data, error } = await sb
            .from("ingest_credentials")
            .insert({
              organization_id: k.client.organization_id,
              client_id: k.client.id,
              purpose: b.purpose,
              token_hash: t.tokenHash,
              token_prefix: t.tokenPrefix,
              label: b.label ?? null,
              created_by: ctx.userId,
              expires_at: ablauf(b.expiresInDays),
            })
            .select(OEFFENTLICH)
            .maybeSingle();
          if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
          // Klartext GENAU EINMAL — wird nirgends gespeichert oder geloggt.
          return Response.json({ ok: true, credential: data, token: t.token });
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
          if (!alt.revoked_at) {
            const { error } = await sb
              .from("ingest_credentials")
              .update({ revoked_at: nowIso, revoked_reason: b.reason ?? null })
              .eq("id", alt.id);
            if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
          }
          return Response.json({ ok: true, revoked: alt.id });
        }

        // rotate
        if (alt.revoked_at)
          return Response.json(
            { ok: false, error: "Widerrufenes Credential kann nicht rotiert werden" },
            { status: 409 },
          );
        const t = generateIngestToken(alt.purpose);
        const { data: neu, error: e1 } = await sb
          .from("ingest_credentials")
          .insert({
            organization_id: k.client.organization_id,
            client_id: k.client.id,
            purpose: alt.purpose,
            token_hash: t.tokenHash,
            token_prefix: t.tokenPrefix,
            label: b.label ?? null,
            created_by: ctx.userId,
            expires_at: ablauf(b.expiresInDays),
            rotated_from: alt.id,
          })
          .select(OEFFENTLICH)
          .maybeSingle();
        if (e1) return Response.json({ ok: false, error: e1.message }, { status: 500 });
        // Altes Token laeuft nach der Ueberlappung aus (nie verlaengern).
        const grace = new Date(Date.now() + (b.graceDays ?? 7) * 864e5).getTime();
        const bisher = alt.expires_at ? new Date(alt.expires_at).getTime() : Infinity;
        const { error: e2 } = await sb
          .from("ingest_credentials")
          .update({ expires_at: new Date(Math.min(grace, bisher)).toISOString() })
          .eq("id", alt.id);
        if (e2) return Response.json({ ok: false, error: e2.message }, { status: 500 });
        return Response.json({ ok: true, credential: neu, token: t.token, rotatedFrom: alt.id });
      },
    },
  },
});
