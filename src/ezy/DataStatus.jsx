// DataStatus (EzyRank-Ausbau 2026-08-18): wiederverwendbare Datenstatus-Leiste
// fuer Dashboard-Bereiche (SEO, Blog, Local Grid, Conversions). Zeigt je
// Datenquelle den Zeitpunkt der letzten erfolgreichen Aktualisierung und einen
// ehrlichen Status (aktuell/veraltet/keine Daten/nicht verbunden/Fehler) plus
// eine passende Aktion. Bewusst eigene Datei (nicht EzyOneApp.jsx): kleinerer
// Diff im Monolithen, wiederverwendbar in LocalGridDashboard.jsx.
// GRUNDSATZ: Niemals Werte erfinden — ohne Zeitstempel wird "keine Daten"
// gezeigt, nie ein Platzhalter-Datum.

// Ezy One CD (Light Studio) — Teilmenge der EzyOneApp-Palette, Werte identisch.
const C = {
  card: "#ffffff",
  border: "#eae4ee",
  text: "#161217",
  textMuted: "#6d6473",
  textDim: "#a49dab",
  accent: "#77008C",
  green: "#0f9d6c",
  red: "#dc2626",
  orange: "#d97706",
};

const STATES = {
  live: { color: C.green, label: "live" },
  ok: { color: C.green, label: "aktuell" },
  connected: { color: C.green, label: "verbunden" },
  present: { color: C.green, label: "vorhanden" },
  stale: { color: C.orange, label: "veraltet" },
  none: { color: C.textDim, label: "keine Daten" },
  disconnected: { color: C.textDim, label: "nicht verbunden" },
  error: { color: C.red, label: "Fehler" },
};

/** "17.08.2026" bzw. "17.08.2026, 14:32" — je nachdem, ob eine Uhrzeit vorliegt. */
export function fmtStand(lastAt) {
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
export function stateFromDate(lastAt, staleDays = 8) {
  if (!lastAt) return "none";
  const d = new Date(String(lastAt));
  if (Number.isNaN(d.getTime())) return "none";
  return Date.now() - d.getTime() <= staleDays * 24 * 60 * 60 * 1000 ? "ok" : "stale";
}

/** Item-Helfer fuer eine audit_runs-Zeile aus useEzyLatestRun. */
export function runStatusItem(source, run, { staleDays = 8, detail } = {}) {
  return { source, lastAt: run?.created_at || null, staleDays, detail };
}

/**
 * Datenstatus-Leiste. items: [{ source, lastAt?, staleDays?, state?, detail? }]
 * action: { label, onClick } — z. B. "Aktualisieren" oder "Google verbinden".
 * hint: Freitext rechts (z. B. wo verbunden wird), wenn keine Aktion moeglich ist.
 */
export default function DataStatus({ items = [], action, hint, style }) {
  const shown = items.filter((it) => it && it.source);
  if (!shown.length && !hint) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px 14px",
        flexWrap: "wrap",
        padding: "8px 12px",
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        fontSize: 11.5,
        color: C.textMuted,
        ...style,
      }}
    >
      {shown.map((it) => {
        const state = it.state || stateFromDate(it.lastAt, it.staleDays);
        const meta = STATES[state] || STATES.none;
        const stand = fmtStand(it.lastAt);
        return (
          <span
            key={it.source}
            title={`${it.source} — ${meta.label}${stand ? ` · Stand ${stand}` : ""}${it.detail ? ` · ${it.detail}` : ""}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: meta.color, display: "inline-block", flexShrink: 0 }} />
            <span style={{ color: C.text, fontWeight: 600 }}>{it.source}</span>
            {stand ? <span>{stand}</span> : null}
            <span style={{ color: meta.color, fontWeight: 600 }}>{meta.label}</span>
            {it.detail ? <span style={{ color: C.textDim }}>({it.detail})</span> : null}
          </span>
        );
      })}
      <span style={{ flex: 1 }} />
      {hint ? <span style={{ color: C.textDim }}>{hint}</span> : null}
      {action ? (
        <button
          onClick={action.onClick}
          style={{
            background: "none",
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            padding: "3px 10px",
            cursor: "pointer",
            color: C.accent,
            fontSize: 11.5,
            fontWeight: 600,
            fontFamily: "inherit",
            whiteSpace: "nowrap",
          }}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
