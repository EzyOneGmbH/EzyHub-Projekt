import React from "react";
import { useEzyAdsAutopilot } from "./data/useEzyAdsAutopilot";

// Google Ads Autopilot panel: config summary, pending approval queue (Approve/
// Reject), recent changelog. Reads via Supabase RLS; mutates via user-authed
// /api/google/ads-autopilot-* endpoints. Self-contained inline styling to match
// the EzyOneApp dark theme without depending on its local palette.

const P = {
  card: "#181923",
  border: "#252636",
  text: "#e2e4f0",
  textMuted: "#8b8da3",
  textDim: "#5c5e72",
  accent: "#6c5ce7",
  green: "#10b981",
  greenDim: "rgba(16,185,129,0.12)",
  red: "#ef4444",
  redDim: "rgba(239,68,68,0.12)",
  blue: "#3b82f6",
  blueDim: "rgba(59,130,246,0.12)",
  orange: "#f59e0b",
  orangeDim: "rgba(245,158,11,0.12)",
};

const STATUS_COLOR = {
  executed: P.green,
  approved: P.green,
  "dry-run": P.blue,
  pending: P.orange,
  failed: P.red,
  rejected: P.red,
  expired: P.textDim,
};

function Badge({ children, color = P.accent, bg }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 600,
        color,
        background: bg || "rgba(108,92,231,0.15)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function StatusBadge({ status }) {
  const color = STATUS_COLOR[status] || P.textMuted;
  return <Badge color={color} bg={`${color}22`}>{status}</Badge>;
}

function Btn({ children, onClick, disabled, variant }) {
  const styles =
    variant === "approve"
      ? { color: P.green, background: P.greenDim, border: `1px solid ${P.green}55` }
      : variant === "reject"
        ? { color: P.red, background: P.redDim, border: `1px solid ${P.red}55` }
        : { color: P.text, background: "transparent", border: `1px solid ${P.border}` };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "6px 12px",
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        ...styles,
      }}
    >
      {children}
    </button>
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
    action: (a) =>
      `Bei Freigabe wird dieser Suchbegriff als «auszuschliessendes Keyword» hinterlegt. Die Anzeige erscheint dann nicht mehr, wenn jemand genau danach sucht — das Budget fliesst stattdessen in Suchanfragen, die tatsächlich Buchungen bringen. Der Begriff hat Geld gekostet, aber keine einzige Buchung gebracht.`,
  },
  negative_keyword_semantic: {
    label: "Suchbegriff ausschliessen (KI-geprüft)",
    action: (a) =>
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

// Report-only-Befunde: deutsche Labels + Laien-Erklaerung, was der Befund bedeutet.
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
};
const findingGroup = (t) => FINDING_INFO[t]?.gruppe || "Weitere";

