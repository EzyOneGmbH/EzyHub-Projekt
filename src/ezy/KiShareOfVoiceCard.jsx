// KI-Share-of-Voice & zitierte Quellen (15.10.2026, Volkan Punkt 12) — NUR
// Team-Ansicht (Aufrufer gated: role !== "viewer"). DataForSEO-LLM-Mentions
// (Google AI Overview CH bzw. ChatGPT global) nur auf Knopfdruck (?jetzt=1),
// globaler Schalter AIVIS_DFS_ENABLED bleibt aus. 24-h-Cache in audit_runs.
import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/authed-fetch";

const PLATTFORM = [
  ["google", "Google AI Overview (Schweiz)"],
  ["chat_gpt", "ChatGPT (global, englisch)"],
];

export default function KiShareOfVoiceCard({ clientId, S }) {
  const [plattform, setPlattform] = useState("google");
  const [daten, setDaten] = useState(null);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState(null);

  const laden = async (neu) => {
    setFehler(null);
    if (neu) setBusy(true);
    try {
      const q = new URLSearchParams({ client: clientId, platform: plattform });
      if (neu) {
        q.set("jetzt", "1");
        q.set("refresh", "1");
      }
      const r = await authedFetch(`/api/admin/aivis-competitors?${q.toString()}`);
      const j = await r.json().catch(() => ({}));
      if (j?.ok) setDaten(j);
      else {
        setDaten(null);
        if (neu) setFehler(j?.error || "Analyse fehlgeschlagen");
      }
    } catch {
      if (neu) setFehler("Analyse fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    setDaten(null);
    if (clientId) laden(false); // nur Cache — ohne ?jetzt=1 keine Kosten
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, plattform]);

  const sov = (daten?.sov || []).slice(0, 7);
  const domains = (daten?.domains || []).slice(0, 8);
  const pages = (daten?.pages || []).slice(0, 5);
  const box = {
    background: S.panel,
    border: `1px solid ${S.line}`,
    borderRadius: 14,
    padding: 18,
    marginTop: 18,
  };
  const titel = { fontSize: 13, fontWeight: 700, color: S.txt, margin: "12px 0 6px" };
  const zeile = {
    fontSize: 12.5,
    color: S.mut,
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
  };

  return (
    <div style={box}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: S.txt }}>
          KI-Share-of-Voice & zitierte Quellen{" "}
          <span style={{ fontSize: 11.5, fontWeight: 400, color: S.mut }}>(nur Team)</span>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <select
            value={plattform}
            onChange={(e) => setPlattform(e.target.value)}
            style={{
              fontSize: 12,
              padding: "5px 8px",
              borderRadius: 8,
              border: `1px solid ${S.line}`,
            }}
          >
            {PLATTFORM.map(([id, l]) => (
              <option key={id} value={id}>
                {l}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => laden(true)}
            disabled={busy}
            style={{
              fontSize: 12,
              fontWeight: 700,
              padding: "6px 12px",
              borderRadius: 8,
              border: "none",
              background: S.acc,
              color: "#fff",
              cursor: busy ? "wait" : "pointer",
            }}
          >
            {busy ? "Analysiert… (bis 2 Min.)" : daten ? "Neu messen" : "Analyse starten"}
          </button>
        </div>
      </div>
      <div style={{ fontSize: 12, color: S.mut, marginTop: 4 }}>
        Wie oft die Marke im Vergleich zu den Wettbewerbern in KI-Antworten genannt wird und welche
        Quellen die KI zitiert (DataForSEO LLM Mentions). Kostenpflichtig, nur auf Knopfdruck — ca.
        0.3–1 USD pro Messung.
      </div>
      {fehler && <div style={{ fontSize: 12.5, color: "#c2410c", marginTop: 8 }}>{fehler}</div>}
      {!daten && !fehler && !busy && (
        <div style={{ fontSize: 12.5, color: S.mut, marginTop: 10 }}>
          Für diese Plattform liegt noch keine Messung vor (oder sie ist älter als 24 Stunden).
        </div>
      )}
      {daten && (
        <>
          {daten.note && (
            <div style={{ fontSize: 12, color: S.mut, marginTop: 8 }}>{daten.note}</div>
          )}
          {sov.length > 0 && (
            <>
              <div style={titel}>Share of Voice (Erwähnungen)</div>
              {sov.map((r) => (
                <div key={r.name} style={zeile}>
                  <span
                    style={{ color: r.isSelf ? S.txt : S.mut, fontWeight: r.isSelf ? 700 : 400 }}
                  >
                    {r.name}
                    {r.isSelf ? " (Kunde)" : ""}
                  </span>
                  <span>
                    {Math.round(r.share)} % · {Number(r.mentions || 0).toLocaleString("de-CH")}
                  </span>
                </div>
              ))}
            </>
          )}
          {domains.length > 0 && (
            <>
              <div style={titel}>Meistzitierte Domains</div>
              {domains.map((d) => (
                <div key={d.key} style={zeile}>
                  <span>{d.key}</span>
                  <span>{Number(d.mentions || 0).toLocaleString("de-CH")}</span>
                </div>
              ))}
            </>
          )}
          {pages.length > 0 && (
            <>
              <div style={titel}>Meistzitierte Seiten</div>
              {pages.map((d) => (
                <div key={d.key} style={{ ...zeile, wordBreak: "break-all" }}>
                  <span>{d.key}</span>
                  <span>{Number(d.mentions || 0).toLocaleString("de-CH")}</span>
                </div>
              ))}
            </>
          )}
          <div style={{ fontSize: 11.5, color: S.mut, marginTop: 10 }}>
            Kernbegriffe: {(daten.targets || []).join(", ") || "—"}
            {daten.cost != null
              ? ` · Kosten dieser Messung ${Number(daten.cost).toFixed(2)} USD`
              : ""}
          </div>
        </>
      )}
    </div>
  );
}
