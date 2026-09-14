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
