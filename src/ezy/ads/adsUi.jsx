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
        borderRadius: C.rCard,
        boxShadow: C.cardShadow,
        padding: "18px 20px",
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
            fontSize: gross ? 14 : 13,
            fontWeight: 600,
            color: C.text,
            display: "inline",
          }}
        >
          {titel}
        </h2>
        {hinweis && (
          <span style={{ fontSize: 11.5, color: C.textMuted, marginLeft: 8 }}>{hinweis}</span>
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
        fontSize: 11.5,
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
              fontSize: 12.5,
              fontWeight: an ? 700 : 600,
              padding: "6px 14px",
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
    <div style={{ overflowX: "auto", margin: "0 -20px" }}>
      <table
        style={{
          width: "100%",
          minWidth,
          borderCollapse: "collapse",
          fontSize: 13,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {children}
      </table>
    </div>
  );
}

export const th = (rechts = true, extra = {}) => ({
  padding: "10px 12px",
  textAlign: rechts ? "right" : "left",
  fontSize: 11,
  fontWeight: 600,
  color: C.textDim,
  textTransform: "uppercase",
  letterSpacing: ".06em",
  borderBottom: `1px solid ${C.border}`,
  whiteSpace: "nowrap",
  ...extra,
});
export const td = (rechts = true, extra = {}) => ({
  padding: "11px 12px",
  textAlign: rechts ? "right" : "left",
  whiteSpace: rechts ? "nowrap" : undefined,
  borderBottom: `1px solid ${C.hairline}`,
  color: C.text,
  verticalAlign: "middle",
  ...extra,
});

/** Kennzahl-Kachel wie im Mockup (ohne Icon): Titel + Veraenderung, Wert, Erklaerung.
 *  vorher: Vorperiodenwert als Tooltip. */
export function KennzahlKarte({ titel, wert, sub, d, richtung = "up", vorher }) {
  return (
    <Karte
      title={vorher ? `vorher: ${vorher}` : undefined}
      style={{ display: "flex", flexDirection: "column" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{titel}</span>
        <DeltaChip d={d} richtung={richtung} />
      </div>
      <div
        style={{
          fontSize: 26,
          fontWeight: 700,
          color: C.text,
          letterSpacing: "-.5px",
          margin: "12px 0 4px",
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {wert}
      </div>
      <div style={{ fontSize: 12, color: C.textMuted }}>{sub}</div>
    </Karte>
  );
}

/** Raster mit 4 Kacheln pro Zeile (Tablet 2, Handy 1 — Breakpoints im Dashboard-CSS). */
export function KennzahlRaster({ children }) {
  return (
    <div
      className="ads-kpi-raster"
      style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14 }}
    >
      {children}
    </div>
  );
}
