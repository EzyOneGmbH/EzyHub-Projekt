// «Woher kommen die Buchungen?» (06.10.2026): Karte Welt / Europa / Schweiz mit
// Blasen je Land bzw. Kanton (Kreisgroesse = Buchungen). d3-geo + world-atlas
// als React-SVG (wie AIVisibilityDashboard, ohne react-simple-maps).
import { useEffect, useMemo, useRef, useState } from "react";
import { geoCentroid, geoMercator, geoNaturalEarth1, geoPath } from "d3-geo";
import { feature as topoFeature } from "topojson-client";
import worldTopo110 from "world-atlas/countries-110m.json";
import { C } from "../theme";
import { chf, zahl } from "./adsUi";

const W = 960;
const H = 560;
const FEATURES_110 = topoFeature(worldTopo110, worldTopo110.objects.countries).features;

// Kantonsmittelpunkte [Laenge, Breite]; Schluessel = normalisierter Google-Name
// (englisch, teils «Canton of …») und deutsche/franzoesische Varianten.
const KANTONE = [
  [["zurich", "zuerich"], "Zürich", 8.65, 47.42],
  [["bern", "berne"], "Bern", 7.62, 46.82],
  [["lucerne", "luzern"], "Luzern", 8.11, 47.07],
  [["uri"], "Uri", 8.63, 46.77],
  [["schwyz"], "Schwyz", 8.75, 47.06],
  [["obwalden"], "Obwalden", 8.25, 46.85],
  [["nidwalden"], "Nidwalden", 8.4, 46.93],
  [["glarus"], "Glarus", 9.06, 46.98],
  [["zug"], "Zug", 8.54, 47.16],
  [["fribourg", "freiburg"], "Freiburg", 7.08, 46.7],
  [["solothurn"], "Solothurn", 7.64, 47.3],
  [["baselcity", "baselstadt"], "Basel-Stadt", 7.59, 47.56],
  [["basellandschaft", "baselcountry", "basellandschaft"], "Basel-Landschaft", 7.7, 47.45],
  [["schaffhausen"], "Schaffhausen", 8.6, 47.71],
  [["appenzellausserrhoden"], "Appenzell A.Rh.", 9.3, 47.37],
  [["appenzellinnerrhoden"], "Appenzell I.Rh.", 9.42, 47.32],
  [["stgallen", "sanktgallen"], "St. Gallen", 9.25, 47.23],
  [["grisons", "graubuenden", "graubunden"], "Graubünden", 9.63, 46.65],
  [["aargau"], "Aargau", 8.15, 47.4],
  [["thurgau"], "Thurgau", 9.1, 47.57],
  [["ticino", "tessin"], "Tessin", 8.8, 46.3],
  [["vaud", "waadt"], "Waadt", 6.55, 46.57],
  [["valais", "wallis"], "Wallis", 7.6, 46.21],
  [["neuchatel", "neuenburg"], "Neuenburg", 6.78, 47.0],
  [["geneva", "geneve", "genf"], "Genf", 6.15, 46.2],
  [["jura"], "Jura", 7.15, 47.35],
];
const normKanton = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/canton of |kanton |canton de /g, "")
    .replace(/[^a-z]/g, "");
const kantonFuer = (name) => {
  const k = normKanton(name);
  return KANTONE.find(([keys]) => keys.includes(k)) || null;
};

const isoVonKriterium = (id) => {
  const n = Number(id) - 2000;
  return n > 0 && n < 1000 ? String(n).padStart(3, "0") : null;
};

