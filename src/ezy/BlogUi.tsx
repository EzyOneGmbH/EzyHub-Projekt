// Gemeinsame UI-Bausteine des Blog-Assistenten. Eigene Datei, damit die
// Schritt-Module nicht zirkulär aus BlogEinrichtung importieren (TDZ-Fehler
// «Cannot access before initialization» im Produktions-Bundle).
import { useEffect, useState, type ReactNode } from "react";
import { authedJson } from "@/lib/authed-fetch";

// Palette = src/ezy/theme.js (CD 2025)
export const P = {
  bg: "#FCFCFC",
  card: "#ffffff",
  text: "#0D0D0D",
  muted: "#5d5563",
  dim: "#8b8092",
  zweitzeile: "#9a8f9d",
  border: "rgba(43,0,51,.08)",
  input: "rgba(43,0,51,.14)",
  accent: "#77008C",
  accentDim: "rgba(119,0,140,.08)",
  grad: "linear-gradient(135deg,#71008B,#B9009C)",
  green: "#00915f",
  greenDim: "rgba(0,145,95,.10)",
  orange: "#c38300",
  orangeDim: "rgba(195,131,0,.12)",
  red: "#df202e",
  redDim: "rgba(223,32,46,.08)",
  shadow: "0 1px 2px rgba(43,0,51,.04), 0 12px 32px -20px rgba(43,0,51,.22)",
};

export type Kunde = {
  id: string;
  name: string;
  domain: string;
  projekt: { id: string; status: string; onboarding_step: number } | null;
};

export const api = (pfad: string, method = "GET", body?: unknown) =>
  authedJson<any>(pfad, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

export const domainVon = (raw: string) => {
  let d = String(raw || "")
    .trim()
    .toLowerCase();
  d = d.replace(/^https?:\/\//, "").replace(/^www\./, "");
  d = d.split(/[/?#]/)[0] || "";
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? d : "";
};

// ── Bausteine ───────────────────────────────────────────────────────────────

export function Titel({ a, b }: { a: string; b: string }) {
  return (
    <h1
      style={{
        fontSize: "clamp(26px, 5vw, 34px)",
        lineHeight: 1.15,
        margin: "0 0 28px",
        fontWeight: 700,
        textWrap: "balance" as any,
      }}
    >
      <span style={{ color: P.text, display: "block" }}>{a}</span>
      <span style={{ color: P.zweitzeile, display: "block" }}>{b}</span>
    </h1>
  );
}

export function Karte({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <section
      style={{
        background: P.card,
        borderRadius: 18,
        boxShadow: P.shadow,
        padding: "22px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        ...style,
      }}
    >
      {children}
    </section>
  );
}

export function Feld({
  label,
  hilfe,
  children,
  id,
}: {
  label: string;
  hilfe?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label htmlFor={id} style={{ fontSize: 13, fontWeight: 700, color: P.text }}>
        {label}
      </label>
      {children}
      {hilfe && <div style={{ fontSize: 12, color: P.dim }}>{hilfe}</div>}
    </div>
  );
}

export const eingabe: React.CSSProperties = {
  border: `1px solid ${P.input}`,
  borderRadius: 10,
  padding: "11px 12px",
  fontSize: 15,
  background: "#fff",
  color: P.text,
  minHeight: 44,
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

export function Knopf({
  children,
  onClick,
  art = "primaer",
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  art?: "primaer" | "sekundaer" | "text";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const basis: React.CSSProperties = {
    minHeight: 44,
    padding: "0 22px",
    borderRadius: 99,
    fontSize: 15,
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
    fontFamily: "inherit",
  };
  const stil: Record<string, React.CSSProperties> = {
    primaer: { ...basis, border: "none", background: P.grad, color: "#fff" },
    sekundaer: { ...basis, border: `1px solid ${P.input}`, background: "#fff", color: P.text },
    text: { ...basis, border: "none", background: "transparent", color: P.muted, padding: "0 8px" },
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={stil[art]}>
      {children}
    </button>
  );
}

export function Hinweis({
  children,
  ton = "info",
}: {
  children: ReactNode;
  ton?: "info" | "fehler" | "ok";
}) {
  const f =
    ton === "fehler"
      ? [P.redDim, P.red]
      : ton === "ok"
        ? [P.greenDim, P.green]
        : [P.accentDim, P.accent];
  return (
    <div
      role={ton === "fehler" ? "alert" : undefined}
      style={{
        background: f[0],
        color: ton === "info" ? P.muted : f[1],
        borderRadius: 12,
        padding: "10px 14px",
        fontSize: 13.5,
      }}
    >
      {children}
    </div>
  );
}

export function Chip({
  children,
  onRemove,
  ton = "neutral",
  title,
}: {
  children: ReactNode;
  onRemove?: () => void;
  ton?: "neutral" | "offen";
  title?: string;
}) {
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 6px 6px 12px",
        borderRadius: 99,
        fontSize: 13.5,
        background: ton === "offen" ? P.orangeDim : P.accentDim,
        color: P.text,
        border: ton === "offen" ? `1px dashed ${P.orange}` : "1px solid transparent",
      }}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Entfernen"
          style={{
            border: "none",
            background: "transparent",
            cursor: "pointer",
            width: 28,
            height: 28,
            borderRadius: 99,
            color: P.muted,
            fontSize: 16,
          }}
        >
          ×
        </button>
      )}
    </span>
  );
}

export function Favicon({ domain, size = 18 }: { domain: string; size?: number }) {
  const [weg, setWeg] = useState(false);
  useEffect(() => setWeg(false), [domain]);
  if (!domain || weg) return null;
  return (
    <img
      src={`https://${domain}/favicon.ico`}
      alt=""
      width={size}
      height={size}
      onError={() => setWeg(true)}
      style={{ borderRadius: 4, flexShrink: 0 }}
    />
  );
}

export function Fuss({
  zurueck,
  weiter,
  weiterText = "Weiter",
  weiterAus,
  busy,
}: {
  zurueck?: () => void;
  weiter?: () => void;
  weiterText?: string;
  weiterAus?: boolean;
  busy?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        marginTop: 28,
        flexWrap: "wrap",
      }}
    >
      <div>
        {zurueck && (
          <Knopf art="text" onClick={zurueck}>
            ← Zurück
          </Knopf>
        )}
      </div>
      {weiter && (
        <Knopf onClick={weiter} disabled={weiterAus || busy}>
          {busy ? "Speichert…" : weiterText}
        </Knopf>
      )}
    </div>
  );
}

