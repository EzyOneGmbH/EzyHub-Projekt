// Kunden-Zugriff (14.09.2026): reine Helfer für den Admin-Tab «Kunden-Zugriff».
// Kunden-Accounts = Rolle viewer (Kundenportal); Mitarbeiter/Admins bleiben im Team.

export type TeamUser = {
  userId: string;
  role: string;
  email?: string | null;
  self?: boolean;
  clientIds?: string[];
};

export type KundeMinimal = { id: string; name: string; domain?: string };

/** Nur Kunden-Logins (Portal) — Mitarbeiter/Admins bleiben im Team. */
export function nurKundenAccounts(users?: TeamUser[] | null): TeamUser[] {
  return (users || []).filter((u) => !!u && u.role === "viewer");
}

/** Gegenstück für die Team-Seite: alles ausser Kunden-Accounts. */
export function nurTeam(users?: TeamUser[] | null): TeamUser[] {
  return (users || []).filter((u) => !!u && u.role !== "viewer");
}

/** Kundenfähige Apps: Analyse (internalOnly) und Admin (adminOnly) sind nie Portal-Apps. */
export function kundenfaehigeApps<T extends { adminOnly?: boolean; internalOnly?: boolean }>(
  apps: T[],
): T[] {
  return apps.filter((a) => !a.adminOnly && !a.internalOnly);
}

/**
 * Welche Apps ein Kunde (und damit alle seine Portal-Logins) effektiv sieht —
 * client_app_access-Semantik: keine Zeile = App aktiv (Legacy-Default).
 */
export function sichtbareAppsFuerKunde<T extends { id: string }>(
  clientId: string,
  apps: T[],
  map: Map<string, Map<string, { enabled: boolean }>> | null | undefined,
): Array<T & { enabled: boolean }> {
  const je = map?.get(clientId);
  return apps.map((a) => ({ ...a, enabled: je?.get(a.id)?.enabled ?? true }));
}

/** Apps, die ein Kunden-Login im Portal-App-Switcher sehen kann (Rail-Apps). */
export const PORTAL_RAIL_APPS = ["seo", "geo", "ads"] as const;
export type PortalRailApp = (typeof PORTAL_RAIL_APPS)[number];

/**
 * App-Switcher für Kunden-Logins (14.09.): welche Apps darf ein viewer öffnen?
 * Vereinigung über alle seine Kunden (client_app_access, keine Zeile = aktiv),
 * eingeschränkt auf die Rail-Apps. Kein Kunde → keine App.
 */
export function portalAppsFuerKunden(
  clientIds: string[] | null | undefined,
  map: Map<string, Map<string, { enabled: boolean }>> | null | undefined,
): PortalRailApp[] {
  const ids = clientIds || [];
  return PORTAL_RAIL_APPS.filter((app) =>
    ids.some((cid) => map?.get(cid)?.get(app)?.enabled ?? true),
  );
}

/** Deep-Link ins Kunden-Detail → App-Zugriff (ClientsPage liest client + tab). */
export function kundenDetailLink(clientId: string, tab = "access"): string {
  return `/admin?app=admin&client=${encodeURIComponent(clientId)}&tab=${encodeURIComponent(tab)}`;
}

/** Kunden-Namen zu den zugewiesenen client_ids (unbekannte Ids bleiben sichtbar). */
export function zugewieseneKunden(
  clientIds: string[] | undefined | null,
  clients: KundeMinimal[] | undefined | null,
): KundeMinimal[] {
  const byId = new Map((clients || []).map((c) => [c.id, c] as const));
  return (clientIds || []).map(
    (id) => byId.get(id) || { id, name: `Unbekannt (${id.slice(0, 8)})` },
  );
}
