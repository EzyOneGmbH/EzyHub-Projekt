// Pausierte Kunden (2026-08-27, Volkan: «deaktivieren statt löschen»): der
// Admin-Kunden-Editor setzt Status "paused" in clients.metadata — das ist die
// REVERSIBLE Deaktivierung. Alle Sammel-Läufe (Messungen, Crons, Listen für
// agent-service-Ticks) überspringen pausierte Kunden; direkte Einzelkunden-
// Aufrufe (client:"Name"/UUID) bleiben bewusst möglich (Debug, Reaktivierungs-
// Nachmessung). Historische Daten bleiben vollständig erhalten.
export const istKundePausiert = (row: unknown): boolean =>
  (((row as any)?.metadata ?? {}) as any)?.status === "paused";

export const ohnePausierte = <T>(rows: T[] | null | undefined): T[] =>
  (rows ?? []).filter((r) => !istKundePausiert(r));
