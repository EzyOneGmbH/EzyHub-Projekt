// Local-Grid-Dashboard (2026-08-17): SeoMap-artige Maps-Heatmap fuer den
// EzyRank-Tab "Local Grid". Datenquelle: audit_runs type 'geo_grid' — gepusht
// vom agent-service nach jedem frischen /geo-grid-Scan (DataForSEO Maps,
// freitags via Agenten-Lauf). Bewusst eigene Datei (nicht EzyOneApp.jsx):
// kleinerer Diff im Monolithen, keine Konflikte mit parallelen Sessions.
// Metriken: SoLV = Top-3-Anteil der Rasterpunkte, ARP = Ø-Rang (nur gefunden),
// ATRP = "ehrlicher" Ø ueber ALLE Punkte (nicht gefunden = 21), Abdeckung =
// Anteil Punkte mit Ranking.
import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import DataStatus from "@/ezy/DataStatus";

// Ezy One CD (Light Studio) — Teilmenge der EzyOneApp-Palette, Werte identisch.
const C = {
  card: "#ffffff",
  border: "#eae4ee",
  text: "#161217",
  textMuted: "#6d6473",
  textDim: "#a49dab",
  accent: "#77008C",
  accentDim: "rgba(119,0,140,0.09)",
  green: "#0f9d6c",
  red: "#dc2626",
  orange: "#d97706",
};

// Heatmap-Farbskala wie bei Geo-Grid-Tools ueblich: gruen (Top 3) -> rot (16+).
function rankColor(rank) {
  if (!rank || rank <= 0) return { bg: "#efeaf2", fg: C.textDim }; // nicht gefunden
  if (rank <= 3) return { bg: "#0f9d6c", fg: "#fff" };
  if (rank <= 7) return { bg: "#7cb342", fg: "#fff" };
  if (rank <= 10) return { bg: "#eab308", fg: "#fff" };
  if (rank <= 15) return { bg: "#f97316", fg: "#fff" };
  return { bg: "#dc2626", fg: "#fff" };
}

const isUuid = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ""));
const fmt = (v, digits = 1) => (v == null || Number.isNaN(Number(v)) ? "–" : Number(v).toFixed(digits).replace(/\.0+$/, ""));

// Delta-Chip: bei Raengen (invert) ist SINKEN gut, bei Anteilen ist STEIGEN gut.
function Delta({ cur, prev, invert = false, suffix = "" }) {
  if (cur == null || prev == null) return null;
  const d = Math.round((cur - prev) * 10) / 10;
  if (d === 0) return <span style={{ fontSize: 11, color: C.textDim }}>±0</span>;
  const good = invert ? d < 0 : d > 0;
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: good ? C.green : C.red }}>
      {d > 0 ? "▲" : "▼"} {Math.abs(d)}{suffix}
    </span>
  );
}

