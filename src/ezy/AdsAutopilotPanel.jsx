import React from "react";
import { C } from "@/ezy/theme";
import { Btn, Badge } from "@/ezy/shared-ui.jsx";
import { useAuth } from "@/hooks/use-auth";
import { useEzyAdsAutopilot } from "./data/useEzyAdsAutopilot";
import { useEzyLatestRun, googleAdsFromResult } from "./data/useEzyLatestRun";
import {
  canConfigureAutopilot,
  changeClassMatrix,
  describeConfigChange,
  SEASON_WINDOW_RE,
} from "./data/adsAutopilotPolicy";

// Google Ads Autopilot Panel (EzyPerformance): Konfiguration (Owner/Admin),
// Freigabe-Queue, offene Massnahmen, Befunde, Detailanalyse-Drilldowns und
// Aenderungs-Log - im hellen Ezy-One-Design (gemeinsame Palette aus theme.js,
// Btn/Badge aus shared-ui). Reads via Supabase RLS; Mutationen ausschliesslich
// ueber user-authed /api/google/ads-autopilot-* Endpoints.

const STATUS_COLOR = {
  executed: C.green,
  approved: C.green,
  "dry-run": C.blue,
  pending: C.orange,
  failed: C.red,
  rejected: C.red,
  expired: C.textDim,
  blocked_tracking: C.red,
  "report-only": C.textMuted,
};