// ── Kontext für die Schritte ───────────────────────────────────────────────

export type Ctx = {
  kunde: Kunde;
  project: any;
  ergebnis: any | null;
  setProject: (p: any) => void;
  gehe: (step: number) => void;
  /** Felder speichern, Schritt als erledigt markieren und weitergehen. */
  weiter: (step: number, patch?: Record<string, unknown>) => Promise<boolean>;
  busy: boolean;
  fehler: string | null;
  setFehler: (f: string | null) => void;
  neuLaden: () => Promise<void>;
};

// ── Artikelstatus (Kalender und Artikelansicht) ────────────────────────────

const TON = {
  grau: { farbe: P.muted, grund: "rgba(43,0,51,.06)" },
  akzent: { farbe: P.accent, grund: P.accentDim },
  orange: { farbe: "#8a5d00", grund: P.orangeDim },
  gruen: { farbe: "#00704a", grund: P.greenDim },
  rot: { farbe: "#c01623", grund: P.redDim },
};

/** Status in Worten. Der Kunde sieht interne Zwischenschritte als «Ezy One prüft». */
export function artikelStatus(
  status: string,
  { agentur, geprueft }: { agentur: boolean; geprueft: boolean },
): { text: string; farbe: string; grund: string } {
  switch (status) {
    case "geplant":
      return { text: "Geplant", ...TON.grau };
    case "freigegeben":
    case "schreibt":
      return { text: "Wird geschrieben", ...TON.akzent };
    case "faktencheck":
      return agentur
        ? { text: "Faktencheck offen", ...TON.orange }
        : { text: "Ezy One prüft", ...TON.grau };
    case "entwurf_wp":
      if (agentur)
        return { text: geprueft ? "Wartet auf Freigabe" : "Bereit zur Prüfung", ...TON.akzent };
      return geprueft
        ? { text: "Bereit zur Freigabe", ...TON.akzent }
        : { text: "Ezy One prüft", ...TON.grau };
    case "kunde_freigegeben":
      return { text: "Freigegeben", ...TON.gruen };
    case "live":
      return { text: "Live", ...TON.gruen };
    case "fehler":
      return { text: "Fehler", ...TON.rot };
    default:
      return { text: status, ...TON.grau };
  }
}

export function StatusMarke({
  status,
  agentur,
  geprueft,
}: {
  status: string;
  agentur: boolean;
  geprueft: boolean;
}) {
  const s = artikelStatus(status, { agentur, geprueft });
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: 26,
        padding: "0 10px",
        borderRadius: 99,
        fontSize: 12.5,
        fontWeight: 700,
        color: s.farbe,
        background: s.grund,
        whiteSpace: "nowrap",
      }}
    >
      {s.text}
    </span>
  );
}

export const MODUS_TEXT: Record<string, string> = {
  neu: "Neuer Artikel",
  refresh: "Überarbeitung",
  vorschlag: "Vorschlag",
};

/** «2026-11-12» als lokaler Tag (nicht als UTC-Zeitpunkt, sonst rutscht das Datum). */
export function tagLokal(ymd: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ""));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

export const datumText = (d: Date | null, mitJahr = false) =>
  d
    ? new Intl.DateTimeFormat("de-CH", {
        day: "numeric",
        month: "long",
        ...(mitJahr ? { year: "numeric" } : {}),
      }).format(d)
    : "";

export const zeitText = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat("de-CH", {
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(iso))
    : "";