function Tile({ label, value, sub, delta }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px", minWidth: 0 }}>
      <div style={{ fontSize: 11.5, color: C.textMuted, fontWeight: 600, letterSpacing: ".02em" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: 24, fontWeight: 700, color: C.text }}>{value}</span>
        {delta}
      </div>
      {sub && <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// Karten-Heatmap (User-Wunsch 17.08.): echte OSM-Karte hinter den Rasterpunkten
// (wie SeoMap) — statisches Tile-Mosaik + Web-Mercator-Projektion, KEINE neue
// Dependency (kein Leaflet). Punkt-Geometrie exakt wie gridPoints im
// agent-service (dLat = stepKm/110.574, dLng breitenkorrigiert), dadurch ist
// die Ausrichtung geografisch korrekt (Norden oben), egal wie die Matrix liegt.
function MapHeatmap({ center, n, stepKm, matrix, size = 440 }) {
  const [zoomDelta, setZoomDelta] = useState(0);
  // Interaktiv (User-Wunsch 17.08.): Ziehen = Verschieben (Pan in px der
  // aktuellen Zoomstufe; bei Zoomwechsel mitskaliert, damit das Bild "steht").
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef(null);
  const lat = Number(center?.lat), lng = Number(center?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !n || !matrix?.length) return null;
  const latRad = (lat * Math.PI) / 180;
  // Basis-Zoom so, dass das Raster ~72% der Kartenbreite fuellt; +/- zoomt
  // um das Standort-Zentrum, die Punkte spreizen sich dabei korrekt.
  const spanM = Math.max(500, (n - 1) * (Number(stepKm) || 1) * 1000);
  const baseZ = Math.floor(Math.log2((156543.03 * Math.cos(latRad) * (size * 0.72)) / spanM));
  const z = Math.max(3, Math.min(17, baseZ + zoomDelta));
  const world = 256 * Math.pow(2, z);
  const proj = (la, lo) => ({
    x: ((lo + 180) / 360) * world,
    y: ((1 - Math.log(Math.tan((la * Math.PI) / 180) + 1 / Math.cos((la * Math.PI) / 180)) / Math.PI) / 2) * world,
  });
  const c = proj(lat, lng);
  const minX = c.x - size / 2 - pan.x, minY = c.y - size / 2 - pan.y;
  const maxT = Math.pow(2, z);
  const tiles = [];
  for (let tx = Math.floor(minX / 256); tx <= Math.floor((minX + size) / 256); tx++)
    for (let ty = Math.floor(minY / 256); ty <= Math.floor((minY + size) / 256); ty++) {
      if (ty < 0 || ty >= maxT) continue;
      const wx = ((tx % maxT) + maxT) % maxT;
      tiles.push({ key: `${z}/${tx}/${ty}`, url: `https://tile.openstreetmap.org/${z}/${wx}/${ty}.png`, left: tx * 256 - minX, top: ty * 256 - minY });
    }
  const half = Math.floor(n / 2);
  const dLat = (Number(stepKm) || 1) / 110.574;
  const dLng = (Number(stepKm) || 1) / (111.32 * Math.cos(latRad));
  // Marker-Groesse an den Punktabstand koppeln: bei dichtem Raster (Start-
  // Ansicht grosser Grids) kleinere Punkte -> deutlicher unterscheidbar.
  const spacingPx = (dLng / 360) * world;
  const mSize = spacingPx < 26 ? 14 : spacingPx < 36 ? 20 : 26;
  const mFont = mSize <= 14 ? 8.5 : mSize <= 20 ? 10 : 11.5;
  const markers = matrix.flatMap((row, r) =>
    (row || []).map((rank, col) => {
      const p = proj(lat + (r - half) * dLat, lng + (col - half) * dLng);
      return { key: `${r}-${col}`, x: p.x - minX, y: p.y - minY, rank, isCenter: r === half && col === half };
    }),
  );
  const changeZoom = (d) => {
    const nv = Math.max(-3, Math.min(5, zoomDelta + d));
    const f = Math.pow(2, (Math.max(3, Math.min(17, baseZ + nv)) - z));
    setZoomDelta(nv);
    setPan((p) => ({ x: p.x * f, y: p.y * f }));
  };
  return (
    <div style={{ position: "relative", width: "100%", maxWidth: size, margin: "0 auto" }}>
      <div
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY };
          try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* still */ }
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
          drag.current = { x: e.clientX, y: e.clientY };
          setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerLeave={() => { drag.current = null; }}
        style={{ position: "relative", width: "100%", aspectRatio: "1", overflow: "hidden", borderRadius: 10, background: "#e9e5e0", border: `1px solid ${C.border}`, cursor: "grab", touchAction: "none", userSelect: "none" }}
      >
        {/* Innerer Fixrahmen: px-Mathematik braucht feste Groesse; auf schmalen
            Screens wird mittig gecroppt (Zentrum bleibt Zentrum). */}
        <div style={{ position: "absolute", left: "50%", top: "50%", width: size, height: size, transform: "translate(-50%, -50%)" }}>
          {tiles.map((t) => (
            <img key={t.key} src={t.url} alt="" width={256} height={256} loading="lazy" draggable={false}
              style={{ position: "absolute", left: t.left, top: t.top, userSelect: "none", pointerEvents: "none" }} />
          ))}
          {markers.map((m) => {
            const col = rankColor(m.rank);
            return (
              <div
                key={m.key}
                title={m.rank > 0 ? `Rang ${m.rank}` : "nicht in den Top 20"}
                style={{
                  position: "absolute", left: m.x, top: m.y, transform: "translate(-50%, -50%)",
                  width: mSize, height: mSize, borderRadius: "50%",
                  background: m.rank > 0 ? col.bg : "#8b8494", color: "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: mFont, fontWeight: 700,
                  border: m.isCenter ? `2.5px solid ${C.accent}` : "1.5px solid rgba(255,255,255,.9)",
                  boxShadow: "0 1px 4px rgba(0,0,0,.35)",
                }}
              >
                {m.rank > 0 ? m.rank : "–"}
              </div>
            );
          })}
        </div>
        {/* Zoom/Reset + Pflicht-Attribution */}
        <div style={{ position: "absolute", top: 8, right: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {[["+", 1], ["−", -1]].map(([lbl, d]) => (
            <button key={lbl} onClick={() => changeZoom(d)} onPointerDown={(e) => e.stopPropagation()}
              style={{ width: 26, height: 26, borderRadius: 6, border: `1px solid ${C.border}`, background: "#fff", color: C.text, fontSize: 15, fontWeight: 700, cursor: "pointer", lineHeight: 1 }}>
              {lbl}
            </button>
          ))}
          <button title="Ansicht zuruecksetzen" onClick={() => { setZoomDelta(0); setPan({ x: 0, y: 0 }); }} onPointerDown={(e) => e.stopPropagation()}
            style={{ width: 26, height: 26, borderRadius: 6, border: `1px solid ${C.border}`, background: "#fff", color: C.textMuted, fontSize: 13, cursor: "pointer", lineHeight: 1 }}>
            ⌂
          </button>
        </div>
        <div style={{ position: "absolute", bottom: 0, right: 0, background: "rgba(255,255,255,.75)", fontSize: 9.5, color: C.textMuted, padding: "1px 5px", borderTopLeftRadius: 6, pointerEvents: "none" }}>
          © OpenStreetMap
        </div>
      </div>
      <div style={{ fontSize: 10.5, color: C.textDim, marginTop: 4, textAlign: "center" }}>
        Ziehen zum Verschieben · +/− zum Zoomen · ⌂ setzt die Ansicht zurück
      </div>
    </div>
  );
}

// SoLV-Verlauf als schlichte Sparkline (kein Chart-Import noetig fuer v1).
function Sparkline({ points, width = 220, height = 48 }) {
  if (!points || points.length < 2) return null;
  const max = Math.max(...points.map((p) => p.v), 1);
  const step = width / (points.length - 1);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(height - (p.v / max) * (height - 6) - 3).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <path d={path} fill="none" stroke={C.accent} strokeWidth="2" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={i * step} cy={height - (p.v / max) * (height - 6) - 3} r="2.5" fill={C.accent} />
      ))}
    </svg>
  );
}