const chf = (n, dec = 0) =>
  `CHF ${Number(n || 0).toLocaleString("de-CH", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
const pct = (v) => (v == null ? "—" : `${Math.round(Number(v) * 100)} %`);
const dateCH = (iso) => (iso ? new Date(iso).toLocaleDateString("de-CH") : "—");

function StatusBadge({ status }) {
  return <Badge color={STATUS_COLOR[status] || C.textMuted}>{status}</Badge>;
}

// Karte im Stil der Dashboard-Karten (weiss, runde Ecken, feiner Rand).
function Card({ children, style }) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: "18px 20px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ title, hint, count }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 16, fontWeight: 600, color: C.text }}>
        {title}
        {count != null && <span style={{ color: C.textMuted, fontWeight: 500 }}> ({count})</span>}
      </div>
      {hint && <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function Banner({ color, colorDim, children }) {
  return (
    <div
      style={{
        padding: "10px 14px",
        borderRadius: 10,
        background: colorDim,
        border: `1px solid ${color}33`,
        color,
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

// Expliziter Hinweis, wenn eine Datenquelle fehlt: benennt Feld/Abfrage und den
// Weg, sie zu fuellen - statt leerer oder simulierter Tabellen.
function MissingData({ source, action }) {
  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: 10,
        background: C.surface,
        border: `1px dashed ${C.border}`,
        fontSize: 13,
        color: C.textMuted,
        lineHeight: 1.6,
      }}
    >
      <div style={{ fontWeight: 600, color: C.text, marginBottom: 4 }}>Daten fehlen</div>
      <div>
        Fehlende Quelle:{" "}
        <code style={{ fontSize: 12, background: C.bg, padding: "1px 5px", borderRadius: 4 }}>
          {source}
        </code>
      </div>
      {action && <div style={{ marginTop: 4 }}>{action}</div>}
    </div>
  );
}

function Modal({ title, onClose, children, maxWidth = 580 }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(22,18,23,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          boxShadow: "0 20px 60px rgba(22,18,23,0.18)",
          padding: 20,
          maxWidth,
          width: "100%",
          maxHeight: "88vh",
          overflowY: "auto",
          animation: "fadeScale .15s ease",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{title}</div>
          <button
            onClick={onClose}
            aria-label="Schliessen"
            style={{
              background: "transparent",
              border: "none",
              color: C.textMuted,
              fontSize: 20,
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalSection({ title, color, children }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          fontSize: 11.5,
          fontWeight: 700,
          color: color || C.textMuted,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 13, color: C.text, marginTop: 4, lineHeight: 1.55 }}>{children}</div>
    </div>
  );
}

// Mobile-taugliche Tabelle: horizontales Scrollen im eigenen Container.
function ScrollTable({ head, rows, minWidth = 560 }) {
  return (
    <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
      <table style={{ width: "100%", minWidth, borderCollapse: "collapse", fontSize: 13 }}>
        {head.length > 0 && (
          <thead>
            <tr style={{ color: C.textMuted, textAlign: "left" }}>
              {head.map((h) => (
                <th key={h} style={{ padding: "6px 8px", fontWeight: 600, whiteSpace: "nowrap" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

// Verstaendliche deutsche Erklaerung je Empfehlungs-Typ: Label fuer die Liste,
// im Popup "Was wird bei Freigabe gemacht?" fuer Menschen ohne Ads-Wissen.
const TYPE_INFO = {
  budget_change: {
    label: "Budget-Änderung",
    action: (a) =>
      `Bei Freigabe wird das Tagesbudget der Kampagne «${a.entity || "?"}» von ${a.current_value || "?"} auf ${a.proposed_value || "?"} angepasst. Sonst wird nichts verändert — die Anpassung kann jederzeit wieder zurückgesetzt werden.`,
  },
  add_negative: {
    label: "Suchbegriff ausschliessen",
    action: () =>
      `Bei Freigabe wird dieser Suchbegriff als «auszuschliessendes Keyword» hinterlegt. Die Anzeige erscheint dann nicht mehr, wenn jemand genau danach sucht — das Budget fliesst stattdessen in Suchanfragen, die tatsächlich Buchungen bringen. Der Begriff hat Geld gekostet, aber keine einzige Buchung gebracht.`,
  },
  negative_keyword_semantic: {
    label: "Suchbegriff ausschliessen (KI-geprüft)",
    action: () =>
      `Bei Freigabe wird dieser Suchbegriff als «auszuschliessendes Keyword» hinterlegt, weil er inhaltlich nicht zum Angebot passt (z. B. falsche Region oder Stellensuche). Der Vorschlag stammt von der KI-Bewertung, wurde aber automatisch gegengeprüft (kein Konflikt mit buchenden Suchbegriffen, kein Duplikat). Solche Vorschläge werden grundsätzlich NIE ohne menschliche Freigabe umgesetzt.`,
  },
  campaign_proposal: {
    label: "Kampagnen-Vorschlag",
    action: () =>
      `Bei Freigabe wird NICHTS automatisch an Google Ads verändert. Die Freigabe bedeutet nur dein Einverständnis zum Konzept — die eigentliche Umsetzung (neue Kampagnenstruktur) erfolgt danach manuell bzw. über den Ads-Editor.`,
  },
  bid_change: {
    label: "Gebots-Änderung",
    action: (a) =>
      `Bei Freigabe wird das Gebot von ${a.current_value || "?"} auf ${a.proposed_value || "?"} angepasst. Die Änderung ist jederzeit umkehrbar.`,
  },
};
const typeLabel = (t) => TYPE_INFO[t]?.label || FINDING_INFO[t]?.label || t;

// Report-only-Befunde: deutsche Labels + Gruppe fuer die Uebersicht.
const FINDING_INFO = {
  brand_is_alert: { label: "Brand-Sichtbarkeit unter Ziel", gruppe: "Sichtbarkeit" },
  brand_ota_pressure: { label: "OTA-Druck auf Brand", gruppe: "Sichtbarkeit" },
  qs_weakness: { label: "Schwacher Quality Score", gruppe: "Anzeigen-Qualität" },
  asset_weakness: { label: "Schwache Anzeigen-Bausteine", gruppe: "Anzeigen-Qualität" },
  adgroup_anomaly: { label: "Anzeigengruppen-Ausreisser", gruppe: "Struktur" },
  mom_regression: { label: "Verschlechterung vs. Vormonat", gruppe: "Struktur" },
  geo_anomaly: { label: "Geld ohne Ertrag (Region)", gruppe: "Streuung" },
  device_anomaly: { label: "Geräte-Auffälligkeit", gruppe: "Streuung" },
  negative_conflict: { label: "Ausschluss-Konflikt (nicht umgesetzt)", gruppe: "Suchbegriffe" },
  tracking_health_alert: { label: "Tracking-Verdacht", gruppe: "Messung" },
  budget_unconfirmed: { label: "Budget nicht bestätigt", gruppe: "Konfiguration" },
};
const findingGroup = (t) => FINDING_INFO[t]?.gruppe || "Weitere";

// Offene Massnahmen (Empfehlungen): deutsches Label + Laien-Erklaerung je Typ.
const RECO_INFO = {
  bid_target_adjustment: {
    label: "Gebotsziel anpassen",
    problem:
      "Das hinterlegte Ziel der automatischen Gebotssteuerung (Ziel-ROAS oder Ziel-CPA) passt nicht zur tatsächlichen Leistung: Ein zu ehrgeiziges Ziel drosselt die Auslieferung, ein zu lasches verschenkt Effizienz.",
    todo: "Das Ziel in den Gebotsstrategie-Einstellungen der Kampagne in die vorgeschlagene Richtung anpassen und die Wirkung 2–3 Wochen beobachten. Die Strategie selbst NICHT wechseln.",
  },
  bid_strategy_change: {
    label: "Gebotsstrategie prüfen",
    problem:
      "Die gewählte Gebotsstrategie passt nicht zur Datenlage oder Zielsetzung (z. B. Wert-Optimierung ohne Conversion-Werte, oder Optimierung auf Anzahl statt auf Wert).",
    todo: "Einen Strategie-Wechsel prüfen — kein Muss. Achtung: Jeder Wechsel wirft die Kampagne in die Lernphase zurück, also nur mit klarem Test und Messfenster umsetzen.",
  },
  bid_signal_gap: {
    label: "Fehlendes Optimierungssignal",
    problem:
      "Der automatischen Gebotssteuerung fehlt die Datengrundlage: zu wenige Conversions, fehlende Conversion-Werte oder ein Tracking-Problem. Ohne Signal optimiert das System praktisch blind.",
    todo: "Zuerst die Ursache beheben (Conversion-Setup/Tracking prüfen, Kampagnen-Struktur verengen), BEVOR an den Geboten gedreht wird.",
  },
  asset_replace: {
    label: "Anzeigentext austauschen",
    problem:
      "Anzeigenbausteine (Titel/Beschreibungen) sind von Google als schwach bewertet — das drückt die Anzeigenqualität und damit die Auslieferung.",
    todo: "Die genannten schwachen Texte durch die vorgeschlagenen Alternativen ersetzen (Google-Ads-Oberfläche/Editor). Google testet neue Varianten automatisch aus.",
  },
  asset_coverage: {
    label: "Fehlende Anzeigen/Assets",
    problem:
      "Einer Anzeigengruppe fehlt eine aktive Anzeige oder einer Performance-Max-Gruppe fehlt ein Asset-Typ (z. B. Video). Dann liefert Google weniger aus oder generiert selbst Ersatz.",
    todo: "Die fehlende Anzeige bzw. den fehlenden Asset-Typ ergänzen.",
  },
  asset_pinning: {
    label: "Über-Pinning lösen",
    problem:
      "Zu viele fixierte (gepinnte) Positionen nehmen Google die Flexibilität, die beste Kombination auszuspielen — das kann die Anzeigenqualität senken.",
    todo: "Nicht zwingende Pins lösen; nur die wirklich schützenswerte Botschaft fixiert lassen.",
  },
  keyword_add: {
    label: "Keyword-Lücke schliessen",
    problem:
      "Es gibt Suchbegriffe mit echter Nachfrage (Volumen belegt), für die keine passende Anzeige läuft — das sind verschenkte Buchungen.",
    todo: "Das Keyword in der passenden Anzeigengruppe mit sinnvollem Match-Type ergänzen. Die Forecast-Zahlen sind Schätzwerte, kein garantierter Ertrag.",
  },
  keyword_pause: {
    label: "Keyword pausieren",
    problem:
      "Ein Keyword kostet über seine gesamte Laufzeit dauerhaft Geld, ohne eine einzige Buchung zu bringen — belegter Streuverlust.",
    todo: "Das Keyword pausieren (nicht löschen, damit die Historie erhalten bleibt). Das Budget arbeitet dann in den konvertierenden Keywords.",
  },
  keyword_match_change: {
    label: "Match-Type / Kannibalisierung",
    problem:
      "Derselbe Suchbegriff läuft über mehrere Kampagnen/Gruppen (die Kampagnen überbieten sich gegenseitig) oder ein zu breiter Match-Type zieht unpassende Anfragen an.",
    todo: "Match-Types verengen bzw. den Begriff eindeutig einer Kampagne zuordnen (ggf. gegenseitige Ausschlüsse setzen).",
  },
  other: {
    label: "Massnahme",
    problem: "",
    todo: "Siehe Begründung und vorgeschlagene Massnahme.",
  },
};
const recoLabel = (t) => RECO_INFO[t]?.label || t;

function daysUntil(iso) {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

const AUTONOMY_LABELS = [
  "0 — nur berichten",
  "1 — Negatives automatisch",
  "2 — + Gebote automatisch",
];

// ─────────────────────────────────────────────────────────────────────────────
// Konfigurations-Dialog (Owner/Admin): Formular -> Zusammenfassung + Pflicht-
// Begruendung -> Speichern. Sichere Defaults; Warnung beim Schaerfen.
// ─────────────────────────────────────────────────────────────────────────────
function ConfigModal({ config, busy, onSave, onClose }) {
  const base = {
    observe_only: config?.observe_only !== false,
    kill_switch: config?.kill_switch === true,
    autonomy_level: config?.autonomy_level ?? 0,
    target_cpa_chf: config?.target_cpa_chf ?? null,
    target_roas: config?.target_roas ?? null,
    monthly_budget_chf: config?.monthly_budget_chf ?? 0,
    no_touch_campaigns: config?.no_touch_campaigns ?? [],
    season_high: config?.season_high ?? [],
    season_low: config?.season_low ?? [],
  };
  const [draft, setDraft] = React.useState({
    observe_only: base.observe_only,
    kill_switch: base.kill_switch,
    autonomy_level: base.autonomy_level,
    target_cpa_chf: base.target_cpa_chf ?? "",
    target_roas: base.target_roas ?? "",
    monthly_budget_chf: base.monthly_budget_chf || "",
    no_touch_text: (base.no_touch_campaigns || []).join("\n"),
    season_high_text: (base.season_high || []).join("\n"),
    season_low_text: (base.season_low || []).join("\n"),
  });
  const [step, setStep] = React.useState("form"); // form | confirm
  const [summary, setSummary] = React.useState("");
  const [saveError, setSaveError] = React.useState("");

  const splitLines = (t) =>
    t
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  const buildPatch = () => ({
    observe_only: draft.observe_only,
    kill_switch: draft.kill_switch,
    autonomy_level: Number(draft.autonomy_level),
    target_cpa_chf: draft.target_cpa_chf === "" ? null : Number(draft.target_cpa_chf),
    target_roas: draft.target_roas === "" ? null : Number(draft.target_roas),
    monthly_budget_chf: draft.monthly_budget_chf === "" ? 0 : Number(draft.monthly_budget_chf),
    no_touch_campaigns: splitLines(draft.no_touch_text),
    season_high: splitLines(draft.season_high_text),
    season_low: splitLines(draft.season_low_text),
  });
  const patch = buildPatch();
  // Ungueltige Saison-Fenster sofort im Formular markieren (Format MM-TT..MM-TT).
  const badSeason = [...patch.season_high, ...patch.season_low].find(
    (w) => !SEASON_WINDOW_RE.test(w),
  );
  const diffLines = describeConfigChange(base, patch);
  const sharpens =
    (base.observe_only && !patch.observe_only) || patch.autonomy_level > base.autonomy_level;

  const field = (label, control, hint) => (
    <div style={{ marginBottom: 14 }}>
      <label
        style={{
          display: "block",
          fontSize: 12,
          color: C.textMuted,
          marginBottom: 5,
          fontWeight: 500,
        }}
      >
        {label}
      </label>
      {control}
      {hint && (
        <div style={{ fontSize: 11.5, color: C.textDim, marginTop: 4, lineHeight: 1.5 }}>
          {hint}
        </div>
      )}
    </div>
  );
  const inputStyle = {
    width: "100%",
    padding: "9px 12px",
    borderRadius: 8,
    background: C.card,
    border: `1px solid ${C.border}`,
    color: C.text,
    fontSize: 13,
    outline: "none",
    fontFamily: "inherit",
    boxSizing: "border-box",
  };
  const toggle = (key, onLabel, offLabel) => (
    <div style={{ display: "flex", gap: 8 }}>
      {[true, false].map((v) => (
        <button
          key={String(v)}
          onClick={() => setDraft((d) => ({ ...d, [key]: v }))}
          style={{
            flex: 1,
            padding: "8px 10px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "inherit",
            cursor: "pointer",
            border: `1px solid ${draft[key] === v ? C.accent : C.border}`,
            background: draft[key] === v ? C.accentDim : C.card,
            color: draft[key] === v ? C.accent : C.textMuted,
          }}
        >
          {v ? onLabel : offLabel}
        </button>
      ))}
    </div>
  );

  return (
    <Modal title="Autopilot konfigurieren" onClose={onClose} maxWidth={620}>
      {step === "form" && (
        <>
          <div
            style={{ fontSize: 12.5, color: C.textMuted, margin: "6px 0 16px", lineHeight: 1.5 }}
          >
            Gilt nur für diesen Kunden. Sichere Standardwerte: Beobachtungsmodus <b>an</b>,
            Autonomie-Level <b>0</b> — damit ändert der Autopilot nichts an Google Ads.
          </div>
          <div
            className="ezy-form-grid"
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}
          >
            {field(
              "Beobachtungsmodus",
              toggle("observe_only", "An (nur dokumentieren)", "Aus (Ausführung möglich)"),
              "Solange an: KEINE Änderungen an Google Ads, unabhängig vom Autonomie-Level. Freigaben sind gesperrt.",
            )}
            {field(
              "Kill-Switch",
              toggle("kill_switch", "Aktiv (alles stoppen)", "Inaktiv"),
              "Not-Aus: Überspringt Läufe komplett und blockiert auch die Ausführung bereits erteilter Freigaben.",
            )}
            {field(
              "Autonomie-Level",
              <select
                value={String(draft.autonomy_level)}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, autonomy_level: Number(e.target.value) }))
                }
                style={{ ...inputStyle, appearance: "auto" }}
              >
                {AUTONOMY_LABELS.map((l, i) => (
                  <option key={i} value={i}>
                    {l}
                  </option>
                ))}
              </select>,
              <>
                Erlaubte Änderungsklassen bei diesem Level:
                {changeClassMatrix(Number(draft.autonomy_level)).map((row) => (
                  <div
                    key={row.klasse}
                    style={{ display: "flex", justifyContent: "space-between", gap: 8 }}
                  >
                    <span>{row.klasse}</span>
                    <b
                      style={{
                        color:
                          row.verhalten === "automatisch"
                            ? C.orange
                            : row.verhalten === "nie automatisch"
                              ? C.textDim
                              : C.green,
                      }}
                    >
                      {row.verhalten}
                    </b>
                  </div>
                ))}
              </>,
            )}
            {field(
              "Monatsbudget (CHF)",
              <input
                type="number"
                min="0"
                value={draft.monthly_budget_chf}
                onChange={(e) => setDraft((d) => ({ ...d, monthly_budget_chf: e.target.value }))}
                placeholder="z. B. 3000"
                style={inputStyle}
              />,
              "Soll-Budget für den Budget-Pacing-Check. 0/leer = nicht gepflegt (Pacing zeigt dann einen Setup-Hinweis).",
            )}
            {field(
              "Ziel-CPA (CHF)",
              <input
                type="number"
                min="0"
                value={draft.target_cpa_chf}
                onChange={(e) => setDraft((d) => ({ ...d, target_cpa_chf: e.target.value }))}
                placeholder="leer = kein Ziel"
                style={inputStyle}
              />,
              "Kosten pro Conversion, die höchstens anfallen sollen. Entweder Ziel-CPA ODER Ziel-ROAS pflegen.",
            )}
            {field(
              "Ziel-ROAS",
              <input
                type="number"
                min="0"
                step="0.1"
                value={draft.target_roas}
                onChange={(e) => setDraft((d) => ({ ...d, target_roas: e.target.value }))}
                placeholder="leer = kein Ziel"
                style={inputStyle}
              />,
              "Umsatz pro Werbefranken (z. B. 4 = CHF 4 Umsatz je CHF 1 Budget).",
            )}
          </div>
          {field(
            "Geschützte Kampagnen (no-touch, eine pro Zeile)",
            <textarea
              rows={3}
              value={draft.no_touch_text}
              onChange={(e) => setDraft((d) => ({ ...d, no_touch_text: e.target.value }))}
              placeholder={"Brand CH\nMarken-Kampagne DE"}
              style={{ ...inputStyle, resize: "vertical" }}
            />,
            "Exakter Kampagnenname. Diese Kampagnen fasst der Autopilot NIE an — auch nicht nach Freigabe.",
          )}
          <div
            className="ezy-form-grid"
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}
          >
            {field(
              "Hochsaison-Fenster (eines pro Zeile)",
              <textarea
                rows={2}
                value={draft.season_high_text}
                onChange={(e) => setDraft((d) => ({ ...d, season_high_text: e.target.value }))}
                placeholder={"06-01..09-15"}
                style={{ ...inputStyle, resize: "vertical" }}
              />,
              "Format MM-TT..MM-TT. In der Hochsaison bewertet der Autopilot Budget-/Leistungssignale saisonbewusst.",
            )}
            {field(
              "Nebensaison-Fenster (eines pro Zeile)",
              <textarea
                rows={2}
                value={draft.season_low_text}
                onChange={(e) => setDraft((d) => ({ ...d, season_low_text: e.target.value }))}
                placeholder={"11-01..12-15"}
                style={{ ...inputStyle, resize: "vertical" }}
              />,
              "Jahreswechsel erlaubt (z. B. 12-01..02-28).",
            )}
          </div>
          {badSeason && (
            <div style={{ marginBottom: 10 }}>
              <Banner color={C.red} colorDim={C.redDim}>
                Saison-Fenster «{badSeason}» ist ungültig — Format MM-TT..MM-TT, z. B. 06-01..09-15.
              </Banner>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
            <Btn variant="secondary" onClick={onClose}>
              Abbrechen
            </Btn>
            <Btn
              onClick={() => {
                setSaveError("");
                setStep("confirm");
              }}
              disabled={diffLines.length === 0 || !!badSeason}
              title={diffLines.length === 0 ? "Keine Änderung erkannt" : undefined}
            >
              Weiter zur Bestätigung
            </Btn>
          </div>
        </>
      )}

      {step === "confirm" && (
        <>
          <ModalSection title="Zusammenfassung der Änderungen">
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {diffLines.map((l) => (
                <li key={l} style={{ marginBottom: 4 }}>
                  {l}
                </li>
              ))}
            </ul>
          </ModalSection>
          {sharpens && (
            <div style={{ marginTop: 12 }}>
              <Banner color={C.red} colorDim={C.redDim}>
                <b>Achtung:</b> Diese Änderung erlaubt dem Autopiloten mehr Autonomie bzw. echte
                Ausführungen an Google Ads. Bitte nur nach Qualitätsprüfung bestätigen.
              </Banner>
            </div>
          )}
          <ModalSection title="Begründung (Pflicht, landet im Änderungsprotokoll)">
            <textarea
              rows={2}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Warum wird das geändert? (min. 5 Zeichen)"
              style={{
                width: "100%",
                padding: "9px 12px",
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                fontSize: 13,
                fontFamily: "inherit",
                boxSizing: "border-box",
                resize: "vertical",
              }}
            />
          </ModalSection>
          {saveError && (
            <div style={{ marginTop: 10 }}>
              <Banner color={C.red} colorDim={C.redDim}>
                {saveError}
              </Banner>
            </div>
          )}
          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
              marginTop: 16,
              flexWrap: "wrap",
            }}
          >
            <Btn variant="secondary" onClick={() => setStep("form")}>
              Zurück
            </Btn>
            <Btn
              disabled={busy || summary.trim().length < 5}
              onClick={async () => {
                setSaveError("");
                const r = await onSave(buildPatch(), summary.trim());
                if (r?.ok) onClose();
                else setSaveError(r?.error || "Speichern fehlgeschlagen.");
              }}
            >
              {busy ? "Speichert…" : "Änderungen bestätigen & speichern"}
            </Btn>
          </div>
        </>
      )}
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Freigabe-Detail: aktueller Wert, vorgeschlagener Wert, Begruendung, erwartete
// Wirkung und Ablaufdatum - immer sichtbar, bevor freigegeben wird.
// ─────────────────────────────────────────────────────────────────────────────
function ApprovalDetailModal({ approval: a, observeOnly, canDecide, busy, onDecide, onClose }) {
  if (!a) return null;
  const info = TYPE_INFO[a.type];
  const rest = daysUntil(a.expires_at);
  return (
    <Modal title={a.entity || typeLabel(a.type)} onClose={onClose}>
      <div style={{ marginTop: 6 }}>
        <Badge>{typeLabel(a.type)}</Badge>
      </div>
      <ModalSection title="Aktueller Wert → vorgeschlagener Wert">
        <span style={{ color: C.textMuted }}>{a.current_value || "—"}</span>{" "}
        <span style={{ color: C.textDim }}>→</span>{" "}
        <b style={{ color: C.accent }}>{a.proposed_value || "—"}</b>
      </ModalSection>
      <ModalSection title="Warum gibt es diese Empfehlung?">
        {a.rationale || "Keine Begründung hinterlegt."}
      </ModalSection>
      <ModalSection title="Was wird bei Freigabe gemacht?">
        {info
          ? info.action(a)
          : "Bei Freigabe wird die vorgeschlagene Änderung umgesetzt; bei Ablehnung passiert nichts."}
      </ModalSection>
      <ModalSection title="Erwartete Wirkung" color={C.accent}>
        {a.estimated_impact || "Keine Angabe."}
      </ModalSection>
      <ModalSection title="Fristen & Herkunft" color={C.textMuted}>
        Erstellt am {dateCH(a.created_at)} (Lauf {a.run_id || "?"}).{" "}
        {a.expires_at ? (
          <span style={{ color: rest !== null && rest <= 2 ? C.orange : C.textMuted }}>
            Läuft ab am {dateCH(a.expires_at)}
            {rest !== null ? ` — noch ${Math.max(rest, 0)} Tag${rest === 1 ? "" : "e"}` : ""}.
          </span>
        ) : (
          "Kein Ablaufdatum."
        )}{" "}
        Ohne Entscheid verfällt die Empfehlung automatisch — es wird dann nichts verändert.
      </ModalSection>
      <div
        style={{
          display: "flex",
          gap: 8,
          marginTop: 18,
          justifyContent: "flex-end",
          flexWrap: "wrap",
        }}
      >
        <Btn variant="secondary" onClick={onClose}>
          Schliessen
        </Btn>
        {canDecide && (
          <>
            <Btn variant="danger" disabled={busy} onClick={() => onDecide("reject")}>
              Ablehnen
            </Btn>
            <Btn
              variant="success"
              disabled={busy || observeOnly}
              onClick={() => onDecide("approve")}
            >
              {observeOnly ? "Freigabe gesperrt (Beobachtungsmodus)" : "Freigeben"}
            </Btn>
          </>
        )}
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detailanalyse: Drilldowns aus dem letzten Autopilot-Lauf (audit_runs/
// ads_autopilot) + google_ads-Snapshot. Fehlende Quellen werden benannt.
// ─────────────────────────────────────────────────────────────────────────────
function DetailAnalysis({ autopilotRun, adsSnapshot }) {
  const [tab, setTab] = React.useState("campaigns");
  // Kampagnenansicht: Sortierung, Filter, Detail-Modal.
  const [sortKey, setSortKey] = React.useState("cost");
  const [sortDir, setSortDir] = React.useState(-1); // -1 = absteigend
  const [campQuery, setCampQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("alle");
  const [campDetail, setCampDetail] = React.useState(null);
  const run = autopilotRun?.result || null;
  const runDate = autopilotRun?.created_at ? dateCH(autopilotRun.created_at) : null;
  const ads = adsSnapshot;

  // Kampagnenzeilen: Basis = google_ads-Snapshot (folgt dem global gewaehlten
  // Dashboard-Zeitraum, inkl. Status/Klicks/Impressionen), angereichert per
  // Namens-Match mit den Autopilot-Feldern (IS-Verluste, Strategie, Schutz).
  const campaignRows = React.useMemo(() => {
    const enrich = new Map(
      (run?.campaignDetail ?? []).map((c) => [String(c.name).toLowerCase(), c]),
    );
    const snap = ads?.campaigns ?? [];
    const base = snap.length
      ? snap.map((c) => ({
          name: c.name,
          status: c.status || "—",
          cost: Number(c.cost || 0),
          clicks: Number(c.clicks || 0),
          impressions: Number(c.impressions || 0),
          conversions: Number(c.conversions || 0),
          value: Number(c.conversionValue || 0),
          source: "snapshot",
        }))
      : (run?.campaignDetail ?? []).map((c) => ({
          // Fallback ohne Snapshot: Autopilot-Fenster (30 Tage), ohne Klicks/Impr.
          name: c.name,
          status: "ENABLED",
          cost: Number(c.costChf || 0),
          clicks: null,
          impressions: null,
          conversions: Number(c.conversions || 0),
          value: Number(c.conversionValue || 0),
          source: "autopilot",
        }));
    return base.map((c) => {
      const e = enrich.get(String(c.name).toLowerCase()) || null;
      return {
        ...c,
        cpa: c.conversions > 0 ? c.cost / c.conversions : null,
        roas: c.cost > 0 && c.value > 0 ? c.value / c.cost : null,
        auto: e,
      };
    });
  }, [ads, run]);
  const filteredCampaigns = React.useMemo(() => {
    const q = campQuery.trim().toLowerCase();
    const rows = campaignRows.filter(
      (c) =>
        (!q || c.name.toLowerCase().includes(q)) &&
        (statusFilter === "alle" || c.status === statusFilter),
    );
    const val = (c) => {
      const v = c[sortKey];
      return v == null ? -Infinity : typeof v === "string" ? v.toLowerCase() : Number(v);
    };
    return [...rows].sort((a, b) => (val(a) < val(b) ? sortDir : val(a) > val(b) ? -sortDir : 0));
  }, [campaignRows, campQuery, statusFilter, sortKey, sortDir]);
  const campaignStatuses = React.useMemo(
    () => [...new Set(campaignRows.map((c) => c.status))].sort(),
    [campaignRows],
  );

  const tabs = [
    { id: "campaigns", label: "Kampagnen" },
    { id: "searchterms", label: "Suchbegriffsverluste" },
    { id: "pacing", label: "Budget-Pacing" },
    { id: "conversions", label: "Conversion-Aktionen" },
    { id: "regions", label: "Regionen" },
    { id: "devices", label: "Geräte" },
    { id: "bidding", label: "Gebotsstrategien" },
    { id: "tracking", label: "Tracking-Gesundheit" },
  ];
  const noRunHint = (
    <MissingData
      source="audit_runs(audit_type=ads_autopilot).result"
      action="Noch kein Autopilot-Lauf gespeichert — oben «Dry-Run jetzt» ausführen, dann füllt sich dieser Bereich (rein lesend, keine Änderungen an Google Ads)."
    />
  );

  const cellStyle = { padding: "7px 8px", whiteSpace: "nowrap" };

  return (
    <Card>
      <SectionTitle
        title="Detailanalyse"
        hint={
          runDate
            ? `Datenstand: letzter Autopilot-Lauf vom ${runDate}${run?.runId ? ` (${run.runId})` : ""} (Fenster 30 Tage); Kampagnen-Kennzahlen folgen dem im Ads-Dashboard gewählten Zeitraum.`
            : "Datenstand: noch kein Autopilot-Lauf vorhanden."
        }
      />
      <div
        className="tabbar"
        style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "7px 12px",
              borderRadius: 8,
              fontSize: 12.5,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
              whiteSpace: "nowrap",
              border: `1px solid ${tab === t.id ? C.accent : C.border}`,
              background: tab === t.id ? C.accentDim : C.card,
              color: tab === t.id ? C.accent : C.textMuted,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Kampagnen (Snapshot-Basis = globaler Dashboard-Zeitraum, Autopilot-Anreicherung) */}
      {tab === "campaigns" &&
        (campaignRows.length ? (
          <>
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <input
                value={campQuery}
                onChange={(e) => setCampQuery(e.target.value)}
                placeholder="Kampagne filtern…"
                style={{
                  padding: "7px 10px",
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  fontSize: 12.5,
                  fontFamily: "inherit",
                  minWidth: 180,
                }}
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{
                  padding: "7px 10px",
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  fontSize: 12.5,
                  fontFamily: "inherit",
                }}
              >
                <option value="alle">Status: alle</option>
                {campaignStatuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <span style={{ fontSize: 11.5, color: C.textDim }}>
                {filteredCampaigns.length} von {campaignRows.length} Kampagnen · Klick auf
                Spaltentitel sortiert, Klick auf Zeile öffnet Details
              </span>
            </div>
            <ScrollTable
              minWidth={900}
              head={[]}
              rows={
                <>
                  <tr style={{ color: C.textMuted, textAlign: "left" }}>
                    {[
                      ["name", "Kampagne"],
                      ["status", "Status"],
                      ["cost", "Kosten"],
                      ["clicks", "Klicks"],
                      ["impressions", "Impr."],
                      ["conversions", "Conv."],
                      ["value", "Wert"],
                      ["cpa", "CPA"],
                      ["roas", "ROAS"],
                    ].map(([key, label]) => (
                      <th
                        key={key}
                        onClick={() => {
                          if (sortKey === key) setSortDir(-sortDir);
                          else {
                            setSortKey(key);
                            setSortDir(key === "name" || key === "status" ? 1 : -1);
                          }
                        }}
                        style={{
                          padding: "6px 8px",
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                          cursor: "pointer",
                          userSelect: "none",
                          color: sortKey === key ? C.accent : C.textMuted,
                        }}
                      >
                        {label}
                        {sortKey === key ? (sortDir === -1 ? " ↓" : " ↑") : ""}
                      </th>
                    ))}
                  </tr>
                  {filteredCampaigns.map((c) => (
                    <tr
                      key={c.name}
                      onClick={() => setCampDetail(c)}
                      title="Klicken für Detailansicht"
                      style={{
                        borderTop: `1px solid ${C.border}`,
                        color: C.textMuted,
                        cursor: "pointer",
                      }}
                    >
                      <td
                        style={{
                          ...cellStyle,
                          color: C.text,
                          fontWeight: 600,
                          whiteSpace: "normal",
                          minWidth: 180,
                        }}
                      >
                        {c.name}
                        {c.auto?.noTouch && (
                          <span style={{ marginLeft: 6 }}>
                            <Badge color={C.blue}>geschützt</Badge>
                          </span>
                        )}
                        {c.auto?.learning && (
                          <span style={{ marginLeft: 6 }}>
                            <Badge color={C.orange}>Lernphase</Badge>
                          </span>
                        )}
                      </td>
                      <td style={cellStyle}>
                        <Badge color={c.status === "ENABLED" ? C.green : C.textMuted}>
                          {c.status}
                        </Badge>
                      </td>
                      <td style={cellStyle}>{chf(c.cost)}</td>
                      <td style={cellStyle}>
                        {c.clicks != null ? c.clicks.toLocaleString("de-CH") : "—"}
                      </td>
                      <td style={cellStyle}>
                        {c.impressions != null ? c.impressions.toLocaleString("de-CH") : "—"}
                      </td>
                      <td style={cellStyle}>{Math.round(c.conversions * 10) / 10}</td>
                      <td style={cellStyle}>{c.value > 0 ? chf(c.value) : "—"}</td>
                      <td style={cellStyle}>{c.cpa != null ? chf(c.cpa, 2) : "—"}</td>
                      <td
                        style={{
                          ...cellStyle,
                          color: c.roas != null && c.roas < 1 ? C.red : C.text,
                          fontWeight: 600,
                        }}
                      >
                        {c.roas != null ? `${c.roas.toFixed(1).replace(".", ",")}×` : "—"}
                      </td>
                    </tr>
                  ))}
                </>
              }
            />
            <div style={{ fontSize: 11.5, color: C.textDim, marginTop: 8 }}>
              {campaignRows[0]?.source === "snapshot"
                ? "Kennzahlen: google_ads-Snapshot — Zeitraum wie im Ads-Dashboard gewählt. Badges/IS-Werte: letzter Autopilot-Lauf (30 Tage)."
                : "Kein google_ads-Snapshot vorhanden — Kennzahlen aus dem Autopilot-Fenster (30 Tage, ohne Klicks/Impressionen). Im Ads-Dashboard «⟳ Aktualisieren» klicken für den globalen Zeitraum."}
            </div>
          </>
        ) : run ? (
          <MissingData
            source="audit_runs(google_ads).result.campaigns + result.campaignDetail"
            action="Im Ads-Dashboard «⟳ Aktualisieren» klicken (Snapshot) oder «Dry-Run jetzt» ausführen (Autopilot-Daten)."
          />
        ) : (
          noRunHint
        ))}

      {/* Kampagnen-Detail-Modal */}
      {campDetail && (
        <Modal title={campDetail.name} onClose={() => setCampDetail(null)} maxWidth={600}>
          <div
            style={{
              marginTop: 6,
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <Badge color={campDetail.status === "ENABLED" ? C.green : C.textMuted}>
              {campDetail.status}
            </Badge>
            {campDetail.auto?.noTouch && <Badge color={C.blue}>geschützt (no-touch)</Badge>}
            {campDetail.auto?.learning && <Badge color={C.orange}>Lernphase</Badge>}
          </div>
          <ModalSection title="Leistung (Zeitraum wie im Ads-Dashboard)">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px" }}>
              <span>
                Kosten: <b>{chf(campDetail.cost, 2)}</b>
              </span>
              <span>
                Klicks:{" "}
                <b>{campDetail.clicks != null ? campDetail.clicks.toLocaleString("de-CH") : "—"}</b>
              </span>
              <span>
                Impressionen:{" "}
                <b>
                  {campDetail.impressions != null
                    ? campDetail.impressions.toLocaleString("de-CH")
                    : "—"}
                </b>
              </span>
              <span>
                Conversions: <b>{Math.round(campDetail.conversions * 10) / 10}</b>
              </span>
              <span>
                Conversion-Wert: <b>{campDetail.value > 0 ? chf(campDetail.value) : "—"}</b>
              </span>
              <span>
                CPA: <b>{campDetail.cpa != null ? chf(campDetail.cpa, 2) : "—"}</b>
              </span>
              <span>
                ROAS:{" "}
                <b>
                  {campDetail.roas != null
                    ? `${campDetail.roas.toFixed(1).replace(".", ",")}×`
                    : "—"}
                </b>
              </span>
            </div>
          </ModalSection>
          {campDetail.auto ? (
            <ModalSection title="Autopilot-Sicht (letzter Lauf, 30 Tage)" color={C.accent}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px" }}>
                <span>
                  Tagesbudget: <b>{chf(campDetail.auto.dailyBudgetChf, 2)}</b>
                </span>
                <span>
                  Strategie: <b>{campDetail.auto.strategyType}</b>
                  {campDetail.auto.targetRoas ? ` (tROAS ${campDetail.auto.targetRoas})` : ""}
                  {campDetail.auto.targetCpaChf
                    ? ` (tCPA ${chf(campDetail.auto.targetCpaChf)})`
                    : ""}
                </span>
                <span>
                  IS Suche: <b>{pct(campDetail.auto.searchImpressionShare)}</b>
                </span>
                <span>
                  IS-Verlust Budget: <b>{pct(campDetail.auto.budgetLostIs)}</b>
                </span>
                <span>
                  IS-Verlust Rang: <b>{pct(campDetail.auto.rankLostIs)}</b>
                </span>
              </div>
            </ModalSection>
          ) : (
            <ModalSection title="Autopilot-Sicht" color={C.textMuted}>
              Keine Autopilot-Daten zu dieser Kampagne im letzten Lauf (Quelle:
              result.campaignDetail) — «Dry-Run jetzt» ausführen.
            </ModalSection>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <Btn variant="secondary" onClick={() => setCampDetail(null)}>
              Schliessen
            </Btn>
          </div>
        </Modal>
      )}

      {/* Conversion-Aktionen */}
      {tab === "conversions" &&
        (ads?.conversionActions?.length ? (
          <>
            <ScrollTable
              minWidth={480}
              head={["Conversion-Aktion", "Anzahl", "Wert", "Anteil am Wert"]}
              rows={(() => {
                const totalValue = ads.conversionActions.reduce((s, a) => s + (a.value || 0), 0);
                return ads.conversionActions.map((a) => (
                  <tr
                    key={a.name}
                    style={{ borderTop: `1px solid ${C.border}`, color: C.textMuted }}
                  >
                    <td
                      style={{ ...cellStyle, color: C.text, fontWeight: 600, whiteSpace: "normal" }}
                    >
                      {a.name}
                    </td>
                    <td style={cellStyle}>{Math.round(a.count).toLocaleString("de-CH")}</td>
                    <td style={cellStyle}>{a.value > 0 ? chf(a.value) : "—"}</td>
                    <td style={cellStyle}>
                      {totalValue > 0
                        ? `${Math.round(((a.value || 0) / totalValue) * 100)} %`
                        : "—"}
                    </td>
                  </tr>
                ));
              })()}
            />
            <div style={{ fontSize: 11.5, color: C.textDim, marginTop: 8 }}>
              Quelle: google_ads-Snapshot (Ads-Dashboard). Zeitraum wie im Dashboard gewählt.
            </div>
          </>
        ) : (
          <MissingData
            source="audit_runs(google_ads).result.conversionActions"
            action="Im Ads-Dashboard oben «⟳ Aktualisieren» klicken, damit ein frischer google_ads-Snapshot mit Conversion-Aktionen gespeichert wird."
          />
        ))}

      {/* Regionen */}
      {tab === "regions" &&
        (run?.geoTop?.length ? (
          <>
            <ScrollTable
              minWidth={420}
              head={["Region", "Kosten 30T", "Conversions", "Kosten je Conversion"]}
              rows={run.geoTop.map((g) => (
                <tr
                  key={g.location}
                  style={{ borderTop: `1px solid ${C.border}`, color: C.textMuted }}
                >
                  <td style={{ ...cellStyle, color: C.text, fontWeight: 600 }}>{g.location}</td>
                  <td style={cellStyle}>{chf(g.costChf)}</td>
                  <td style={cellStyle}>{Math.round(g.conversions * 10) / 10}</td>
                  <td
                    style={{
                      ...cellStyle,
                      color: g.conversions === 0 && g.costChf > 0 ? C.red : C.textMuted,
                      fontWeight: g.conversions === 0 && g.costChf > 0 ? 600 : 400,
                    }}
                  >
                    {g.conversions > 0
                      ? chf(g.costChf / g.conversions, 2)
                      : g.costChf > 0
                        ? "Geld ohne Ertrag"
                        : "—"}
                  </td>
                </tr>
              ))}
            />
            <div style={{ fontSize: 11.5, color: C.textDim, marginTop: 8 }}>
              Länder-Ebene (geographic_view), Top-Regionen nach Kosten, Fenster 30 Tage. Auffällige
              Regionen erscheinen zusätzlich als Befund «Geld ohne Ertrag (Region)».
            </div>
          </>
        ) : run ? (
          <MissingData
            source="result.geoTop (Autopilot-Lauf, GAQL geographic_view)"
            action="Einmal «Dry-Run jetzt» ausführen — bleibt der Tab leer, hat die geo_performance-Abfrage nicht geliefert (siehe Tab «Tracking-Gesundheit», Datenquellen)."
          />
        ) : (
          noRunHint
        ))}

      {/* Geraete */}
      {tab === "devices" &&
        (run?.deviceSplit?.length ? (
          <>
            <ScrollTable
              minWidth={420}
              head={["Gerät", "Kosten 30T", "Conversions", "Kostenanteil"]}
              rows={(() => {
                const total = run.deviceSplit.reduce((s, d) => s + (d.costChf || 0), 0);
                const NAME = {
                  MOBILE: "Mobil",
                  DESKTOP: "Desktop",
                  TABLET: "Tablet",
                  CONNECTED_TV: "TV",
                  OTHER: "Andere",
                };
                return [...run.deviceSplit]
                  .sort((a, b) => b.costChf - a.costChf)
                  .map((d) => (
                    <tr
                      key={d.device}
                      style={{ borderTop: `1px solid ${C.border}`, color: C.textMuted }}
                    >
                      <td style={{ ...cellStyle, color: C.text, fontWeight: 600 }}>
                        {NAME[d.device] || d.device}
                      </td>
                      <td style={cellStyle}>{chf(d.costChf)}</td>
                      <td style={cellStyle}>{Math.round(d.conversions * 10) / 10}</td>
                      <td style={cellStyle}>
                        {total > 0 ? `${Math.round((d.costChf / total) * 100)} %` : "—"}
                      </td>
                    </tr>
                  ));
              })()}
            />
            <div style={{ fontSize: 11.5, color: C.textDim, marginTop: 8 }}>
              Aggregiert über alle aktiven Kampagnen, Fenster 30 Tage. Auffälligkeiten erscheinen
              zusätzlich als Befund «Geräte-Auffälligkeit».
            </div>
          </>
        ) : run ? (
          <MissingData
            source="result.deviceSplit (Autopilot-Lauf, GAQL segments.device)"
            action="Einmal «Dry-Run jetzt» ausführen — bleibt der Tab leer, hat die device_performance-Abfrage nicht geliefert."
          />
        ) : (
          noRunHint
        ))}

      {/* Gebotsstrategien */}
      {tab === "bidding" &&
        (run?.biddingStrategies?.length ? (
          <>
            <ScrollTable
              minWidth={560}
              head={["Kampagne", "Strategie", "Ziel", "System-Status"]}
              rows={run.biddingStrategies.map((b) => (
                <tr
                  key={b.campaign}
                  style={{ borderTop: `1px solid ${C.border}`, color: C.textMuted }}
                >
                  <td
                    style={{ ...cellStyle, color: C.text, fontWeight: 600, whiteSpace: "normal" }}
                  >
                    {b.campaign}
                  </td>
                  <td style={cellStyle}>{b.strategyType}</td>
                  <td style={cellStyle}>
                    {b.targetRoas
                      ? `tROAS ${b.targetRoas}`
                      : b.targetCpaChf
                        ? `tCPA ${chf(b.targetCpaChf)}`
                        : "—"}
                  </td>
                  <td style={cellStyle}>
                    <Badge
                      color={
                        String(b.systemStatus).includes("LEARNING")
                          ? C.orange
                          : String(b.systemStatus) === "ENABLED"
                            ? C.green
                            : C.textMuted
                      }
                    >
                      {b.systemStatus || "—"}
                    </Badge>
                  </td>
                </tr>
              ))}
            />
            <div style={{ fontSize: 11.5, color: C.textDim, marginTop: 8 }}>
              «LEARNING» = Lernphase: Kampagne wird vom Autopilot nicht angefasst, bis sie stabil
              ist. Ziel-Anpassungen erscheinen als «Offene Massnahmen» (Gebotsziel anpassen), nie
              automatisch.
            </div>
          </>
        ) : run ? (
          <MissingData
            source="result.biddingStrategies (Autopilot-Lauf)"
            action="Einmal «Dry-Run jetzt» ausführen, dann erscheint die Strategie-Übersicht."
          />
        ) : (
          noRunHint
        ))}

      {/* Suchbegriffsverluste */}
      {tab === "searchterms" &&
        (run?.semanticCandidates?.length ? (
          <>
            <div style={{ fontSize: 12.5, color: C.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
              Suchbegriffe mit Kosten, aber <b>0 Conversions</b> im Conversion-Lag-Fenster —
              Kandidaten für Ausschlüsse. Vorschläge daraus erscheinen unter «Wartet auf Freigabe»;
              hier ist die vollständige Verlustliste.
            </div>
            <ScrollTable
              minWidth={640}
              head={["Suchbegriff", "Kampagne", "Anzeigengruppe", "Kosten", "Klicks"]}
              rows={run.semanticCandidates.slice(0, 50).map((t, i) => (
                <tr
                  key={`${t.term}-${i}`}
                  style={{ borderTop: `1px solid ${C.border}`, color: C.textMuted }}
                >
                  <td
                    style={{ ...cellStyle, color: C.text, fontWeight: 600, whiteSpace: "normal" }}
                  >
                    {t.term}
                  </td>
                  <td style={{ ...cellStyle, whiteSpace: "normal" }}>{t.campaign}</td>
                  <td style={{ ...cellStyle, whiteSpace: "normal" }}>{t.adGroup}</td>
                  <td style={{ ...cellStyle, color: C.red, fontWeight: 600 }}>
                    {chf(t.costChf, 2)}
                  </td>
                  <td style={cellStyle}>{t.clicks}</td>
                </tr>
              ))}
            />
            {run.semanticCandidates.length > 50 && (
              <div style={{ fontSize: 11.5, color: C.textDim, marginTop: 8 }}>
                Zeigt die 50 teuersten von {run.semanticCandidates.length} Begriffen.
              </div>
            )}
          </>
        ) : run ? (
          run.semanticCandidates ? (
            <div style={{ fontSize: 13, color: C.textMuted }}>
              Keine Suchbegriffe mit Kosten ohne Conversions im letzten Lauf — kein erkennbarer
              Streuverlust.
            </div>
          ) : (
            <MissingData
              source="result.semanticCandidates (Autopilot-Lauf)"
              action="Der letzte gespeicherte Lauf ist älter als dieses Feld — einmal «Dry-Run jetzt» ausführen."
            />
          )
        ) : (
          noRunHint
        ))}

      {/* Budget-Pacing */}
      {tab === "pacing" &&
        (() => {
          const p = run?.budgetPacing;
          if (!run) return noRunHint;
          if (!p)
            return (
              <MissingData
                source="result.budgetPacing (Autopilot-Lauf)"
                action="Der letzte Lauf enthält kein Pacing (älterer Lauf oder MTD-Abfrage fehlgeschlagen — siehe Tab «Tracking-Gesundheit», Abschnitt Datenquellen). Einmal «Dry-Run jetzt» ausführen."
              />
            );
          if (p.status === "no_budget")
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <Banner color={C.orange} colorDim={C.orangeDim}>
                  <b>Monatsbudget nicht gepflegt.</b> Für diesen Kunden ist kein Soll-Budget
                  hinterlegt — der Pacing-Check kann den Ist-Spend ({chf(p.mtdSpendChf)} seit
                  Monatsbeginn) nicht gegen ein Soll stellen. Owner/Admin: oben «Konfigurieren»
                  öffnen und «Monatsbudget (CHF)» setzen.
                </Banner>
                {p.forecastEomChf != null && (
                  <div style={{ fontSize: 13, color: C.textMuted }}>
                    Lineare Prognose bis Monatsende (nur aus Ist-Spend):{" "}
                    <b style={{ color: C.text }}>{chf(p.forecastEomChf)}</b>
                  </div>
                )}
              </div>
            );
          const ratioPct = p.pacingRatio != null ? Math.round(p.pacingRatio * 100) : null;
          const statusInfo = {
            under: { label: "Unterpacing", color: C.blue },
            on_track: { label: "Im Plan", color: C.green },
            over: { label: "Überpacing", color: C.red },
          }[p.status];
          const spendPct = p.monthlyBudgetChf
            ? Math.min(100, (p.mtdSpendChf / p.monthlyBudgetChf) * 100)
            : 0;
          const expectedPct = p.monthlyBudgetChf
            ? Math.min(100, ((p.expectedToDateChf || 0) / p.monthlyBudgetChf) * 100)
            : 0;
          const forecastOver =
            p.forecastEomChf != null &&
            p.monthlyBudgetChf != null &&
            p.forecastEomChf > p.monthlyBudgetChf * 1.05;
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <Badge color={statusInfo.color}>{statusInfo.label}</Badge>
                <span style={{ fontSize: 13, color: C.textMuted }}>
                  Tag {p.elapsedDays} von {p.daysInMonth} — Budget-Quelle:{" "}
                  {p.budgetSource === "client"
                    ? "gepflegtes Soll-Budget"
                    : `abgeleitet (${p.budgetSource})`}
                </span>
              </div>
              {p.budgetSource !== "client" && (
                <Banner color={C.orange} colorDim={C.orangeDim}>
                  <b>Budget nicht bestätigt.</b> Das Monatsbudget ist aus{" "}
                  {p.budgetSource === "account"
                    ? "den aktuellen Tagesbudgets des Kontos"
                    : "historischem Spend"}{" "}
                  abgeleitet — der Pacing-Check meldet deshalb nur Beobachtungen, keine bestätigten
                  Überschreitungen. Owner/Admin: oben «Konfigurieren» öffnen und das Soll-Budget
                  unter «Monatsbudget (CHF)» bestätigen.
                </Banner>
              )}
              <div
                className="dash-kpis"
                style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}
              >
                {[
                  { l: "Ausgegeben (MTD)", v: chf(p.mtdSpendChf) },
                  {
                    l: "Soll bis heute",
                    v: p.expectedToDateChf != null ? chf(p.expectedToDateChf) : "—",
                  },
                  { l: "Monatsbudget", v: chf(p.monthlyBudgetChf) },
                  {
                    l: "Prognose Monatsende",
                    v: p.forecastEomChf != null ? chf(p.forecastEomChf) : "—",
                    warn: forecastOver,
                  },
                ].map((k) => (
                  <div
                    key={k.l}
                    style={{
                      background: C.surface,
                      border: `1px solid ${C.border}`,
                      borderRadius: 10,
                      padding: "12px 14px",
                    }}
                  >
                    <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 5 }}>{k.l}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: k.warn ? C.red : C.text }}>
                      {k.v}
                    </div>
                  </div>
                ))}
              </div>
              <div>
                <div
                  style={{
                    position: "relative",
                    height: 12,
                    background: C.bg,
                    borderRadius: 8,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${spendPct}%`,
                      background: statusInfo.color,
                      borderRadius: 8,
                      transition: "width .3s",
                    }}
                  />
                  <div
                    title="Soll bis heute"
                    style={{
                      position: "absolute",
                      top: -2,
                      bottom: -2,
                      left: `${expectedPct}%`,
                      width: 2,
                      background: C.text,
                    }}
                  />
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 11.5,
                    color: C.textDim,
                    marginTop: 4,
                  }}
                >
                  <span>
                    {ratioPct != null ? `${ratioPct} % des anteiligen Solls ausgegeben` : ""}
                  </span>
                  <span>Markierung = Soll bis heute</span>
                </div>
              </div>
              {p.status !== "on_track" && (
                <div style={{ fontSize: 12.5, color: C.textMuted, lineHeight: 1.55 }}>
                  {p.status === "under"
                    ? "Unterpacing: Es wird deutlich weniger ausgegeben als geplant — mögliche Ursachen: Budgetlimits, schwache Auslieferung (Rang/Qualität) oder Saison. Details im Tab «Kampagnen» (IS-Verluste)."
                    : "Überpacing: Bei gleichem Tempo wird das Monatsbudget überschritten. Prüfen, ob das gewollt ist (Saison) oder Tagesbudgets angepasst werden sollten — Vorschläge dazu erscheinen als Freigabe-Punkte, nie automatisch."}
                </div>
              )}
            </div>
          );
        })()}

      {/* Tracking-Gesundheit */}
      {tab === "tracking" &&
        (() => {
          if (!run) return noRunHint;
          const t = run.trackingHealth;
          if (!t)
            return (
              <MissingData
                source="result.trackingHealth (Autopilot-Lauf)"
                action="Einmal «Dry-Run jetzt» ausführen — der Lauf misst dann Spend/Conversions (7 Tage) gegen die 30-Tage-Baseline."
              />
            );
          const info =
            t.status === "OK"
              ? {
                  color: C.green,
                  dim: C.greenDim,
                  label: "OK",
                  text: "Conversions kommen an — keine Auffälligkeit im Vergleich zur Baseline.",
                }
              : t.status === "BROKEN"
                ? {
                    color: C.red,
                    dim: C.redDim,
                    label: "Tracking-Verdacht",
                    text: "Es läuft Spend auf, aber es kommen keine Conversions an, obwohl die Baseline welche zeigt. ALLE Schreib-Operationen des Autopiloten sind blockiert, bis das geklärt ist (Conversion-Tag/GA4-Import prüfen).",
                  }
                : {
                    color: C.orange,
                    dim: C.orangeDim,
                    label: "Keine Baseline",
                    text: "Zu wenige Conversions in der 30-Tage-Baseline, um einen Ausfall zuverlässig zu erkennen — der Check ist informativ, blockiert aber nichts.",
                  };
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Banner color={info.color} colorDim={info.dim}>
                <b>{info.label}.</b> {info.text}
              </Banner>
              <div
                className="dash-kpis"
                style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}
              >
                {[
                  { l: "Spend letzte 7 Tage", v: chf(t.spend7d, 2) },
                  {
                    l: "Conversions letzte 7 Tage",
                    v: String(Math.round(t.conversions7d * 10) / 10),
                  },
                  {
                    l: "Baseline (Tag −37 bis −8)",
                    v: `${Math.round(t.conversionsBaseline30d * 10) / 10} Conv.`,
                  },
                ].map((k) => (
                  <div
                    key={k.l}
                    style={{
                      background: C.surface,
                      border: `1px solid ${C.border}`,
                      borderRadius: 10,
                      padding: "12px 14px",
                    }}
                  >
                    <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 5 }}>{k.l}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{k.v}</div>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 6 }}>
                  Datenquellen des letzten Laufs
                </div>
                {run.dataSourceErrors?.length ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {run.dataSourceErrors.map((e, i) => (
                      <div
                        key={i}
                        style={{
                          fontSize: 12,
                          color: C.orange,
                          background: C.orangeDim,
                          borderRadius: 8,
                          padding: "7px 10px",
                          wordBreak: "break-word",
                        }}
                      >
                        Nicht geliefert: {e}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12.5, color: C.textMuted }}>
                    Alle Zusatzquellen haben geliefert — keine fehlenden API-Abfragen.
                  </div>
                )}
              </div>
            </div>
          );
        })()}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Haupt-Panel