export default function AdsKarte({ herkunft }) {
  const laender = useMemo(() => herkunft?.laender ?? [], [herkunft]);
  const regionen = useMemo(() => herkunft?.regionen ?? [], [herkunft]);
  const chAnteil = laender.find((l) => l.countryCode === "CH")?.anteil ?? 0;
  const [ansicht, setAnsicht] = useState(chAnteil >= 90 ? "schweiz" : "europa");
  const [features, setFeatures] = useState(FEATURES_110);
  const [zoom, setZoom] = useState({ k: 1, x: 0, y: 0 });
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);
  const rahmenRef = useRef(null);
  const zieh = useRef(null);

  // Feinere Konturen fuer Europa/Schweiz erst bei Bedarf nachladen: europa-50m.json
  // (aus world-atlas 50m, nur Europa, gerundet — die volle 50m-Karte sprengt das
  // 500-KB-Chunk-Budget). Uebrige Laender bleiben aus der 110m-Karte.
  useEffect(() => {
    if (ansicht === "welt" || features !== FEATURES_110) return;
    let aktiv = true;
    import("./europa-50m.json").then((m) => {
      const fein = new Map(((m.default || m).features || []).map((f) => [String(f.id), f]));
      if (aktiv) setFeatures(FEATURES_110.map((f) => fein.get(String(f.id)) || f));
    });
    return () => {
      aktiv = false;
    };
  }, [ansicht, features]);
  useEffect(() => setZoom({ k: 1, x: 0, y: 0 }), [ansicht]);

  const { pfad, projektion } = useMemo(() => {
    let p;
    if (ansicht === "welt") {
      p = geoNaturalEarth1().fitExtent(
        [
          [10, 10],
          [W - 10, H - 10],
        ],
        { type: "Sphere" },
      );
    } else if (ansicht === "schweiz") {
      const ch = features.find((f) => String(f.id) === "756");
      p = geoMercator().fitExtent(
        [
          [60, 40],
          [W - 60, H - 40],
        ],
        ch || { type: "Point", coordinates: [8.2, 46.8] },
      );
    } else {
      p = geoMercator().fitExtent(
        [
          [0, 0],
          [W, H],
        ],
        {
          type: "Polygon",
          coordinates: [
            [
              [-11, 35],
              [32, 35],
              [32, 66],
              [-11, 66],
              [-11, 35],
            ],
          ],
        },
      );
    }
    return { projektion: p, pfad: geoPath(p) };
  }, [ansicht, features]);

  const featureNachId = useMemo(() => new Map(features.map((f) => [String(f.id), f])), [features]);
  const mitBuchung = new Set(
    laender.filter((l) => l.conversions > 0).map((l) => isoVonKriterium(l.id)),
  );

  const blasen = useMemo(() => {
    if (ansicht === "schweiz") {
      const ch = regionen.filter((r) => r.countryCode === "CH" && r.conversions > 0);
      const summe = ch.reduce((s, r) => s + r.conversions, 0);
      return ch
        .map((r) => {
          const k = kantonFuer(r.name);
          if (!k) return null;
          const [x, y] = projektion([k[2], k[3]]) || [];
          return x == null
            ? null
            : {
                key: r.id,
                name: k[1],
                wert: r.conversions,
                value: r.value,
                anteil: summe ? (r.conversions / summe) * 100 : 0,
                x,
                y,
              };
        })
        .filter(Boolean);
    }
    return laender
      .filter((l) => l.conversions > 0)
      .map((l) => {
        const f = featureNachId.get(isoVonKriterium(l.id));
        if (!f) return null;
        const [x, y] = projektion(geoCentroid(f)) || [];
        return x == null
          ? null
          : {
              key: l.id,
              name: l.anzeige,
              wert: l.conversions,
              value: l.value,
              anteil: l.anteil,
              x,
              y,
            };
      })
      .filter(Boolean);
  }, [ansicht, regionen, laender, projektion, featureNachId]);
  const max = Math.max(1, ...blasen.map((b) => b.wert));
  const radius = (v) => 11 + 21 * Math.sqrt(v / max);

  // Zoom/Verschieben (Ziehen, Doppelklick, +/−) — Konturen bleiben fein.
  const punkt = (e) => {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  };
  const zoomUm = (faktor, cx = W / 2, cy = H / 2) =>
    setZoom((z) => {
      const k = Math.min(8, Math.max(1, z.k * faktor));
      const f = k / z.k;
      return k === 1 ? { k: 1, x: 0, y: 0 } : { k, x: cx - (cx - z.x) * f, y: cy - (cy - z.y) * f };
    });

  // Tooltip an der echten Bildschirmposition der Blase (Karte ist zentriert skaliert).
  const zeigeTooltip = (b) => {
    const svg = svgRef.current;
    const rahmen = rahmenRef.current?.getBoundingClientRect();
    const ctm = svg?.getScreenCTM?.();
    if (!svg || !rahmen || !ctm) return setHover({ ...b, px: 0, py: 0, breite: 400 });
    const pt = svg.createSVGPoint();
    pt.x = b.x * zoom.k + zoom.x;
    pt.y = b.y * zoom.k + zoom.y;
    const s = pt.matrixTransform(ctm);
    setHover({ ...b, px: s.x - rahmen.left, py: s.y - rahmen.top, breite: rahmen.width });
  };

  const ansichten = [
    ["welt", "Welt"],
    ["europa", "Europa"],
    ["schweiz", "Schweiz"],
  ];
  const keineDaten = blasen.length === 0;

  return (
    <div
      ref={rahmenRef}
      style={{
        position: "relative",
        background: "#f7f1f8",
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        overflow: "hidden",
        minWidth: 0,
      }}
    >
      <div style={{ position: "absolute", top: 14, left: 14, zIndex: 2 }}>
        <div
          style={{
            display: "inline-flex",
            gap: 2,
            background: "#fff",
            borderRadius: 999,
            padding: 4,
            boxShadow: C.segShadow,
          }}
        >
          {ansichten.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setAnsicht(id)}
              style={{
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 13,
                fontWeight: ansicht === id ? 700 : 500,
                padding: "6px 14px",
                borderRadius: 999,
                color: ansicht === id ? "#fff" : C.textMuted,
                background: ansicht === id ? C.accent : "transparent",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          top: 14,
          right: 14,
          zIndex: 2,
          display: "flex",
          flexDirection: "column",
          background: "#fff",
          borderRadius: 10,
          boxShadow: C.segShadow,
          overflow: "hidden",
        }}
      >
        {[
          ["+", 1.6, "Hineinzoomen"],
          ["−", 1 / 1.6, "Herauszoomen"],
        ].map(([z, f, t]) => (
          <button
            key={z}
            type="button"
            aria-label={t}
            title={t}
            onClick={() => zoomUm(f)}
            style={{
              width: 36,
              height: 36,
              border: "none",
              borderTop: z === "−" ? `1px solid ${C.border}` : "none",
              background: "#fff",
              cursor: "pointer",
              fontSize: 16,
              color: C.text,
              fontFamily: "inherit",
            }}
          >
            {z}
          </button>
        ))}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{
          display: "block",
          width: "100%",
          // Kompakte, feste Hoehe wie im Mockup; der Ausschnitt wird zentriert
          // (preserveAspectRatio meet) statt mit der Breite mitzuwachsen.
          height: "clamp(260px, 25vw, 360px)",
          touchAction: "pan-y",
          cursor: "grab",
        }}
        onDoubleClick={(e) => {
          const p = punkt(e);
          zoomUm(1.8, p.x, p.y);
        }}
        onPointerDown={(e) => {
          const p = punkt(e);
          zieh.current = { px: p.x, py: p.y, x: zoom.x, y: zoom.y };
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!zieh.current) return;
          const p = punkt(e);
          const s = zieh.current;
          setZoom((z) => ({ ...z, x: s.x + p.x - s.px, y: s.y + p.y - s.py }));
        }}
        onPointerUp={() => (zieh.current = null)}
        onPointerLeave={() => (zieh.current = null)}
      >
        <g transform={`translate(${zoom.x},${zoom.y}) scale(${zoom.k})`}>
          {features.map((f) => {
            const iso = String(f.id);
            const aktiv = mitBuchung.has(iso);
            const d = pfad(f);
            if (!d) return null;
            return (
              <path
                key={iso + (f.properties?.name || "")}
                d={d}
                fill={
                  aktiv ? "#e3c2e9" : iso === "756" && ansicht === "schweiz" ? "#ead7ee" : "#ece4ee"
                }
                stroke="#fff"
                strokeWidth={ansicht === "schweiz" ? 1.2 : 0.7}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          {[...blasen]
            .sort((a, b) => b.wert - a.wert)
            .map((b) => {
              const r = radius(b.wert) / Math.sqrt(zoom.k);
              const gross = b.wert === max;
              return (
                <g
                  key={b.key}
                  transform={`translate(${b.x},${b.y})`}
                  onPointerEnter={() => zeigeTooltip(b)}
                  onPointerLeave={() => setHover(null)}
                  onClick={() => zeigeTooltip(b)}
                  style={{ cursor: "pointer" }}
                >
                  <circle
                    r={r}
                    fill={gross ? C.darkPurple : C.accent}
                    fillOpacity={gross ? 1 : 0.9}
                    stroke="#fff"
                    strokeWidth={2.5}
                    vectorEffect="non-scaling-stroke"
                  />
                  {r * zoom.k >= 12 && (
                    <text
                      textAnchor="middle"
                      dy="0.35em"
                      fontSize={(gross ? 19 : 15) / zoom.k}
                      fontWeight={800}
                      fill="#fff"
                      style={{ pointerEvents: "none" }}
                    >
                      {zahl(b.wert)}
                    </text>
                  )}
                </g>
              );
            })}
        </g>
      </svg>

      {hover && (
        <div
          style={{
            position: "absolute",
            left: Math.max(8, Math.min(hover.px + 24, hover.breite - 222)),
            top: Math.max(8, hover.py - 36),
            background: "#fff",
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            boxShadow: "0 12px 30px -14px rgba(43,0,51,.35)",
            padding: "10px 14px",
            fontSize: 13,
            color: C.text,
            pointerEvents: "none",
            minWidth: 190,
            zIndex: 3,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 3 }}>{hover.name}</div>
          <div style={{ color: C.textMuted }}>
            {zahl(hover.wert)} {hover.wert === 1 ? "Buchung" : "Buchungen"} ·{" "}
            {Math.round(hover.anteil)} %
          </div>
          {hover.value > 0 && (
            <div style={{ color: C.textMuted }}>
              Conversion-Wert <b style={{ color: C.text }}>{chf(hover.value)}</b>
            </div>
          )}
        </div>
      )}

      {keineDaten ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              background: "#fff",
              borderRadius: 10,
              padding: "8px 14px",
              fontSize: 13,
              color: C.textMuted,
              boxShadow: C.segShadow,
            }}
          >
            {ansicht === "schweiz"
              ? "Keine Buchungen mit Kantonsangabe im Zeitraum."
              : "Keine Buchungen mit Länderangabe im Zeitraum."}
          </span>
        </div>
      ) : (
        <div
          style={{
            position: "absolute",
            left: 14,
            bottom: 14,
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "#fff",
            borderRadius: 999,
            padding: "6px 14px",
            fontSize: 12,
            color: C.textMuted,
            boxShadow: C.segShadow,
          }}
        >
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: C.accent }} />
          1 Buchung
          <span style={{ width: 20, height: 20, borderRadius: "50%", background: C.accent }} />
          {zahl(max)} {max === 1 ? "Buchung" : "Buchungen"}
        </div>
      )}
    </div>
  );
}
