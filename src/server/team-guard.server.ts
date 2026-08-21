// Gemeinsamer Team-Guard (Security-Hardening 18.08.2026, Runde 2 21.08.2026):
// Organisation und Rolle werden SERVERSEITIG aus app_users ermittelt — nie aus
// dem Request. Mehrfach-Mitgliedschaften (UNIQUE(organization_id, user_id)
// erlaubt mehrere Orgs pro User) werden explizit behandelt: die aktive
// Organisation kommt aus X-Ezy-Active-Org bzw. ?activeOrg, wird aber IMMER
// gegen die tatsaechlichen Mitgliedschaften validiert — der Client kann nur
// unter seinen eigenen Organisationen waehlen, nie eine fremde.
// Genutzt von den Agent-Proxy-Routen (/api/agent/agents, /api/agent/approvals)
// und via aktiveMitgliedschaft() vom EzyPilot-Scope.
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const RANG: Record<string, number> = { owner: 3, admin: 2, member: 1, viewer: 0 };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pure Rollenpruefung (vitest-getestet): viewer kommt NIE durch. */
export function rolleErlaubt(role: string | null | undefined, min: "member" | "admin"): boolean {
  return (RANG[String(role || "")] ?? 0) >= (min === "admin" ? 2 : 1);
}

export type Mitgliedschaft = { organizationId: string; role: string };

/**
 * Pure Auswahl-Logik (vitest-getestet): ermittelt aus ALLEN Mitgliedschaften
 * eines Users die aktive. Regeln:
 *  - keine Mitgliedschaft -> Fehler "keine"
 *  - gewuenschte Org angegeben -> muss exakt einer Mitgliedschaft entsprechen
 *    (formvalidierte UUID), sonst Fehler "fremd" — Slugs/Namen zaehlen nicht.
 *  - keine Wunsch-Org: genau 1 Mitgliedschaft -> diese; mehrere -> Fehler
 *    "mehrdeutig" (Client MUSS die aktive Org benennen; es wird NIE einfach
 *    der erste Eintrag genommen).
 */
export function waehleMitgliedschaft(
  alle: Mitgliedschaft[],
  gewuenscht: string | null | undefined,
): { ok: true; aktiv: Mitgliedschaft } | { ok: false; grund: "keine" | "fremd" | "mehrdeutig" } {
  if (!alle.length) return { ok: false, grund: "keine" };
  const wunsch = String(gewuenscht || "").trim();
  if (wunsch) {
    if (!UUID_RE.test(wunsch)) return { ok: false, grund: "fremd" };
    const hit = alle.find((m) => m.organizationId === wunsch);
    return hit ? { ok: true, aktiv: hit } : { ok: false, grund: "fremd" };
  }
  if (alle.length === 1) return { ok: true, aktiv: alle[0] };
  return { ok: false, grund: "mehrdeutig" };
}

/** Alle Mitgliedschaften eines Users (Service-Role, RLS-unabhaengig). */
export async function mitgliedschaften(userId: string): Promise<Mitgliedschaft[]> {
  const { data } = await (supabaseAdmin as any)
    .from("app_users")
    .select("role, organization_id")
    .eq("user_id", userId);
  return (data || [])
    .filter((m: any) => m?.organization_id)
    .map((m: any) => ({
      organizationId: String(m.organization_id),
      role: String(m.role || "viewer"),
    }));
}

/**
 * Aktive Mitgliedschaft eines Users (fuer Aufrufer ohne komplettes Request-
 * Handling, z.B. EzyPilot-Scope): validiert eine optionale Wunsch-Org gegen
 * die echten Mitgliedschaften. Gibt null zurueck, wenn keine eindeutige,
 * berechtigte Organisation bestimmbar ist (fail-closed).
 */
export async function aktiveMitgliedschaft(
  userId: string,
  gewuenscht?: string | null,
): Promise<Mitgliedschaft | null> {
  const wahl = waehleMitgliedschaft(await mitgliedschaften(userId), gewuenscht);
  return wahl.ok ? wahl.aktiv : null;
}

export type TeamKontext = { userId: string; organizationId: string; role: string };

export async function requireTeamRole(
  request: Request,
  min: "member" | "admin",
): Promise<TeamKontext | Response> {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anon)
    return Response.json({ ok: false, error: "Server not configured" }, { status: 503 });
  const sb = createClient(url, anon, {
    global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
  });
  const { data } = await sb.auth.getUser();
  if (!data.user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  // Aktive Organisation: Header vor Query — beides nur ein WUNSCH, der gegen
  // die tatsaechlichen Mitgliedschaften validiert wird.
  const gewuenscht =
    request.headers.get("x-ezy-active-org") ||
    new URL(request.url).searchParams.get("activeOrg") ||
    "";
  const wahl = waehleMitgliedschaft(await mitgliedschaften(data.user.id), gewuenscht);
  if (!wahl.ok) {
    if (wahl.grund === "mehrdeutig")
      return Response.json(
        {
          ok: false,
          error: "Mehrere Organisationen: aktive Organisation angeben (Header X-Ezy-Active-Org).",
        },
        { status: 409 },
      );
    return Response.json(
      {
        ok: false,
        error:
          wahl.grund === "fremd"
            ? "Keine Mitgliedschaft in dieser Organisation"
            : "Kein Team-Zugriff",
      },
      { status: 403 },
    );
  }
  const { organizationId, role } = wahl.aktiv;
  if (!rolleErlaubt(role, min))
    return Response.json(
      { ok: false, error: min === "admin" ? "Nur Owner/Admin" : "Kein Team-Zugriff" },
      { status: 403 },
    );
  return { userId: data.user.id, organizationId, role };
}
