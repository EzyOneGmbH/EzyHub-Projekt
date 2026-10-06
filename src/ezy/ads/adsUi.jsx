// Gemeinsame Bausteine der EzyPerformance-Uebersicht (06.10.2026).
import { C } from "../theme";
import { deltaTon } from "./adsReportModel";

export const chf = (v, dec = 0) =>
  `CHF ${Number(v || 0).toLocaleString("de-CH", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  })}`;
/** Ganze Zahl; kleine Werte mit einer Nachkommastelle (Google zaehlt Bruchteile). */
export const zahl = (v) => {
  const x = Number(v || 0);
  return Math.abs(x) < 100 && Math.round(x) !== x
    ? x.toLocaleString("de-CH", { maximumFractionDigits: 1 })
    : Math.round(x).toLocaleString("de-CH");
};
export const prozent = (v, dec = 1) =>
  v == null ? "–" : `${Number(v).toFixed(dec).replace(".", ",")} %`;
export const faktor = (v, dec = 2) =>
  v == null ? "–" : `${Number(v).toFixed(dec).replace(".", ",")}×`;

export function Karte({ children, style, ...rest }) {
  return (
    <div
      {...rest}
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 18,
        boxShadow: C.cardShadow,
        padding: "clamp(16px, 2.6vw, 26px)",
        minWidth: 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Abschnitt({ titel, hinweis, rechts, gross = false, style }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
        marginBottom: 14,
        ...style,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h2
          style={{
            margin: 0,
            fontSize: gross ? 22 : 18,
            fontWeight: 800,
            color: C.darkPurple,
            letterSpacing: "-.01em",
            display: "inline",
          }}
        >
          {titel}
        </h2>
        {hinweis && (
          <span style={{ fontSize: 12.5, color: C.textMuted, marginLeft: 10 }}>{hinweis}</span>
        )}
      </div>
      {rechts}
    </div>
  );
}

/** Veraenderungs-Chip: ↗ +15 % (gruen = besser, rot = schlechter, grau = neutral). */
export function DeltaChip({ d, richtung = "up", neu = false, klein = false }) {
  if (neu)
    return (
      <span style={chipStil(C.blue, C.blueDim, klein)} title="In der Vorperiode nicht vorhanden">
        neu
      </span>
    );
  if (d == null) return <span style={{ fontSize: 11, color: C.textFaint }}>–</span>;
  const ton = deltaTon(d, richtung);
  const [fg, bg] =
    ton === "gut"
      ? [C.green, C.greenDim]
      : ton === "schlecht"
        ? [C.red, C.redDim]
        : [C.textMuted, C.segBg];
  const pfeil = d > 0 ? "↗" : d < 0 ? "↘" : "±";
  const wert =
    d === 0 ? "0 %" : `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1).replace(".", ",")} %`;
  return (
    <span style={chipStil(fg, bg, klein)}>
      {pfeil} {wert}
    </span>
  );
}
const chipStil = (fg, bg, klein) => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  fontSize: klein ? 11 : 12,
  fontWeight: 700,
  color: fg,
  background: bg,
  borderRadius: 999,
  padding: klein ? "2px 8px" : "3px 10px",
  whiteSpace: "nowrap",
  fontVariantNumeric: "tabular-nums",
});

/** Pille, z. B. ROAS-Kaestchen (gruen ab 5×) oder Art-Badge. */
export function Pille({ children, farbe = C.textMuted, hinter = C.segBg, title }) {
  return (
    <span
      title={title}
      style={{
        display: "inline-block",
        fontSize: 12,
        fontWeight: 700,
        color: farbe,
        background: hinter,
        borderRadius: 8,
        padding: "3px 9px",
        whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {children}
    </span>
  );
}

/** Segment-Umschalter im Stil des Mockups (Alle | Hauptziele | Soft Conversions). */
export function Segmente({ werte, aktiv, onChange, dunkel = false }) {
  return (
    <div
      role="tablist"
      style={{
        display: "inline-flex",
        flexWrap: "wrap",
        gap: 2,
        background: dunkel ? "#fff" : C.segBg,
        borderRadius: 999,
        padding: 4,
        boxShadow: dunkel ? C.segShadow : "none",
      }}
    >
      {werte.map(([id, label]) => {
        const an = aktiv === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={an}
            onClick={() => onChange(id)}
            style={{
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: an ? 700 : 500,
              padding: "7px 16px",
              borderRadius: 999,
              color: an ? (dunkel ? "#fff" : C.accent) : C.textMuted,
              background: an ? (dunkel ? C.accent : "#fff") : "transparent",
              boxShadow: an && !dunkel ? C.segShadow : "none",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Scrollbarer Tabellen-Rahmen (mobil horizontal scrollbar). */
export function TabellenRahmen({ children, minWidth = 640 }) {
  return (
    <div style={{ overflowX: "auto", margin: "0 calc(-1 * clamp(16px, 2.6vw, 26px))" }}>
      <table
        style={{
          width: "100%",
          minWidth,
          borderCollapse: "collapse",
          fontSize: 13.5,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {children}
      </table>
    </div>
  );
}

export const th = (rechts = true, extra = {}) => ({
  padding: "12px clamp(12px, 2vw, 22px)",
  textAlign: rechts ? "right" : "left",
  fontSize: 12.5,
  fontWeight: 600,
  color: C.textMuted,
  background: "#faf7fb",
  borderTop: `1px solid ${C.border}`,
  borderBottom: `1px solid ${C.border}`,
  whiteSpace: "nowrap",
  ...extra,
});
export const td = (rechts = true, extra = {}) => ({
  padding: "13px clamp(12px, 2vw, 22px)",
  textAlign: rechts ? "right" : "left",
  whiteSpace: rechts ? "nowrap" : undefined,
  borderBottom: `1px solid ${C.hairline}`,
  color: C.text,
  verticalAlign: "middle",
  ...extra,
});
