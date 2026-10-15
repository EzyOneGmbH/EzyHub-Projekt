// Keyword-Cluster nach Suchabsicht (15.10.2026, Volkan Punkt 9) — NUR Team-
// Ansicht (Aufrufer gated mit istTeam). Berechnung auf Knopfdruck (KI gruppiert,
// Kennzahlen/Kannibalisierung/Luecken rechnet der Server aus echten Daten).
import { Fragment, useEffect, useState } from "react";
import { ezyFetch } from "@/ezy/data/api";
import { C } from "./theme";

const INTENT = {
  informational: "Info",
  commercial: "Vergleich",
  transactional: "Buchung/Kauf",
  navigational: "Marke",
  local: "Lokal",
};

export default function KeywordClusterCard({ clientId }) {
  const [lauf, setLauf] = useState(null);
  const [laedt, setLaedt] = useState(false);
  const [rechnet, setRechnet] = useState(false);
  const [fehler, setFehler] = useState(null);
  const [filter, setFilter] = useState("alle"); // alle | kanni | luecke
  const [auf, setAuf] = useState(null);

  useEffect(() => {
    let abgebrochen = false;
    setLauf(null);
    setFehler(null);
    if (!clientId) return;
    setLaedt(true);
    ezyFetch(`/api/admin/keyword-clusters?clientId=${encodeURIComponent(clientId)}`)
      .then((r) => r.json())
      .then((j) => !abgebrochen && setLauf(j?.ok ? j.lauf : null))
      .catch(() => {})
      .finally(() => !abgebrochen && setLaedt(false));
    return () => {
      abgebrochen = true;
    };
  }, [clientId]);

  const berechnen = async () => {
    if (rechnet) return;
    setRechnet(true);
    setFehler(null);
    try {
      const r = await ezyFetch("/api/admin/keyword-clusters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const j = await r.json().catch(() => ({}));
      if (j?.ok) setLauf(j.lauf);
      else setFehler(j?.error || "Berechnung fehlgeschlagen");
    } catch {
      setFehler("Berechnung fehlgeschlagen");
    } finally {
      setRechnet(false);
    }
  };

  const clusters = (lauf?.clusters || []).filter((c) =>
    filter === "kanni" ? c.kannibalisierung : filter === "luecke" ? c.luecke : true,
  );
  const anzKanni = (lauf?.clusters || []).filter((c) => c.kannibalisierung).length;
  const anzLuecke = (lauf?.clusters || []).filter((c) => c.luecke).length;
  const chip = (id, label) => (
    <span
      key={id}
      onClick={() => setFilter(id)}
      style={{
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        cursor: "pointer",
        border: `1px solid ${filter === id ? C.accent : C.border}`,
        background: filter === id ? `${C.accent}22` : "transparent",
        color: filter === id ? C.accent : C.textMuted,
      }}
    >
      {label}
    </span>
  );

  return (
    <div
      style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: C.textMuted }}>
          Keyword-Cluster nach Suchabsicht{" "}
          <span style={{ fontSize: 11, fontWeight: 400, color: C.textDim }}>(nur Team)</span>
        </div>
        <button
          type="button"
          onClick={berechnen}
          disabled={rechnet}
          style={{
            padding: "5px 12px",
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 8,
            border: `1px solid ${C.accent}`,
            background: "transparent",
            color: C.accent,
            cursor: rechnet ? "wait" : "pointer",
          }}
        >
          {rechnet ? "Berechnet… (bis 2 Min.)" : lauf ? "Neu berechnen" : "Cluster berechnen"}
        </button>
      </div>
      <div style={{ fontSize: 11, color: C.textDim, margin: "4px 0 10px" }}>
        Getrackte Keywords + Search-Console-Begriffe, thematisch gruppiert. Kannibalisierung =
        mehrere eigene Seiten ranken (Top 20) im selben Cluster · Lücke = nichts in den Top 20.
        {lauf?.at ? ` Stand ${new Date(lauf.at).toLocaleString("de-CH")}.` : ""}
      </div>
      {fehler && <div style={{ fontSize: 12, color: C.orange, marginBottom: 8 }}>{fehler}</div>}
      {laedt && !lauf && <div style={{ fontSize: 12, color: C.textDim }}>lädt…</div>}
      {!laedt && !lauf && !fehler && (
        <div style={{ fontSize: 12, color: C.textDim }}>
          Noch keine Berechnung für diesen Kunden.
        </div>
      )}
      {lauf && (
        <>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {chip("alle", `Alle (${(lauf.clusters || []).length})`)}
            {chip("kanni", `Kannibalisierung (${anzKanni})`)}
            {chip("luecke", `Lücken (${anzLuecke})`)}
          </div>
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <table
              style={{ width: "100%", minWidth: 680, borderCollapse: "collapse", fontSize: 13 }}
            >
              <thead>
                <tr style={{ color: C.textDim, textAlign: "left" }}>
                  <th style={{ padding: "6px 8px" }}>Cluster</th>
                  <th style={{ padding: "6px 8px" }}>Absicht</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Keywords</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Volumen</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Impr.</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Beste Pos.</th>
                  <th style={{ padding: "6px 8px" }}>Befund</th>
                </tr>
              </thead>
              <tbody>
                {clusters.map((c) => (
                  <Fragment key={c.name}>
                    <tr
                      onClick={() => setAuf(auf === c.name ? null : c.name)}
                      style={{ borderTop: `1px solid ${C.border}`, cursor: "pointer" }}
                    >
                      <td style={{ padding: "6px 8px", color: C.text, fontWeight: 600 }}>
                        {auf === c.name ? "▾ " : "▸ "}
                        {c.name}
                      </td>
                      <td style={{ padding: "6px 8px", color: C.textMuted }}>
                        {INTENT[c.intent] || c.intent}
                      </td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>{c.anzahl}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>
                        {c.volumen ? c.volumen.toLocaleString("de-CH") : "—"}
                      </td>
                      <td style={{ padding: "6px 8px", textAlign: "right", color: C.textMuted }}>
                        {c.impressionen ? c.impressionen.toLocaleString("de-CH") : "—"}
                      </td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>
                        {c.bestePos ?? "—"}
                      </td>
                      <td style={{ padding: "6px 8px", fontSize: 12 }}>
                        {c.kannibalisierung && (
                          <span style={{ color: C.orange, marginRight: 6 }}>
                            Kannibalisierung ({c.seiten.length} Seiten)
                          </span>
                        )}
                        {c.luecke && <span style={{ color: C.blue }}>Lücke</span>}
                      </td>
                    </tr>
                    {auf === c.name && (
                      <tr>
                        <td colSpan={7} style={{ padding: "4px 8px 10px 24px", fontSize: 12 }}>
                          {c.hinweis && (
                            <div style={{ color: C.text, marginBottom: 4 }}>{c.hinweis}</div>
                          )}
                          <div style={{ color: C.textMuted }}>{c.keywords.join(" · ")}</div>
                          {c.seiten.length > 0 && (
                            <div style={{ color: C.textDim, marginTop: 4 }}>
                              Rankende Seiten: {c.seiten.join(" · ")}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