function daysUntil(iso) {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

// Popup: warum wurde die Empfehlung erzeugt + was wird bei Freigabe gemacht.
function ApprovalDetailModal({ approval: a, observeOnly, busy, onDecide, onClose }) {
  if (!a) return null;
  const info = TYPE_INFO[a.type];
  const rest = daysUntil(a.expires_at);
  const section = (title, body, color) => (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: P.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {title}
      </div>
      <div style={{ fontSize: 13, color: color || P.text, marginTop: 4, lineHeight: 1.55 }}>{body}</div>
    </div>
  );
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000, background: "rgba(10,10,16,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: P.card, border: `1px solid ${P.border}`, borderRadius: 14,
          padding: 20, maxWidth: 560, width: "100%", maxHeight: "85vh", overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <Badge>{typeLabel(a.type)}</Badge>
            <div style={{ fontSize: 15, fontWeight: 700, color: P.text, marginTop: 8 }}>{a.entity || "-"}</div>
            {(a.current_value || a.proposed_value) && (
              <div style={{ fontSize: 13, color: P.textMuted, marginTop: 4 }}>
                {a.current_value ? `${a.current_value} ` : ""}
                {a.proposed_value ? <span style={{ color: P.text }}>-&gt; {a.proposed_value}</span> : null}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{ background: "transparent", border: "none", color: P.textMuted, fontSize: 20, cursor: "pointer", lineHeight: 1 }}
            aria-label="Schliessen"
          >
            ×
          </button>
        </div>

        {section("Warum gibt es diese Empfehlung?", a.rationale || "Keine Begründung hinterlegt.")}
        {section(
          "Was wird bei Freigabe gemacht?",
          info ? info.action(a) : "Bei Freigabe wird die vorgeschlagene Änderung umgesetzt; bei Ablehnung passiert nichts.",
        )}
        {a.estimated_impact && section("Erwartete Wirkung", a.estimated_impact, P.accent)}
        {section(
          "Fristen & Herkunft",
          <>
            Erstellt am {new Date(a.created_at).toLocaleDateString("de-CH")} (Lauf {a.run_id || "?"}).{" "}
            {a.expires_at ? (
              <span style={{ color: rest !== null && rest <= 2 ? P.orange : P.textMuted }}>
                Läuft ab am {new Date(a.expires_at).toLocaleDateString("de-CH")}
                {rest !== null ? ` — noch ${Math.max(rest, 0)} Tag${rest === 1 ? "" : "e"}` : ""}.
              </span>
            ) : (
              "Kein Ablaufdatum."
            )}{" "}
            Ohne Entscheid verfällt die Empfehlung automatisch — es wird dann nichts verändert.
          </>,
          P.textMuted,
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
          <Btn onClick={onClose}>Schliessen</Btn>
          <Btn variant="reject" disabled={busy} onClick={() => onDecide("reject")}>Ablehnen</Btn>
          <Btn variant="approve" disabled={busy || observeOnly} onClick={() => onDecide("approve")}>
            {observeOnly ? "Freigabe gesperrt" : "Freigeben"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

export default function AdsAutopilotPanel({ selectedClient }) {
  const clientId = selectedClient?.id;
  const { config, approvals, changelog, loading, error, busyId, refresh, decide, runDryRun } =
    useEzyAdsAutopilot(clientId, 80); // Befunde (~15/Lauf) + Eingriffe brauchen mehr als 30 Zeilen
  const [detail, setDetail] = React.useState(null);
  const [findingDetail, setFindingDetail] = React.useState(null);

  if (!clientId) return null;

  // Nur aktuelle Empfehlungen zeigen: abgelaufene pending-Eintraege ausblenden
  // (sie verfallen serverseitig, sollen aber gar nicht erst als "offen" wirken).
  const activeApprovals = approvals.filter(
    (a) => !a.expires_at || new Date(a.expires_at).getTime() > Date.now(),
  );

  // Befunde des letzten Laufs: report-only-Zeilen des juengsten Runs, der
  // welche hat (gruppiert). Aeltere Laeufe bleiben im Vault-Protokoll.
  const reportRows = changelog.filter((c) => c.action_class === "report-only" && c.status === "report-only");
  const latestFindingRun = reportRows.length ? reportRows[0].run_id : null;
  const findings = reportRows.filter((c) => c.run_id === latestFindingRun);
  const findingGroups = findings.reduce((m, f) => {
    const g = findingGroup(f.action_type);
    (m[g] = m[g] || []).push(f);
    return m;
  }, {});
  // Aenderungs-Log ohne Befunde (zeigt weiterhin nur echte Eingriffe/Queues).
  const changeRows = changelog.filter((c) => !(c.action_class === "report-only" && c.status === "report-only"));

  const autonomyLabel = ["0 - report-only", "1 - Negatives auto", "2 - + Bids auto"][config?.autonomy_level ?? 0];
  const observeOnly = config?.observe_only !== false; // Default sicher: an

  const cardStyle = {
    background: P.card,
    border: `1px solid ${P.border}`,
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
  };

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: P.text }}>Google Ads Autopilot</div>
          <div style={{ fontSize: 13, color: P.textMuted, marginTop: 2 }}>
            Teilautonom: nur die freigegebene Klasse wird ausgefuehrt. Alles Uebrige wartet auf Freigabe.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {observeOnly && <Badge color={P.blue} bg={P.blueDim}>Beobachtungsmodus - nur Dokumentation</Badge>}
          <Badge color={P.textMuted} bg="rgba(139,141,163,0.12)">Autonomie {autonomyLabel}</Badge>
          {config?.kill_switch && <Badge color={P.red} bg={P.redDim}>Kill-Switch aktiv</Badge>}
          <Btn onClick={() => runDryRun()} disabled={loading}>Dry-Run jetzt</Btn>
          <Btn onClick={() => refresh()} disabled={loading}>Aktualisieren</Btn>
        </div>
      </div>

      {config?.kill_switch && (
        <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: P.redDim, color: P.red, fontSize: 13 }}>
          Kill-Switch ist aktiv - der Autopilot fuehrt fuer diesen Kunden keine Aenderungen aus.
        </div>
      )}
      {observeOnly && (
        <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: P.blueDim, color: P.blue, fontSize: 13 }}>
          Beobachtungsmodus: Der Autopilot dokumentiert nur Massnahmen und Empfehlungen - es werden KEINE
          Aenderungen an Google Ads vorgenommen (unabhaengig vom Autonomie-Level). Freigaben sind deaktiviert,
          bis observe_only=false gesetzt wird (nach Qualitaetspruefung).
        </div>
      )}
      {error && (
        <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: P.redDim, color: P.red, fontSize: 13 }}>
          Fehler: {error}
        </div>
      )}
      {!config && !loading && (
        <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: P.orangeDim, color: P.orange, fontSize: 13 }}>
          Keine Autopilot-Konfiguration fuer diesen Kunden. Bitte eine ads_autopilot_config-Zeile anlegen
          (autonomy_level, Ziel-CPA/ROAS, no_touch, Saison).
        </div>
      )}

      {/* Approval queue */}
      <div style={{ marginTop: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: P.text, marginBottom: 8 }}>
          {observeOnly ? "Empfehlungen (Dokumentation)" : "Wartet auf Freigabe"} ({activeApprovals.length})
        </div>
        {activeApprovals.length === 0 && (
          <div style={{ fontSize: 13, color: P.textDim }}>Keine offenen Freigaben.</div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {activeApprovals.map((a) => {
            const rest = daysUntil(a.expires_at);
            return (
              <div
                key={a.id}
                onClick={() => setDetail(a)}
                style={{ border: `1px solid ${P.border}`, borderRadius: 10, padding: 12, cursor: "pointer" }}
                title="Klicken für Erklärung und Details"
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <Badge>{typeLabel(a.type)}</Badge>
                      <span style={{ color: P.text, fontWeight: 600, fontSize: 14 }}>{a.entity || "-"}</span>
                      {rest !== null && rest <= 2 && (
                        <Badge color={P.orange} bg={P.orangeDim}>läuft in {Math.max(rest, 0)} Tag{rest === 1 ? "" : "en"} ab</Badge>
                      )}
                    </div>
                    <div style={{ fontSize: 13, color: P.textMuted, marginTop: 6 }}>
                      {a.current_value ? <span>{a.current_value} </span> : null}
                      {a.proposed_value ? <span style={{ color: P.text }}>-&gt; {a.proposed_value}</span> : null}
                    </div>
                    {a.rationale && <div style={{ fontSize: 12, color: P.textDim, marginTop: 4 }}>{a.rationale}</div>}
                    {a.estimated_impact && (
                      <div style={{ fontSize: 12, color: P.accent, marginTop: 4 }}>Erwartet: {a.estimated_impact}</div>
                    )}
                    <div style={{ fontSize: 11, color: P.textDim, marginTop: 6 }}>Klicken für Erklärung &amp; Details</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }} onClick={(e) => e.stopPropagation()}>
                    <Btn variant="approve" disabled={busyId === a.id || observeOnly} onClick={() => decide(a.id, "approve")}>
                      {busyId === a.id ? "..." : observeOnly ? "Freigabe gesperrt" : "Freigeben"}
                    </Btn>
                    <Btn variant="reject" disabled={busyId === a.id} onClick={() => decide(a.id, "reject")}>
                      Ablehnen
                    </Btn>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Befunde des letzten Laufs (report-only): dokumentiert, kein Eingriff */}
      <div style={{ marginTop: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: P.text, marginBottom: 4 }}>
          Befunde des letzten Laufs ({findings.length})
        </div>
        <div style={{ fontSize: 12, color: P.textDim, marginBottom: 8 }}>
          Beobachtungen aus {latestFindingRun || "-"} — der Autopilot ändert hier nichts automatisch; Details per Klick.
        </div>
        {findings.length === 0 && (
          <div style={{ fontSize: 13, color: P.textDim }}>
            Noch keine Befunde gespeichert — sie erscheinen ab dem nächsten Lauf.
          </div>
        )}
        {Object.entries(findingGroups).map(([gruppe, rows]) => (
          <div key={gruppe} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: P.textMuted, textTransform: "uppercase", letterSpacing: 0.5, margin: "8px 0 6px" }}>
              {gruppe} ({rows.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {rows.map((f) => (
                <div
                  key={f.id}
                  onClick={() => setFindingDetail(f)}
                  title="Klicken für Erklärung"
                  style={{ border: `1px solid ${P.border}`, borderRadius: 8, padding: "8px 12px", cursor: "pointer", display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}
                >
                  <Badge color={P.blue} bg={P.blueDim}>{typeLabel(f.action_type)}</Badge>
                  <span style={{ color: P.text, fontSize: 13, fontWeight: 600 }}>{f.entity || "-"}</span>
                  <span style={{ color: P.textDim, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 480 }}>
                    {f.rationale || ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {findingDetail && (
        <div
          onClick={() => setFindingDetail(null)}
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(10,10,16,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: P.card, border: `1px solid ${P.border}`, borderRadius: 14, padding: 20, maxWidth: 560, width: "100%", maxHeight: "85vh", overflowY: "auto" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div>
                <Badge color={P.blue} bg={P.blueDim}>{typeLabel(findingDetail.action_type)}</Badge>
                <div style={{ fontSize: 15, fontWeight: 700, color: P.text, marginTop: 8 }}>{findingDetail.entity || "-"}</div>
              </div>
              <button onClick={() => setFindingDetail(null)} style={{ background: "transparent", border: "none", color: P.textMuted, fontSize: 20, cursor: "pointer", lineHeight: 1 }} aria-label="Schliessen">×</button>
            </div>
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: P.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>Was wurde beobachtet?</div>
              <div style={{ fontSize: 13, color: P.text, marginTop: 4, lineHeight: 1.55 }}>{findingDetail.rationale || "Keine Begründung hinterlegt."}</div>
            </div>
            {(findingDetail.before_value || findingDetail.after_value) && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: P.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>Werte</div>
                <div style={{ fontSize: 13, color: P.textMuted, marginTop: 4 }}>
                  {findingDetail.before_value || "-"} {findingDetail.after_value ? <span style={{ color: P.text }}>-&gt; {findingDetail.after_value}</span> : null}
                </div>
              </div>
            )}
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: P.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>Einordnung</div>
              <div style={{ fontSize: 13, color: P.textMuted, marginTop: 4, lineHeight: 1.55 }}>
                Reiner Befund aus Lauf {findingDetail.run_id} vom {new Date(findingDetail.created_at).toLocaleDateString("de-CH")} — der
                Autopilot ändert hier nichts automatisch. Der Punkt fliesst in Report, Vault-Doku und Monats-Audit ein;
                eine Umsetzung wäre ein manueller Schritt oder ein späterer Freigabe-Vorschlag.
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
              <Btn onClick={() => setFindingDetail(null)}>Schliessen</Btn>
            </div>
          </div>
        </div>
      )}

      <ApprovalDetailModal
        approval={detail}
        observeOnly={observeOnly}
        busy={detail ? busyId === detail.id : false}
        onClose={() => setDetail(null)}
        onDecide={async (decision) => {
          if (!detail) return;
          await decide(detail.id, decision);
          setDetail(null);
        }}
      />

      {/* Changelog */}
      <div style={{ marginTop: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: P.text, marginBottom: 8 }}>Aenderungs-Log</div>
        {changeRows.length === 0 && <div style={{ fontSize: 13, color: P.textDim }}>Noch keine Eintraege.</div>}
        {changeRows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: P.textDim, textAlign: "left" }}>
                  <th style={{ padding: "6px 8px", fontWeight: 600 }}>Datum</th>
                  <th style={{ padding: "6px 8px", fontWeight: 600 }}>Aktion</th>
                  <th style={{ padding: "6px 8px", fontWeight: 600 }}>Entity</th>
                  <th style={{ padding: "6px 8px", fontWeight: 600 }}>Status</th>
                  <th style={{ padding: "6px 8px", fontWeight: 600 }}>Begruendung</th>
                </tr>
              </thead>
              <tbody>
                {changeRows.map((c) => (
                  <tr key={c.id} style={{ borderTop: `1px solid ${P.border}`, color: P.textMuted }}>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                      {new Date(c.created_at).toLocaleDateString("de-CH")}
                    </td>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{c.action_type}</td>
                    <td style={{ padding: "6px 8px", color: P.text }}>{c.entity || "-"}</td>
                    <td style={{ padding: "6px 8px" }}><StatusBadge status={c.status} /></td>
                    <td style={{ padding: "6px 8px", maxWidth: 320 }}>{c.rationale || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