export default function LocalGridDashboard({ selectedClient }) {
  const clientId = selectedClient?.id;
  const [runs, setRuns] = useState(null); // null = laedt, [] = keine Daten
  const [kwSel, setKwSel] = useState(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!clientId || !isUuid(clientId)) { setRuns([]); return; }
      setRuns(null);
      try {
        const { data } = await supabase
          .from("audit_runs")
          .select("id, result, created_at")
          .eq("client_id", clientId)
          .eq("audit_type", "geo_grid")
          .eq("status", "succeeded")
          .order("created_at", { ascending: false })
          .limit(12);
        if (alive) setRuns(data || []);
      } catch {
        if (alive) setRuns([]);
      }
    })();
    return () => { alive = false; };
  }, [clientId, nonce]);

  const latest = runs?.[0]?.result || null;
  const prev = runs?.[1]?.result || null;
  const keywords = useMemo(() => (Array.isArray(latest?.keywords) ? latest.keywords : []), [latest]);

  // Keyword-Auswahl: erste Zeile als Default; bei Kunden-/Datenwechsel zuruecksetzen.
  useEffect(() => {
    if (keywords.length && !keywords.some((k) => k.keyword === kwSel)) setKwSel(keywords[0].keyword);
  }, [keywords, kwSel]);
  const kw = keywords.find((k) => k.keyword === kwSel) || keywords[0] || null;
  const kwPrev = useMemo(
    () => (Array.isArray(prev?.keywords) ? prev.keywords.find((k) => k.keyword === (kw?.keyword ?? "")) : null) || null,
    [prev, kw],
  );

  // SoLV-Verlauf ueber alle geladenen Laeufe (aeltester zuerst) fuer das Keyword.
  const trend = useMemo(() => {
    if (!kw || !Array.isArray(runs)) return [];
    return runs
      .map((r) => {
        const row = (r.result?.keywords || []).find((k) => k.keyword === kw.keyword);
        return row ? { d: String(r.result?.date || r.created_at || "").slice(0, 10), v: Number(row.top3Share ?? 0) } : null;
      })
      .filter(Boolean)
      .reverse();
  }, [runs, kw]);

  const n = Number(latest?.grid || 0);
  const matrix = Array.isArray(kw?.matrix) ? kw.matrix : [];

  if (runs === null)
    return <div style={{ color: C.textMuted, fontSize: 13, padding: 24 }}>Lade Local Grid…</div>;

  if (!latest || !keywords.length)
    return (
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "44px 24px", textAlign: "center" }}>
        <MapPin size={28} style={{ color: C.accent, marginBottom: 10 }} />
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Noch keine Local-Grid-Messung</div>
        <div style={{ fontSize: 13, color: C.textMuted, marginTop: 6, maxWidth: 460, margin: "6px auto 0" }}>
          Der wöchentliche Maps-Scan (freitags) legt die Baseline an. Local Grid ist nur für Kunden
          mit physischem Standort bzw. Google Business Profile sinnvoll.
        </div>
      </div>
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Kopf: Datenstatus (Quelle, Stand, Aktion) + Grid-Meta */}
      <DataStatus
        items={[
          {
            source: "Local Grid (DataForSEO Maps)",
            lastAt: String(latest.date || latest.fetched_at || "").slice(0, 10) || null,
            // Wochenkadenz (freitags): nach 9 Tagen gilt die Messung als veraltet.
            staleDays: 9,
            detail: "wöchentlicher Maps-Scan, freitags",
          },
        ]}
        action={{ label: "Aktualisieren", onClick: () => setNonce((x) => x + 1) }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, color: C.textMuted }}>
          Messung vom <b style={{ color: C.text }}>{String(latest.date || latest.fetched_at || "").slice(0, 10)}</b>
          {" • "}{n}×{n}-Raster, {fmt(latest.stepKm)} km Schritt
          {latest.center ? ` • Zentrum ${fmt(latest.center.lat, 4)}, ${fmt(latest.center.lng, 4)}` : ""}
        </span>
      </div>

      {/* Keyword-Pills */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {keywords.map((k) => {
          const on = k.keyword === kw?.keyword;
          return (
            <button
              key={k.keyword}
              onClick={() => setKwSel(k.keyword)}
              style={{
                border: `1px solid ${on ? C.accent : C.border}`,
                background: on ? C.accentDim : C.card,
                color: on ? C.accent : C.textMuted,
                borderRadius: 99, padding: "6px 13px", fontSize: 12.5, fontWeight: on ? 700 : 500, cursor: "pointer",
              }}
            >
              {k.keyword}
            </button>
          );
        })}
      </div>

      {/* Metrik-Kacheln (Auswahl-Keyword) mit Delta zur Vormessung */}
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <Tile
          label="SoLV (Top 3)"
          value={`${fmt(kw?.top3Share)}%`}
          sub="Anteil Rasterpunkte in den Top 3"
          delta={<Delta cur={kw?.top3Share} prev={kwPrev?.top3Share} suffix="%" />}
        />
        <Tile
          label="ARP (Ø Rang)"
          value={fmt(kw?.avgRank, 2)}
          sub="nur Punkte mit Ranking"
          delta={<Delta cur={kw?.avgRank} prev={kwPrev?.avgRank} invert />}
        />
        <Tile
          label="ATRP (ehrlicher Ø)"
          value={fmt(kw?.atrp, 2)}
          sub="alle Punkte, nicht gefunden = 21"
          delta={<Delta cur={kw?.atrp} prev={kwPrev?.atrp} invert />}
        />
        <Tile
          label="Abdeckung"
          value={`${fmt(kw?.coverage)}%`}
          sub={`${kw?.ranked ?? 0} von ${kw?.points ?? 0} Punkten`}
          delta={<Delta cur={kw?.coverage} prev={kwPrev?.coverage} suffix="%" />}
        />
      </div>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        {/* Heatmap */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 12 }}>
            Maps-Heatmap — „{kw?.keyword}"
          </div>
          <MapHeatmap center={latest.center} n={n} stepKm={latest.stepKm} matrix={matrix} />
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12, fontSize: 11, color: C.textMuted }}>
            {[["1–3", "#0f9d6c"], ["4–7", "#7cb342"], ["8–10", "#eab308"], ["11–15", "#f97316"], ["16–20", "#dc2626"], ["nicht gefunden", "#8b8494"]].map(([l, col]) => (
              <span key={l} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 11, height: 11, borderRadius: 3, background: col, border: `1px solid ${C.border}`, display: "inline-block" }} />
                {l}
              </span>
            ))}
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 11, height: 11, borderRadius: 3, border: `2px solid ${C.accent}`, display: "inline-block" }} />
              Standort
            </span>
          </div>
        </div>

        {/* Konkurrenz + Verlauf */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>
              Wer dominiert das Raster? (Top 3)
            </div>
            {Array.isArray(kw?.competitors) && kw.competitors.length ? (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ color: C.textMuted, textAlign: "left" }}>
                    <th style={{ padding: "4px 6px", fontWeight: 600 }}>Anbieter</th>
                    <th style={{ padding: "4px 6px", fontWeight: 600, textAlign: "right" }}>In Top 3</th>
                    <th style={{ padding: "4px 6px", fontWeight: 600, textAlign: "right" }}>Ø Rang</th>
                  </tr>
                </thead>
                <tbody>
                  {kw.competitors.map((cp, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: "6px", color: C.text, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={cp.domain || cp.name}>
                        {cp.name || cp.domain}
                      </td>
                      <td style={{ padding: "6px", textAlign: "right", color: C.text, fontWeight: 600 }}>{fmt(cp.top3Share)}%</td>
                      <td style={{ padding: "6px", textAlign: "right", color: C.textMuted }}>{fmt(cp.avgRank, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ fontSize: 12, color: C.textDim }}>
                Konkurrenz-Daten ab der nächsten Messung verfügbar.
              </div>
            )}
          </div>
          {trend.length >= 2 && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 8 }}>SoLV-Verlauf</div>
              <Sparkline points={trend} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: C.textDim, marginTop: 4 }}>
                <span>{trend[0]?.d}</span>
                <span>{trend[trend.length - 1]?.d}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Alle Keywords im Ueberblick */}
      {keywords.length > 1 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, overflowX: "auto" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>Alle Keywords</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 520 }}>
            <thead>
              <tr style={{ color: C.textMuted, textAlign: "left" }}>
                <th style={{ padding: "4px 6px", fontWeight: 600 }}>Keyword</th>
                <th style={{ padding: "4px 6px", fontWeight: 600, textAlign: "right" }}>SoLV</th>
                <th style={{ padding: "4px 6px", fontWeight: 600, textAlign: "right" }}>ARP</th>
                <th style={{ padding: "4px 6px", fontWeight: 600, textAlign: "right" }}>ATRP</th>
                <th style={{ padding: "4px 6px", fontWeight: 600, textAlign: "right" }}>Abdeckung</th>
                <th style={{ padding: "4px 6px", fontWeight: 600, textAlign: "right" }}>Best / Schlechtester</th>
              </tr>
            </thead>
            <tbody>
              {keywords.map((k) => {
                const p = (Array.isArray(prev?.keywords) ? prev.keywords : []).find((x) => x.keyword === k.keyword);
                return (
                  <tr
                    key={k.keyword}
                    onClick={() => setKwSel(k.keyword)}
                    style={{ borderTop: `1px solid ${C.border}`, cursor: "pointer", background: k.keyword === kw?.keyword ? C.accentDim : "transparent" }}
                  >
                    <td style={{ padding: "7px 6px", color: C.text, fontWeight: 600 }}>{k.keyword}</td>
                    <td style={{ padding: "7px 6px", textAlign: "right", color: C.text }}>
                      {fmt(k.top3Share)}% <Delta cur={k.top3Share} prev={p?.top3Share} suffix="%" />
                    </td>
                    <td style={{ padding: "7px 6px", textAlign: "right", color: C.text }}>
                      {fmt(k.avgRank, 2)} <Delta cur={k.avgRank} prev={p?.avgRank} invert />
                    </td>
                    <td style={{ padding: "7px 6px", textAlign: "right", color: C.text }}>{fmt(k.atrp, 2)}</td>
                    <td style={{ padding: "7px 6px", textAlign: "right", color: C.textMuted }}>{fmt(k.coverage)}%</td>
                    <td style={{ padding: "7px 6px", textAlign: "right", color: C.textMuted }}>
                      {k.bestRank ?? "–"} / {k.worstRank ?? "–"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
