// Local SEO auf Abruf (15.10.2026, Volkan Punkt 11) — NUR Team-Ansicht (Aufrufer
// gated mit istTeam). Google-Business-Profil, Maps-Raster um den Standort und
// Bewertungen der lokalen Konkurrenz — nur auf Knopfdruck (Kosten pro Lauf).
import { useEffect, useState } from "react";
import { ezyFetch } from "@/ezy/data/api";
import { C } from "./theme";

const farbe = (r) =>
  !r ? C.border : r <= 3 ? C.green : r <= 10 ? "#e0b400" : r <= 20 ? C.orange : C.border;

export default function LocalSeoCard({ clientId, vorschlaege = [] }) {
  const [lauf, setLauf] = useState(null);
  const [kws, setKws] = useState(["", "", ""]);
  const [grid, setGrid] = useState(3);
  const [stepKm, setStepKm] = useState(1);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState(null);

  useEffect(() => {
    let ab = false;
    setLauf(null);
    setFehler(null);
    const v = [...vorschlaege.slice(0, 3)];
    setKws([v[0] || "", v[1] || "", v[2] || ""]);
    if (!clientId) return;
    ezyFetch(`/api/admin/local-seo?clientId=${encodeURIComponent(clientId)}`)
      .then((r) => r.json())
      .then((j) => {
        if (ab || !j?.ok || !j.lauf) return;
        setLauf(j.lauf);
        const p = j.lauf.parameter?.keywords || [];
        if (p.length) setKws([p[0] || "", p[1] || "", p[2] || ""]);
      })
      .catch(() => {});
    return () => {
      ab = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const aktiv = kws.map((k) => k.trim()).filter(Boolean);
  const starten = async () => {
    if (busy || !aktiv.length) return;
    if (grid === 5 && aktiv.length > 1) {
      setFehler("5×5-Raster nur mit 1 Keyword — bitte die anderen leeren oder 3×3 wählen.");
      return;
    }
    setBusy(true);
    setFehler(null);
    try {
      const r = await ezyFetch("/api/admin/local-seo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, keywords: aktiv, grid, stepKm }),
      });
      const j = await r.json().catch(() => ({}));
      if (j?.ok) setLauf(j.lauf);
      else setFehler(j?.error || "Analyse fehlgeschlagen");
    } catch {
      setFehler("Analyse fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  const eingabe = {
    fontSize: 12,
    padding: "5px 8px",
    borderRadius: 8,
    border: `1px solid ${C.border}`,
    background: C.surface,
    color: C.text,
  };
  const kosten = (grid === 5 ? 25 : 9) * Math.max(1, aktiv.length) * 0.002 + 0.03;

  return (
    <div
      style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: C.textMuted, marginBottom: 4 }}>
        Local SEO — Maps-Sichtbarkeit & Konkurrenz{" "}
        <span style={{ fontSize: 11, fontWeight: 400, color: C.textDim }}>(nur Team)</span>
      </div>
      <div style={{ fontSize: 11, color: C.textDim, marginBottom: 10 }}>
        Auf Knopfdruck: eigenes Google-Business-Profil (über die Domain), Google-Maps-Rangplatz an{" "}
        {grid * grid} Punkten rund um den Standort und Bewertungen der lokalen Konkurrenz.
        Geschätzte Kosten ca. {kosten.toFixed(2)} USD pro Lauf.
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {kws.map((k, i) => (
          <input
            key={i}
            value={k}
            onChange={(e) => setKws((a) => a.map((x, j) => (j === i ? e.target.value : x)))}
            placeholder={`Keyword ${i + 1}${i ? " (optional)" : ""}`}
            style={{ ...eingabe, width: 170 }}
          />
        ))}
        <select value={grid} onChange={(e) => setGrid(Number(e.target.value))} style={eingabe}>
          <option value={3}>Raster 3×3</option>
          <option value={5}>Raster 5×5 (1 Keyword)</option>
        </select>
        <select value={stepKm} onChange={(e) => setStepKm(Number(e.target.value))} style={eingabe}>
          {[0.5, 1, 2, 3, 5].map((v) => (
            <option key={v} value={v}>
              Abstand {String(v).replace(".", ",")} km
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={starten}
          disabled={busy || !aktiv.length}
          style={{
            padding: "5px 12px",
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 8,
            border: "none",
            background: C.accent,
            color: "#fff",
            cursor: busy ? "wait" : "pointer",
          }}
        >
          {busy ? "Analysiert… (bis 2 Min.)" : "Analyse starten"}
        </button>
      </div>
      {fehler && <div style={{ fontSize: 12, color: C.orange, marginTop: 8 }}>{fehler}</div>}
      {lauf && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 12, color: C.textMuted }}>
            <strong style={{ color: C.text }}>{lauf.gbp?.title || "Profil"}</strong>
            {lauf.gbp?.city ? ` · ${lauf.gbp.city}` : ""}
            {lauf.bewertungen?.own?.rating != null
              ? ` · ★ ${String(lauf.bewertungen.own.rating).replace(".", ",")} (${lauf.bewertungen.own.reviews ?? "?"} Bewertungen)`
              : ""}
            {lauf.gbp?.isClaimed === false ? " · ⚠ Profil nicht beansprucht" : ""}
            {lauf.at ? ` · Stand ${new Date(lauf.at).toLocaleString("de-CH")}` : ""}
          </div>
          {lauf.raster?.fehler && (
            <div style={{ fontSize: 12, color: C.orange }}>Maps-Raster: {lauf.raster.fehler}</div>
          )}
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
            {(lauf.raster?.keywords || []).map((k) => (
              <div key={k.keyword} style={{ minWidth: 200 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 4 }}>
                  {k.keyword}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${(k.matrix || []).length || 3}, 30px)`,
                    gap: 3,
                    marginBottom: 6,
                  }}
                >
                  {(k.matrix || []).flat().map((r, i) => (
                    <div
                      key={i}
                      title={r ? `Platz ${r}` : "nicht in den Top 20"}
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 6,
                        background: farbe(r),
                        color: r && r <= 20 ? "#fff" : C.textDim,
                        fontSize: 11,
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {r || "–"}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: C.textMuted }}>
                  Top 3 an {k.top3Share ?? 0}% der Punkte · Ø Platz {k.avgRank ?? "—"}
                </div>
                {(k.competitors || []).slice(0, 3).length > 0 && (
                  <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>
                    Stärkste Konkurrenz:{" "}
                    {(k.competitors || [])
                      .slice(0, 3)
                      .map((c) => c.name)
                      .join(", ")}
                  </div>
                )}
              </div>
            ))}
          </div>
          {(lauf.bewertungen?.competitors || []).length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 4 }}>
                Lokale Konkurrenz (Bewertungen)
              </div>
              {(lauf.bewertungen.competitors || []).map((c) => (
                <div key={c.title} style={{ fontSize: 12, color: C.textMuted }}>
                  {c.title}
                  {c.rating != null
                    ? ` · ★ ${String(c.rating).replace(".", ",")} (${c.reviews ?? "?"})`
                    : ""}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
