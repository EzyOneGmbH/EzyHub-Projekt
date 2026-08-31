// DataStatus (EzyRank-Ausbau 2026-08-18): wiederverwendbare Datenstatus-Leiste
// fuer Dashboard-Bereiche (SEO, Blog, Local Grid, Conversions). Zeigt je
// Datenquelle den Zeitpunkt der letzten erfolgreichen Aktualisierung, einen
// ehrlichen Status (aktuell/veraltet/keine Daten/nicht verbunden/Fehler) und
// KLAR GETRENNTE Aktionen: "Daten neu laden" (liest nur den Datenbankstand)
// vs. "Neue Messung starten" (externer Datenlauf, useMeasurement).
// GRUNDSATZ: Niemals Werte erfinden — ohne Zeitstempel wird "keine Daten"
// gezeigt, nie ein Platzhalter-Datum. Pure Helfer leben testbar in
// data/dataStatus.ts und werden hier fuer bestehende Importe re-exportiert.
import { fmtStand, stateFromDate, runStatusItem } from "@/ezy/data/dataStatus";
import { useAuth } from "@/hooks/use-auth";

export { fmtStand, stateFromDate, runStatusItem };

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
  running: { color: C.orange, label: "Messung läuft …" },
  error: { color: C.red, label: "Fehler" },
};

function ActionButton({ action }) {
  const primary = action.kind === "measure";
  return (
    <button
      onClick={action.onClick}
      disabled={action.disabled || action.busy}
      title={
        action.title ||
        (primary
          ? "Startet tatsächlich einen externen Datenlauf"
          : "Liest nur den gespeicherten Datenbankstand neu")
      }
      style={{
        background: primary ? C.accent : "none",
        border: `1px solid ${primary ? C.accent : C.border}`,
        borderRadius: 8,
        padding: "3px 10px",
        cursor: action.disabled || action.busy ? "default" : "pointer",
        color: primary ? "#fff" : C.accent,
        fontSize: 11.5,
        fontWeight: 600,
        fontFamily: "inherit",
        whiteSpace: "nowrap",
        opacity: action.disabled || action.busy ? 0.6 : 1,
      }}
    >
      {action.busy ? "läuft …" : action.label}
    </button>
  );
}

/**
 * Datenstatus-Leiste.
 * items: [{ source, lastAt?, staleDays?, state?, detail?, error? }]
 * actions: [{ label, onClick, kind?: "reload"|"measure", disabled?, busy?, title? }]
 *   — Label-Konvention: "Daten neu laden" fuer DB-Reads, "Neue Messung starten"
 *     fuer echte externe Laeufe. NIE das mehrdeutige "Aktualisieren".
 * action: (Alt-API) einzelne Aktion — wird wie actions[0] behandelt.
 * hint: Freitext rechts (z. B. wo verbunden wird), wenn keine Aktion moeglich ist.
 */
export default function DataStatus({ items = [], actions, action, hint, style }) {
  // Kundenansicht (31.08., Volkan): technische Quellen-Zusätze in Klammern
  // («(DataForSEO)», «(GSC)», «(PageSpeed)», «(GA4)») sind für Kunden-Logins
  // Rauschen — sie sehen nur den Klarnamen; intern bleiben die Quellen stehen.
  const { role } = useAuth();
  const anzeigeName = (q) => (role === "viewer" ? String(q).replace(/\s*\([^)]*\)\s*$/, "") : q);
  const shown = items.filter((it) => it && it.source);
  const acts = (actions && actions.length ? actions : action ? [action] : []).filter(Boolean);
  if (!shown.length && !hint) return null;
  const errors = shown.filter((it) => it.error);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "8px 12px",
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        fontSize: 11.5,
        color: C.textMuted,
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "6px 14px", flexWrap: "wrap" }}>
        {shown.map((it) => {
          const state = it.state || stateFromDate(it.lastAt, it.staleDays);
          const meta = STATES[state] || STATES.none;
          const stand = fmtStand(it.lastAt);
          return (
            <span
              key={it.source}
              title={`${anzeigeName(it.source)} — ${meta.label}${stand ? ` · letzter erfolgreicher Stand ${stand}` : ""}${it.detail ? ` · ${it.detail}` : ""}`}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: meta.color,
                  display: "inline-block",
                  flexShrink: 0,
                }}
              />
              <span style={{ color: C.text, fontWeight: 600 }}>{anzeigeName(it.source)}</span>
              {stand ? <span>{stand}</span> : null}
              <span style={{ color: meta.color, fontWeight: 600 }}>{meta.label}</span>
              {it.detail ? <span style={{ color: C.textDim }}>({it.detail})</span> : null}
            </span>
          );
        })}
        <span style={{ flex: 1 }} />
        {hint ? <span style={{ color: C.textDim }}>{hint}</span> : null}
        {acts.map((a) => (
          <ActionButton key={a.label} action={a} />
        ))}
      </div>
      {errors.map((it) => (
        <div key={`${it.source}-err`} style={{ color: C.red, fontSize: 11.5 }}>
          {anzeigeName(it.source)}: {it.error}
        </div>
      ))}
    </div>
  );
}
