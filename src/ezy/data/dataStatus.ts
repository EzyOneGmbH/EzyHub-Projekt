// Pure Datenstatus-Helfer (EzyRank-Architektur 2026-08-18): aus DataStatus.jsx
// extrahiert, damit sie ohne React testbar sind (dataStatus.test.ts).
// GRUNDSATZ: Niemals Werte erfinden — ohne Zeitstempel ist der Zustand "none".

export type DataStatusState =
  | "live" // Live-Abfrage im gewählten Zeitraum
  | "ok" // Snapshot vorhanden und frisch
  | "stale" // Snapshot vorhanden, aber älter als staleDays
  | "none" // keine Daten
  | "disconnected" // Integration nicht verbunden
  | "connected" // Verbindung ok (ohne Freshness-Aussage)
  | "present" // Daten vorhanden, aber ohne Zeitstempel
  | "running" // externe Messung läuft gerade
  | "error"; // letzter Lauf fehlgeschlagen

export type DataStatusItem = {
  source: string;
  lastAt?: string | null;
  staleDays?: number;
  state?: DataStatusState;
  detail?: string;
  /** Fehlermeldung des letzten Laufs — wird rot unter der Leiste gezeigt. */
  error?: string | null;
};

/** "17.08.2026" bzw. "17.08.2026, 14:32" — je nachdem, ob eine Uhrzeit vorliegt. */
export function fmtStand(lastAt?: string | null): string | null {
  if (!lastAt) return null;
  const s = String(lastAt);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
  const date = d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
  if (dateOnly) return date;
  return `${date}, ${d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}`;
}

/** Status rein aus dem Zeitstempel: ok (< staleDays), stale, none. */
export function stateFromDate(lastAt?: string | null, staleDays = 8): DataStatusState {
  if (!lastAt) return "none";
  const d = new Date(String(lastAt));
  if (Number.isNaN(d.getTime())) return "none";
  return Date.now() - d.getTime() <= staleDays * 24 * 60 * 60 * 1000 ? "ok" : "stale";
}

/** Item-Helfer für eine audit_runs-Zeile aus useEzyLatestRun. */
export function runStatusItem(
  source: string,
  run: { created_at?: string } | null | undefined,
  { staleDays = 8, detail }: { staleDays?: number; detail?: string } = {},
): DataStatusItem {
  return { source, lastAt: run?.created_at || null, staleDays, detail };
}
