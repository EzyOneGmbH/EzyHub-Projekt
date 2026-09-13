// Aktive Organisation bei Mehrfach-Mitgliedschaften (13.09.2026).
//
// Ein Nutzer kann in mehreren Organisationen Mitglied sein (app_users hat
// UNIQUE(organization_id, user_id)). Die aktive Organisation ist eine
// EXPLIZITE Wahl: gespeichert im Browser (localStorage), bei jedem Login
// gegen die frischen Mitgliedschaften validiert — eine gespeicherte Org, in
// der der Nutzer nicht (mehr) Mitglied ist, zaehlt nicht. Bei genau einer
// Mitgliedschaft ist die Wahl implizit; bei mehreren ohne gueltige Wahl muss
// der Nutzer waehlen (auswahlNoetig). Es wird NIE "einfach die erste" oder
// die hoechste Rolle ueber alle Orgs genommen.
//
// Serverseitig gilt dieselbe Regel (team-guard waehleMitgliedschaft); der
// Browser sendet die Wahl als Header X-Ezy-Active-Org (siehe authedFetch).

export type OrgRole = "owner" | "admin" | "member" | "viewer";
export type Mitgliedschaft = { organizationId: string; role: OrgRole };

export const ACTIVE_ORG_KEY = "ezy.activeOrg.v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AktiveOrgWahl = {
  organizationId: string | null;
  role: OrgRole | null;
  /** mehrere Mitgliedschaften, aber keine gueltige gespeicherte Wahl */
  auswahlNoetig: boolean;
};

/** Reine Auswahl-Logik (vitest-getestet). */
export function waehleAktiveOrg(
  mitgliedschaften: Mitgliedschaft[],
  gespeichert: string | null | undefined,
): AktiveOrgWahl {
  if (!mitgliedschaften.length) return { organizationId: null, role: null, auswahlNoetig: false };
  const wunsch = String(gespeichert || "").trim();
  if (wunsch && UUID_RE.test(wunsch)) {
    const hit = mitgliedschaften.find((m) => m.organizationId === wunsch);
    if (hit) return { organizationId: hit.organizationId, role: hit.role, auswahlNoetig: false };
  }
  if (mitgliedschaften.length === 1) {
    const m = mitgliedschaften[0];
    return { organizationId: m.organizationId, role: m.role, auswahlNoetig: false };
  }
  return { organizationId: null, role: null, auswahlNoetig: true };
}

export function leseAktiveOrg(): string | null {
  try {
    const v = localStorage.getItem(ACTIVE_ORG_KEY);
    return v && UUID_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function speichereAktiveOrg(id: string | null): void {
  try {
    if (id && UUID_RE.test(id)) localStorage.setItem(ACTIVE_ORG_KEY, id);
    else localStorage.removeItem(ACTIVE_ORG_KEY);
  } catch {
    /* kein Storage (Preview/Privatmodus) */
  }
}