// ─────────────────────────────────────────────────────────────────────────────
export default function AdsAutopilotPanel({ selectedClient }) {
  const clientId = selectedClient?.id;
  const {
    config,
    approvals,
    changelog,
    recommendations,
    configHistory,
    autopilotRun,
    loading,
    error,
    busyId,
    refresh,
    decide,
    runDryRun,
    markRecommendation,
    saveConfig,
  } = useEzyAdsAutopilot(clientId, 80);
  const { role } = useAuth();
  const canConfigure = canConfigureAutopilot(role);
  const canDecide = role !== "viewer";
  const adsRun = useEzyLatestRun(clientId, "google_ads");
  const adsSnapshot = googleAdsFromResult(adsRun.run?.result);
  const [detail, setDetail] = React.useState(null);
  const [findingDetail, setFindingDetail] = React.useState(null);
  const [recoDetail, setRecoDetail] = React.useState(null);
  const [showConfig, setShowConfig] = React.useState(false);

  if (!clientId) return null;

  // Nur aktuelle Empfehlungen zeigen: abgelaufene pending-Eintraege ausblenden.
  const activeApprovals = approvals.filter(
    (a) => !a.expires_at || new Date(a.expires_at).getTime() > Date.now(),
  );

  // Befunde des letzten Laufs (report-only-Zeilen des juengsten Runs mit welchen);
  // config_change-Zeilen sind bereits hook-seitig ausgefiltert.
  const reportRows = changelog.filter(
    (c) => c.action_class === "report-only" && c.status === "report-only",
  );
  const latestFindingRun = reportRows.length ? reportRows[0].run_id : null;
  const findings = reportRows.filter((c) => c.run_id === latestFindingRun);
  const findingGroups = findings.reduce((m, f) => {
    const g = findingGroup(f.action_type);
    (m[g] = m[g] || []).push(f);
    return m;
  }, {});
  const changeRows = changelog.filter(
    (c) => !(c.action_class === "report-only" && c.status === "report-only"),
  );

  const observeOnly = config?.observe_only !== false; // Default sicher: an
  const lastConfigChange = configHistory[0] || null;

  const configItems = [
    {
      l: "Beobachtungsmodus",
      v: observeOnly ? "An — nur dokumentieren" : "Aus — Ausführung möglich",
      color: observeOnly ? C.blue : C.orange,
    },
    {
      l: "Kill-Switch",
      v: config?.kill_switch ? "AKTIV — alles gestoppt" : "Inaktiv",
      color: config?.kill_switch ? C.red : C.green,
    },
    { l: "Autonomie-Level", v: AUTONOMY_LABELS[config?.autonomy_level ?? 0] },
    {
      l: "Monatsbudget",
      v: config?.monthly_budget_chf ? chf(config.monthly_budget_chf) : "nicht gepflegt",
      color: config?.monthly_budget_chf ? undefined : C.orange,
    },
    { l: "Ziel-CPA", v: config?.target_cpa_chf ? chf(config.target_cpa_chf) : "—" },
    { l: "Ziel-ROAS", v: config?.target_roas ? `${config.target_roas}×` : "—" },
    {
      l: "Geschützte Kampagnen",
      v: config?.no_touch_campaigns?.length ? config.no_touch_campaigns.join(", ") : "keine",
    },
    {
      l: "Hochsaison",
      v: config?.season_high?.length ? config.season_high.join(", ") : "nicht gepflegt",
    },
    {
      l: "Nebensaison",
      v: config?.season_low?.length ? config.season_low.join(", ") : "nicht gepflegt",
    },
    {
      l: "Erlaubte Änderungsklassen",
      v:
        changeClassMatrix(config?.autonomy_level ?? 0)
          .filter((r) => r.verhalten === "automatisch")
          .map((r) => r.klasse)
          .join(", ") || "keine (alles wartet auf Freigabe)",
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 20 }}>
      {/* Kopf */}
      <Card>
        <div
          className="mobile-wrap"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Google Ads Autopilot</div>
            <div style={{ fontSize: 13, color: C.textMuted, marginTop: 2 }}>
              Teilautonom: Nur die freigegebene Klasse wird ausgeführt — alles Übrige wartet auf
              Freigabe.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {observeOnly && <Badge color={C.blue}>Beobachtungsmodus</Badge>}
            <Badge color={C.textMuted}>Autonomie {config?.autonomy_level ?? 0}</Badge>
            {config?.kill_switch && <Badge color={C.red}>Kill-Switch aktiv</Badge>}
            <Btn variant="secondary" onClick={() => runDryRun()} disabled={loading}>
              {loading ? "Läuft…" : "Dry-Run jetzt"}
            </Btn>
            <Btn variant="secondary" onClick={() => refresh()} disabled={loading}>
              Aktualisieren
            </Btn>
            {canConfigure && <Btn onClick={() => setShowConfig(true)}>Konfigurieren</Btn>}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          {config?.kill_switch && (
            <Banner color={C.red} colorDim={C.redDim}>
              Kill-Switch ist aktiv — der Autopilot führt für diesen Kunden keine Änderungen aus und
              überspringt Läufe komplett. Auch bereits erteilte Freigaben werden nicht ausgeführt.
            </Banner>
          )}
          {observeOnly && (
            <Banner color={C.blue} colorDim={C.blueDim}>
              Beobachtungsmodus: Der Autopilot dokumentiert nur Massnahmen und Empfehlungen — es
              werden unter keinen Umständen Änderungen an Google Ads vorgenommen (unabhängig vom
              Autonomie-Level). Freigaben sind gesperrt, bis der Beobachtungsmodus nach
              Qualitätsprüfung deaktiviert wird.
            </Banner>
          )}
          {error && (
            <Banner color={C.red} colorDim={C.redDim}>
              Fehler: {error}
            </Banner>
          )}
          {!config && !loading && (
            <Banner color={C.orange} colorDim={C.orangeDim}>
              Für diesen Kunden ist noch keine Autopilot-Konfiguration hinterlegt — es gelten die
              sicheren Standardwerte (Beobachtungsmodus an, Autonomie 0: nichts wird geändert).{" "}
              {canConfigure
                ? "Mit «Konfigurieren» legst du sie an."
                : "Ein Owner/Admin kann sie über «Konfigurieren» anlegen."}
            </Banner>
          )}
        </div>
      </Card>

      {/* Konfiguration */}
      <Card>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <SectionTitle
            title="Konfiguration"
            hint="Pro Kunde. Änderungen nur durch Owner/Admin, mit Zusammenfassung und Bestätigung."
          />
          {canConfigure && (
            <Btn variant="secondary" size="sm" onClick={() => setShowConfig(true)}>
              Bearbeiten
            </Btn>
          )}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 10,
          }}
        >
          {configItems.map((it) => (
            <div
              key={it.l}
              style={{
                background: C.surface,
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                padding: "10px 12px",
              }}
            >
              <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 4 }}>{it.l}</div>
              <div
                style={{
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: it.color || C.text,
                  overflowWrap: "anywhere",
                }}
              >
                {it.v}
              </div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: C.textDim, marginTop: 10, lineHeight: 1.5 }}>
          {lastConfigChange ? (
            <>
              Zuletzt geändert am {dateCH(lastConfigChange.created_at)} von{" "}
              <b style={{ color: C.textMuted }}>{lastConfigChange.approved_by || "unbekannt"}</b>
              {lastConfigChange.rationale ? <> — {lastConfigChange.rationale}</> : null}
            </>
          ) : config?.updated_at ? (
            <>
              Zuletzt geändert am {dateCH(config.updated_at)} (vor Einführung des
              Änderungsprotokolls).
            </>
          ) : (
            <>Noch nie geändert — es gelten die sicheren Standardwerte.</>
          )}
        </div>
        {configHistory.length > 1 && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ fontSize: 12, color: C.accent, cursor: "pointer" }}>
              Frühere Konfigurations-Änderungen ({configHistory.length - 1})
            </summary>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
              {configHistory.slice(1).map((h) => (
                <div key={h.id} style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.5 }}>
                  {dateCH(h.created_at)} — {h.approved_by || "unbekannt"}: {h.rationale || "—"}
                </div>
              ))}
            </div>
          </details>
        )}
      </Card>

      {/* Freigaben */}
      <Card>
        <SectionTitle
          title={observeOnly ? "Empfehlungen (Dokumentation)" : "Wartet auf Freigabe"}
          count={activeApprovals.length}
          hint="Vor jeder Freigabe sichtbar: aktueller Wert, vorgeschlagener Wert, Begründung, erwartete Wirkung und Ablaufdatum."
        />
        {activeApprovals.length === 0 && (
          <div style={{ fontSize: 13, color: C.textDim }}>Keine offenen Freigaben.</div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {activeApprovals.map((a) => {
            const rest = daysUntil(a.expires_at);
            return (
              <div
                key={a.id}
                onClick={() => setDetail(a)}
                title="Klicken für Erklärung und Details"
                style={{
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  padding: 12,
                  cursor: "pointer",
                  background: C.surface,
                }}
              >
                <div
                  className="mobile-wrap"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ minWidth: 0, flex: "1 1 320px" }}>
                    <div
                      style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
                    >
                      <Badge>{typeLabel(a.type)}</Badge>
                      <span style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>
                        {a.entity || "—"}
                      </span>
                    </div>
                    {(a.current_value || a.proposed_value) && (
                      <div style={{ fontSize: 13, color: C.textMuted, marginTop: 6 }}>
                        {a.current_value || "—"} <span style={{ color: C.textDim }}>→</span>{" "}
                        <b style={{ color: C.text }}>{a.proposed_value || "—"}</b>
                      </div>
                    )}
                    {a.rationale && (
                      <div
                        style={{ fontSize: 12, color: C.textMuted, marginTop: 4, lineHeight: 1.5 }}
                      >
                        {a.rationale}
                      </div>
                    )}
                    {a.estimated_impact && (
                      <div style={{ fontSize: 12, color: C.accent, marginTop: 4 }}>
                        Erwartet: {a.estimated_impact}
                      </div>
                    )}
                    <div
                      style={{
                        fontSize: 11.5,
                        color: rest !== null && rest <= 2 ? C.orange : C.textDim,
                        marginTop: 6,
                      }}
                    >
                      {a.expires_at
                        ? `Läuft ab am ${dateCH(a.expires_at)}${rest !== null ? ` (noch ${Math.max(rest, 0)} Tag${rest === 1 ? "" : "e"})` : ""}`
                        : "Kein Ablaufdatum"}{" "}
                      · Klicken für Details
                    </div>
                  </div>
                  {canDecide && (
                    <div
                      style={{ display: "flex", gap: 8, alignItems: "flex-start" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Btn
                        variant="success"
                        size="sm"
                        disabled={busyId === a.id || observeOnly}
                        title={
                          observeOnly ? "Beobachtungsmodus aktiv — Freigaben gesperrt" : undefined
                        }
                        onClick={() => decide(a.id, "approve")}
                      >
                        {busyId === a.id ? "…" : observeOnly ? "Gesperrt" : "Freigeben"}
                      </Btn>
                      <Btn
                        variant="danger"
                        size="sm"
                        disabled={busyId === a.id}
                        onClick={() => decide(a.id, "reject")}
                      >
                        Ablehnen
                      </Btn>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Offene Massnahmen */}
      <Card>
        <SectionTitle
          title="Offene Massnahmen"
          count={recommendations.length}
          hint="Empfehlungen der Analyse-Module. Umsetzung erfolgt manuell — hier nur den Status pflegen (nichts wird an Google Ads geschrieben)."
        />
        {recommendations.length === 0 && (
          <div style={{ fontSize: 13, color: C.textDim }}>Keine offenen Massnahmen.</div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {recommendations.map((r) => (
            <div
              key={r.id}
              onClick={() => setRecoDetail(r)}
              title="Klicken für Erklärung: Problem & was zu tun ist"
              style={{
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                padding: 12,
                cursor: "pointer",
                background: C.surface,
              }}
            >
              <div
                className="mobile-wrap"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ minWidth: 0, flex: "1 1 320px" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <Badge color={C.green}>{recoLabel(r.recommendation_type)}</Badge>
                    <span style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>{r.title}</span>
                  </div>
                  <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>{r.entity}</div>
                  {r.expected_impact && (
                    <div style={{ fontSize: 12, color: C.accent, marginTop: 4 }}>
                      Erwartet: {r.expected_impact}
                    </div>
                  )}
                  <div style={{ fontSize: 11.5, color: C.textDim, marginTop: 6 }}>
                    Klicken für Erklärung &amp; Details
                  </div>
                </div>
                {canDecide && (
                  <div
                    style={{ display: "flex", gap: 8, alignItems: "flex-start" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Btn
                      variant="success"
                      size="sm"
                      disabled={busyId === r.id}
                      onClick={() => {
                        const note = window.prompt("Umgesetzt — optionale Notiz (was/wann):", "");
                        if (note === null) return;
                        void markRecommendation(r.id, "implemented", note || undefined);
                      }}
                    >
                      {busyId === r.id ? "…" : "Umgesetzt"}
                    </Btn>
                    <Btn
                      variant="danger"
                      size="sm"
                      disabled={busyId === r.id}
                      onClick={() => {
                        const note = window.prompt(
                          "Verworfen — warum? (Pflicht für den Verlauf):",
                          "",
                        );
                        if (note === null) return;
                        void markRecommendation(r.id, "dismissed", note || undefined);
                      }}
                    >
                      Verworfen
                    </Btn>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Detailanalyse-Drilldowns */}
      <DetailAnalysis autopilotRun={autopilotRun} adsSnapshot={adsSnapshot} />

      {/* Befunde des letzten Laufs */}
      <Card>
        <SectionTitle
          title="Befunde des letzten Laufs"
          count={findings.length}
          hint={`Beobachtungen aus ${latestFindingRun || "—"} — der Autopilot ändert hier nichts automatisch; Details per Klick.`}
        />
        {findings.length === 0 && (
          <div style={{ fontSize: 13, color: C.textDim }}>
            Noch keine Befunde gespeichert — sie erscheinen ab dem nächsten Lauf.
          </div>
        )}
        {Object.entries(findingGroups).map(([gruppe, rows]) => (
          <div key={gruppe} style={{ marginBottom: 10 }}>
            <div
              style={{
                fontSize: 11.5,
                fontWeight: 700,
                color: C.textMuted,
                textTransform: "uppercase",
                letterSpacing: 0.5,
                margin: "8px 0 6px",
              }}
            >
              {gruppe} ({rows.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {rows.map((f) => (
                <div
                  key={f.id}
                  onClick={() => setFindingDetail(f)}
                  title="Klicken für Erklärung"
                  style={{
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    padding: "8px 12px",
                    cursor: "pointer",
                    display: "flex",
                    gap: 10,
                    alignItems: "baseline",
                    flexWrap: "wrap",
                    background: C.surface,
                  }}
                >
                  <Badge color={C.blue}>{typeLabel(f.action_type)}</Badge>
                  <span style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>
                    {f.entity || "—"}
                  </span>
                  <span
                    style={{
                      color: C.textMuted,
                      fontSize: 12,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: 480,
                    }}
                  >
                    {f.rationale || ""}
                  </span>
                  {f.recommendation && (
                    <span
                      style={{
                        flexBasis: "100%",
                        color: C.green,
                        fontSize: 12,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      → {f.recommendation}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </Card>

      {/* Aenderungs-Log */}
      <Card>
        <SectionTitle
          title="Änderungs-Log"
          hint="Jeder Eingriff und jede Queue-Entscheidung des Autopiloten — Konfigurations-Änderungen stehen oben in der Konfigurations-Karte."
        />
        {changeRows.length === 0 && (
          <div style={{ fontSize: 13, color: C.textDim }}>Noch keine Einträge.</div>
        )}
        {changeRows.length > 0 && (
          <ScrollTable
            minWidth={640}
            head={["Datum", "Aktion", "Entity", "Status", "Begründung"]}
            rows={changeRows.map((c) => (
              <tr key={c.id} style={{ borderTop: `1px solid ${C.border}`, color: C.textMuted }}>
                <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{dateCH(c.created_at)}</td>
                <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{c.action_type}</td>
                <td style={{ padding: "6px 8px", color: C.text }}>{c.entity || "—"}</td>
                <td style={{ padding: "6px 8px" }}>
                  <StatusBadge status={c.status} />
                </td>
                <td style={{ padding: "6px 8px", maxWidth: 360 }}>{c.rationale || "—"}</td>
              </tr>
            ))}
          />
        )}
      </Card>

      {/* Modals */}
      {showConfig && (
        <ConfigModal
          config={config}
          busy={busyId === "config"}
          onSave={saveConfig}
          onClose={() => setShowConfig(false)}
        />
      )}

      <ApprovalDetailModal
        approval={detail}
        observeOnly={observeOnly}
        canDecide={canDecide}
        busy={detail ? busyId === detail.id : false}
        onClose={() => setDetail(null)}
        onDecide={async (decision) => {
          if (!detail) return;
          await decide(detail.id, decision);
          setDetail(null);
        }}
      />

      {recoDetail && (
        <Modal title={recoDetail.title} onClose={() => setRecoDetail(null)} maxWidth={600}>
          <div
            style={{
              marginTop: 6,
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <Badge color={C.green}>{recoLabel(recoDetail.recommendation_type)}</Badge>
            <span style={{ fontSize: 12, color: C.textMuted }}>{recoDetail.entity}</span>
          </div>
          <ModalSection title="Was ist das Problem?" color={C.orange}>
            {RECO_INFO[recoDetail.recommendation_type]?.problem || "—"}
          </ModalSection>
          <ModalSection title="Was ist zu tun?" color={C.green}>
            {RECO_INFO[recoDetail.recommendation_type]?.todo || "Siehe vorgeschlagene Massnahme."}
            <div style={{ color: C.textMuted, marginTop: 6 }}>
              <b style={{ color: C.text }}>Konkret hier:</b> {recoDetail.title}
            </div>
          </ModalSection>
          {recoDetail.rationale && (
            <ModalSection title="Begründung & Datenlage">{recoDetail.rationale}</ModalSection>
          )}
          {recoDetail.expected_impact && (
            <ModalSection title="Erwartete Wirkung" color={C.accent}>
              {recoDetail.expected_impact}
            </ModalSection>
          )}
          <ModalSection title="Herkunft & Ablauf" color={C.textMuted}>
            Erstmals erkannt am {dateCH(recoDetail.created_at)}, zuletzt bestätigt im Lauf{" "}
            {recoDetail.last_seen_run}. Die Umsetzung ist manuell — der Autopilot ändert hier
            nichts. Nach der Umsetzung «Umgesetzt» markieren, dann misst der Autopilot die Wirkung
            (14/30 Tage) und weist ein Ergebnis aus.
          </ModalSection>
          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
              marginTop: 18,
              flexWrap: "wrap",
            }}
          >
            <Btn variant="secondary" onClick={() => setRecoDetail(null)}>
              Schliessen
            </Btn>
            {canDecide && (
              <>
                <Btn
                  variant="danger"
                  disabled={busyId === recoDetail.id}
                  onClick={async () => {
                    const note = window.prompt("Verworfen — warum? (Pflicht für den Verlauf):", "");
                    if (note === null) return;
                    await markRecommendation(recoDetail.id, "dismissed", note || undefined);
                    setRecoDetail(null);
                  }}
                >
                  Verworfen
                </Btn>
                <Btn
                  variant="success"
                  disabled={busyId === recoDetail.id}
                  onClick={async () => {
                    const note = window.prompt("Umgesetzt — optionale Notiz (was/wann):", "");
                    if (note === null) return;
                    await markRecommendation(recoDetail.id, "implemented", note || undefined);
                    setRecoDetail(null);
                  }}
                >
                  {busyId === recoDetail.id ? "…" : "Umgesetzt"}
                </Btn>
              </>
            )}
          </div>
        </Modal>
      )}

      {findingDetail && (
        <Modal title={findingDetail.entity || "Befund"} onClose={() => setFindingDetail(null)}>
          <div style={{ marginTop: 6 }}>
            <Badge color={C.blue}>{typeLabel(findingDetail.action_type)}</Badge>
          </div>
          <ModalSection title="Was wurde beobachtet?">
            {findingDetail.rationale || "Keine Begründung hinterlegt."}
          </ModalSection>
          {(findingDetail.before_value || findingDetail.after_value) && (
            <ModalSection title="Werte">
              {findingDetail.before_value || "—"}{" "}
              {findingDetail.after_value ? (
                <>
                  <span style={{ color: C.textDim }}>→</span>{" "}
                  <b style={{ color: C.text }}>{findingDetail.after_value}</b>
                </>
              ) : null}
            </ModalSection>
          )}
          <ModalSection title="Empfohlene Massnahme" color={C.green}>
            {findingDetail.recommendation ||
              "Für diesen Befund wurde noch keine Massnahme formuliert (Lauf vor der Umstellung) — der nächste Lauf liefert sie mit."}
          </ModalSection>
          <ModalSection title="Einordnung" color={C.textMuted}>
            Reiner Befund aus Lauf {findingDetail.run_id} vom {dateCH(findingDetail.created_at)} —
            der Autopilot ändert hier nichts automatisch. Der Punkt fliesst in Report, Vault-Doku
            und Monats-Audit ein; eine Umsetzung wäre ein manueller Schritt oder ein späterer
            Freigabe-Vorschlag.
          </ModalSection>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
            <Btn variant="secondary" onClick={() => setFindingDetail(null)}>
              Schliessen
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
