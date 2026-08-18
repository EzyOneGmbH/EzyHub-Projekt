// Pure Logik fuer /api/claude-sessions (iPhone-Widget "Remote Claude Chats").
// Hier liegt alles, was ohne Netzwerk/Supabase testbar ist; die Route bleibt duenn.

export const DEFAULT_STALE_MINUTES = 10;
export const MAX_AGE_DAYS = 7;

export type ClaudeSessionRow = {
  session_id: string;
  label: string | null;
  source: string | null;
  status: string;
  started_at: string;
  last_seen_at: string;
};

export type ClaudeSessionView = ClaudeSessionRow & {
  connected: boolean;
  minutes_since_seen: number;
};

/**
 * Prueft den Bearer-Token aus dem Authorization-Header gegen den konfigurierten
 * Widget-Token. Ohne konfigurierten Token ist die Route deaktiviert (=> false).
 */
export function isAuthorized(
  authHeader: string | null,
  expectedToken: string | undefined,
): boolean {
  if (!expectedToken || expectedToken.length < 16) return false;
  if (!authHeader) return false;
  const match = /^bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!match) return false;
  return match[1] === expectedToken;
}

/**
 * Reichert Session-Zeilen um `connected` (Heartbeat juenger als staleMinutes und
 * nicht explizit beendet) und `minutes_since_seen` an; verbundene zuerst,
 * innerhalb der Gruppen die zuletzt gesehenen oben.
 */
export function withConnected(
  rows: ClaudeSessionRow[],
  nowMs: number,
  staleMinutes: number = DEFAULT_STALE_MINUTES,
): ClaudeSessionView[] {
  const views = rows.map((row) => {
    const seenMs = Date.parse(row.last_seen_at);
    const minutes = Number.isFinite(seenMs) ? Math.max(0, (nowMs - seenMs) / 60_000) : Infinity;
    return {
      ...row,
      connected: row.status === "active" && minutes <= staleMinutes,
      minutes_since_seen: Number.isFinite(minutes) ? Math.round(minutes) : -1,
    };
  });
  return views.sort((a, b) => {
    if (a.connected !== b.connected) return a.connected ? -1 : 1;
    return Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at);
  });
}

/** Query-Parameter `stale_minutes` robust parsen (1..120, sonst Default). */
export function parseStaleMinutes(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 120) return DEFAULT_STALE_MINUTES;
  return Math.round(n);
}
