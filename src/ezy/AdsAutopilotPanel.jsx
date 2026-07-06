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

export default function AdsAutopilotPanel({ selectedClient }) {
  const clientId = selectedClient?.id;
  const { config, approvals, changelog, loading, error, busyId, refresh, decide, runDryRun } =
    useEzyAdsAutopilot(clientId);

  if (!clientId) return null;

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
          {observeOnly ? "Empfehlungen (Dokumentation)" : "Wartet auf Freigabe"} ({approvals.length})
        </div>
        {approvals.length === 0 && (
          <div style={{ fontSize: 13, color: P.textDim }}>Keine offenen Freigaben.</div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {approvals.map((a) => (
            <div key={a.id} style={{ border: `1px solid ${P.border}`, borderRadius: 10, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <Badge>{a.type}</Badge>
                    <span style={{ color: P.text, fontWeight: 600, fontSize: 14 }}>{a.entity || "-"}</span>
                  </div>
                  <div style={{ fontSize: 13, color: P.textMuted, marginTop: 6 }}>
                    {a.current_value ? <span>{a.current_value} </span> : null}
                    {a.proposed_value ? <span style={{ color: P.text }}>-&gt; {a.proposed_value}</span> : null}
                  </div>
                  {a.rationale && <div style={{ fontSize: 12, color: P.textDim, marginTop: 4 }}>{a.rationale}</div>}
                  {a.estimated_impact && (
                    <div style={{ fontSize: 12, color: P.accent, marginTop: 4 }}>Erwartet: {a.estimated_impact}</div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <Btn variant="approve" disabled={busyId === a.id || observeOnly} onClick={() => decide(a.id, "approve")}>
                    {busyId === a.id ? "..." : observeOnly ? "Freigabe gesperrt" : "Freigeben"}
                  </Btn>
                  <Btn variant="reject" disabled={busyId === a.id} onClick={() => decide(a.id, "reject")}>
                    Ablehnen
                  </Btn>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Changelog */}
      <div style={{ marginTop: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: P.text, marginBottom: 8 }}>Aenderungs-Log</div>
        {changelog.length === 0 && <div style={{ fontSize: 13, color: P.textDim }}>Noch keine Eintraege.</div>}
        {changelog.length > 0 && (
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
                {changelog.map((c) => (
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
