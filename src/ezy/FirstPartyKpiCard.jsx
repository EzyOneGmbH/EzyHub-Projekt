// First-Party-KPIs, Phase 1 (22.09.2026, Volkan): Karte im Google-Panel des
// Kunden-Details — zeigt die Service-Account-E-Mail (zum Eintragen in GSC als
// Nutzer und in GA4 als Betrachter), prueft die Verbindung lesend und schaltet
// den Test-Modus je Kunde (clients.metadata.first_party_kpi, Default AUS).
// Nur Owner/Admin (Route prueft serverseitig).
import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/authed-fetch";
import { supabase } from "@/integrations/supabase/client";

const S = {
  card: {
    marginTop: 14,
    padding: 14,
    borderRadius: 10,
    border: "1px solid rgba(148,163,184,.25)",
    background: "rgba(15,23,42,.35)",
    color: "#e2e8f0",
  },
  btn: (extra = {}, disabled = false) => ({
    padding: "6px 12px",
    borderRadius: 8,
    border: "1px solid #334155",
    background: "#1e293b",
    color: "#e2e8f0",
    fontSize: 12,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    ...extra,
  }),
  pill: (ok) => ({
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    background:
      ok === true ? "rgba(5,150,105,.2)" : ok === false ? "rgba(220,38,38,.2)" : "#334155",
    color: ok === true ? "#6ee7b7" : ok === false ? "#fca5a5" : "#cbd5e1",
  }),
  code: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 11.5,
    background: "#0f172a",
    padding: "2px 6px",
    borderRadius: 6,
    userSelect: "all",
  },
};

async function rufe(body) {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  const r = await authedFetch("/api/admin/first-party-connection", {
    method: "POST",
    headers: { Authorization: `Bearer ${token || ""}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
}

export default function FirstPartyKpiCard({ clientId }) {
  const [status, setStatus] = useState(null);
  const [test, setTest] = useState(null);
  const [busy, setBusy] = useState("");
  const [fehler, setFehler] = useState("");

  const laden = useCallback(async () => {
    if (!clientId) return;
    const j = await rufe({ clientId, action: "status" });
    if (j.ok) setStatus(j);
    else if (j.error !== "Forbidden") setFehler(j.error || "Status nicht ladbar");
  }, [clientId]);
  useEffect(() => {
    setStatus(null);
    setTest(null);
    setFehler("");
    void laden();
  }, [laden]);

  const testen = async (auth) => {
    setBusy("test");
    setFehler("");
    const j = await rufe({ clientId, action: "test", ...(auth ? { auth } : {}) });
    setBusy("");
    if (j.ok) setTest(j);
    else setFehler(j.error || "Test fehlgeschlagen");
  };
  const flagSetzen = async (enabled) => {
    setBusy("flag");
    const j = await rufe({ clientId, action: "flag", enabled });
    setBusy("");
    if (j.ok) setStatus((s) => (s ? { ...s, flag: j.flag } : s));
    else setFehler(j.error || "Flag nicht gespeichert");
  };

  // Nicht-Admins bekommen 403 → Karte bleibt unsichtbar (kein Rauschen).
  if (!status) return fehler ? <div style={{ ...S.card, color: "#fca5a5" }}>{fehler}</div> : null;
  const sa = status.serviceAccount || {};
  const Probe = ({ label, p }) => (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
      <span style={{ minWidth: 40, fontWeight: 700 }}>{label}</span>
      <span style={S.pill(p.ok)}>{p.ok ? "ok" : "fehlt"}</span>
      {p.auth && (
        <span style={{ color: "#94a3b8" }}>
          via {p.auth === "service_account" ? "Service Account" : "OAuth"}
        </span>
      )}
      {p.wert && <span>{p.wert}</span>}
      {p.fehler && <span style={{ color: "#fca5a5" }}>{p.fehler}</span>}
    </div>
  );

  return (
    <div style={S.card}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>First-Party-Daten (KPI-Dashboard)</span>
        <span style={S.pill(status.flag ? true : null)}>{status.flag ? "Test aktiv" : "aus"}</span>
        <span style={S.pill(sa.konfiguriert ? true : null)}>
          {sa.konfiguriert
            ? "Service Account konfiguriert"
            : "Service Account fehlt → OAuth-Fallback"}
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 8, lineHeight: 1.6 }}>
        Tägliche Rohdaten aus Search Console und GA4 (nur lesend) für die Kacheln Chancen-Keywords,
        Gewinner/Verlierer und organische Conversions.
        {sa.email ? (
          <>
            {" "}
            Dieses Konto in der GSC-Property als <b>Nutzer</b> und in GA4 als <b>Betrachter</b>{" "}
            eintragen: <span style={S.code}>{sa.email}</span>
          </>
        ) : (
          <>
            {" "}
            Bis der Key (GOOGLE_SERVICE_ACCOUNT_JSON) hinterlegt ist, läuft die Abfrage über die
            Google-Verbindung des Kunden.
          </>
        )}
        {sa.fehler && <div style={{ color: "#fca5a5" }}>Key-Problem: {sa.fehler}</div>}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button onClick={() => testen()} disabled={!!busy} style={S.btn({}, !!busy)}>
          {busy === "test" ? "…" : "Verbindung testen"}
        </button>
        {sa.konfiguriert && (
          <button onClick={() => testen("oauth")} disabled={!!busy} style={S.btn({}, !!busy)}>
            Test via OAuth
          </button>
        )}
        <button
          onClick={() => flagSetzen(!status.flag)}
          disabled={!!busy}
          style={S.btn(
            status.flag ? {} : { background: "#059669", borderColor: "#059669", fontWeight: 700 },
            !!busy,
          )}
          title="Nur freigeschaltete Kunden werden täglich geladen und zeigen die Kacheln"
        >
          {busy === "flag"
            ? "…"
            : status.flag
              ? "Test für diesen Kunden beenden"
              : "Für diesen Kunden aktivieren (Test)"}
        </button>
      </div>
      {test && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
          <Probe label="GSC" p={test.gsc} />
          <Probe label="GA4" p={test.ga4} />
        </div>
      )}
      {fehler && <div style={{ marginTop: 8, fontSize: 12, color: "#fca5a5" }}>{fehler}</div>}
    </div>
  );
}
