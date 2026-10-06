// EzyRank — Agentur-Performance-Tabelle (29.09.2026, analog EzyPerformance
// AdsAgencyTable): alle SEO-Kunden in einer Tabelle mit Zeitraum/Vergleich aus
// der Kopfzeile. Traffic = GA4 «Organic Search» (Fallback Search Console),
// Top 3 / Top 10 aus dem Rankings-Lauf, Visibility Index aus Sistrix (CH).
import { cacheGet, cachePut } from "./data/rangeStore";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Download, Search } from "lucide-react";
import { ezyFetch } from "@/ezy/data/api";
import { ClientAvatar } from "@/ezy/ClientAvatar";
import { C } from "./theme";
import { compareName, downloadFile, pctDelta } from "./ui-kit";

const PAGE = 25;

// Lokales Datum (nicht toISOString — das kippt ab Mitternacht CH in den Vortag).
const ymd = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const dmy = (s) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : "");

const n0 = (v) => Math.round(v).toLocaleString("de-CH");
const pct = (v) => `${v.toFixed(1).replace(".", ",")} %`;
// Sistrix-Sichtbarkeitsindex lesbar (wie SEO-Dashboard fmtVi).
const vi = (v) =>
  (v >= 10 ? v.toFixed(1) : v >= 0.1 ? v.toFixed(2) : v.toFixed(4)).replace(".", ",");

function ableiten(k) {
  if (!k) return null;
  return {
    ...k,
    chShare:
      k.traffic != null && k.traffic > 0 && k.trafficCh != null
        ? (k.trafficCh / k.traffic) * 100
        : null,
  };
}
// Summen: Traffic und Keyword-Anzahlen sind addierbar, der Sichtbarkeitsindex nicht.
function summe(list) {
  const out = { traffic: null, trafficCh: null, top3: null, top10: null, visibility: null };
  for (const k of list) {
    if (!k) continue;
    for (const key of ["traffic", "trafficCh", "top3", "top10"]) {
      if (k[key] == null) continue;
      out[key] = (out[key] ?? 0) + Number(k[key]);
    }
  }
  return ableiten(out);
}

// delta: "pct" = prozentual, "abs" = absolute Differenz (Keyword-Anzahlen).
const SPALTEN = [
  {
    key: "traffic",
    label: "Org. Traffic",
    fmt: n0,
    delta: "pct",
    hint: "Sitzungen aus der organischen Suche (GA4, Kanal «Organic Search»). Ohne GA4: Google-Klicks aus der Search Console (markiert mit GSC).",
  },
  {
    key: "trafficCh",
    label: "Traffic CH",
    fmt: n0,
    delta: "pct",
    hint: "Organischer Traffic aus der Schweiz (gleiche Quelle wie Org. Traffic)",
  },
  {
    key: "chShare",
    label: "CH-Anteil",
    fmt: pct,
    delta: null,
    hint: "Anteil des Schweizer Traffics am organischen Traffic",
  },
  {
    key: "top3",
    label: "Top 3",
    fmt: n0,
    delta: "abs",
    group: "rank",
    hint: "Keywords auf Platz 1–3 (Rankings-Crawl, Stand zum Zeitraum-Ende)",
  },
  {
    key: "top10",
    label: "Top 10",
    fmt: n0,
    delta: "abs",
    group: "rank",
    hint: "Keywords auf Platz 1–10 (Rankings-Crawl, Stand zum Zeitraum-Ende)",
  },
  {
    key: "visibility",
    label: "Visibility Index",
    fmt: vi,
    delta: "pct",
    group: "rank",
    hint: "Sistrix-Sichtbarkeitsindex (Stand zum Zeitraum-Ende) — Schweiz, sofern beim Kunden kein anderes Sistrix-Land gewählt ist (Marke z. B. «FR»)",
  },
];

const FILTER = [
  { id: "alle", label: "Alle Kunden" },
  { id: "trafficPlus", label: "Traffic gestiegen" },
  { id: "trafficMinus", label: "Traffic gesunken" },
  { id: "top10Minus", label: "Top 10 verloren" },
  { id: "ohneTraffic", label: "Ohne Traffic-Daten" },
  { id: "hinweise", label: "Mit Datenhinweisen" },
];

function Delta({ cur, prev, mode }) {
  if (cur == null || prev == null)
    return <span style={{ fontSize: 10.5, color: C.textFaint }}>—</span>;
  const d = mode === "abs" ? cur - prev : pctDelta(cur, prev);
  if (d == null) return <span style={{ fontSize: 10.5, color: C.textFaint }}>—</span>;
  const up = d > 0;
  const gut = d === 0 ? null : up;
  const color = gut == null ? C.textMuted : gut ? C.green : C.red;
  const bg = gut == null ? C.segBg : gut ? C.greenDim : C.redDim;
  const txt =
    mode === "abs"
      ? `${d > 0 ? "+" : ""}${Math.round(d).toLocaleString("de-CH")}`
      : `${d > 0 ? "+" : ""}${d.toFixed(1).replace(".", ",")} %`;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        fontSize: 10.5,
        fontWeight: 600,
        color,
        background: bg,
        borderRadius: 999,
        padding: "1px 7px",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      {up ? "↗" : d < 0 ? "↘" : "→"} {txt}
    </span>
  );
}

export function SeoAgencyTable({ clients, dateRange, onSelect, onCompareMode = null }) {
  const [data, setData] = useState({ loading: true, rows: {}, range: null, prevRange: null });
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("alle");
  const [sort, setSort] = useState({ key: "traffic", dir: -1 });
  const [page, setPage] = useState(0);
  const mitVergleich = !!dateRange?.compare;

  // Stabil über den Inhalt (02.10.): die Kundenliste kommt bei jedem Neuzeichnen
  // als neues Array — sonst lud die Tabelle z. B. schon beim Öffnen des
  // Kunden-Menüs komplett neu (Live-Abfrage, ~10 s).
  const idsKey = clients
    .map((c) => c.id)
    .filter(Boolean)
    .join(",");
  const ids = useMemo(() => (idsKey ? idsKey.split(",") : []), [idsKey]);
  const startDate = dateRange?.start ? ymd(dateRange.start) : null;
  const endDate = dateRange?.end ? ymd(dateRange.end) : null;
  const compareStart = dateRange?.compare?.start ? ymd(dateRange.compare.start) : null;
  const compareEnd = dateRange?.compare?.end ? ymd(dateRange.compare.end) : null;

  useEffect(() => {
    if (!ids.length || !startDate || !endDate) return;
    let alive = true;
    // Browser-Zwischenspeicher (06.10.2026): letzter Stand sofort, frisch dahinter.
    const cacheKey = `seoTabelle:${idsKey}|${startDate}|${endDate}|${compareStart}|${compareEnd}`;
    const gespeichert = cacheGet(cacheKey);
    if (gespeichert) setData({ loading: false, ...gespeichert.data });
    else setData((d) => ({ ...d, loading: true }));
    setError("");
    (async () => {
      try {
        const bloecke = [];
        for (let i = 0; i < ids.length; i += 40) bloecke.push(ids.slice(i, i + 40));
        const antworten = await Promise.all(
          bloecke.map(async (clientIds) => {
            const body = { clientIds, startDate, endDate };
            if (compareStart && compareEnd) Object.assign(body, { compareStart, compareEnd });
            const res = await ezyFetch("/api/google/seo-overview", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            const json = await res.json().catch(() => ({}));
            if (!json?.ok) throw new Error(json?.error || `HTTP ${res.status}`);
            return json;
          }),
        );
        if (!alive) return;
        const rows = {};
        for (const a of antworten) for (const r of a.rows || []) rows[r.clientId] = r;
        const frisch = {
          rows,
          range: antworten[0]?.range ?? null,
          prevRange: antworten[0]?.prevRange ?? null,
        };
        cachePut(cacheKey, frisch);
        setData({ loading: false, ...frisch });
      } catch (e) {
        if (!alive) return;
        // Mit gespeichertem Stand im Bild keinen Fehler einblenden.
        if (!gespeichert) setError(e?.message || String(e));
        setData((d) => ({ ...d, loading: false }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [ids, idsKey, startDate, endDate, compareStart, compareEnd]);

  useEffect(() => setPage(0), [query, filter, sort, ids]);

  const zeilen = useMemo(
    () =>
      clients.map((c) => {
        const r = data.rows[c.id];
        return {
          client: c,
          cur: ableiten(r?.cur),
          prev: mitVergleich ? ableiten(r?.prev) : null,
          quelle: r?.trafficQuelle ?? null,
          rankVergleich: r?.rankVergleich ?? null,
          rankVergleichGrund: r?.rankVergleichGrund ?? null,
          visibilityLand: r?.visibilityLand ?? null,
          stand: r?.stand ?? null,
          hinweise: r?.hinweise || [],
          error: r?.error || null,
        };
      }),
    [clients, data.rows, mitVergleich],
  );

  const gefiltert = useMemo(() => {
    const q = query.trim().toLowerCase();
    const passt = (z) => {
      if (q && !`${z.client.name || ""} ${z.client.domain || ""}`.toLowerCase().includes(q))
        return false;
      switch (filter) {
        case "trafficPlus":
          return (
            z.cur?.traffic != null && z.prev?.traffic != null && z.cur.traffic > z.prev.traffic
          );
        case "trafficMinus":
          return (
            z.cur?.traffic != null && z.prev?.traffic != null && z.cur.traffic < z.prev.traffic
          );
        case "top10Minus":
          return z.cur?.top10 != null && z.prev?.top10 != null && z.cur.top10 < z.prev.top10;
        case "ohneTraffic":
          return z.cur?.traffic == null;
        case "hinweise":
          return !!z.error || z.hinweise.length > 0;
        default:
          return true;
      }
    };
    const val = (z) =>
      sort.key === "name" ? String(z.client.name || "").toLowerCase() : (z.cur?.[sort.key] ?? null);
    return zeilen.filter(passt).sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // leere Werte immer ans Ende
      if (vb == null) return -1;
      return va < vb ? -sort.dir : va > vb ? sort.dir : 0;
    });
  }, [zeilen, query, filter, sort]);

  const gesamt = useMemo(() => {
    const cur = summe(gefiltert.map((z) => z.cur));
    let prev = mitVergleich ? summe(gefiltert.map((z) => z.prev)) : null;
    // Keyword-Summen nur vergleichen, wenn JEDER Kunde mit Rankings einen
    // vergleichbaren Vorwert hat — sonst mischt die Summe Messmethoden.
    if (prev) {
      const mitRank = gefiltert.filter((z) => z.cur?.top10 != null);
      if (mitRank.some((z) => z.prev?.top10 == null)) prev = { ...prev, top3: null, top10: null };
    }
    return { cur, prev };
  }, [gefiltert, mitVergleich]);
  const methodenwechsel = zeilen.some((z) => z.rankVergleich === "methodenwechsel");

  const seiten = Math.max(1, Math.ceil(gefiltert.length / PAGE));
  const sichtbar = gefiltert.slice(page * PAGE, page * PAGE + PAGE);

  const exportCsv = () => {
    const kopf = ["Kunde", "Domain", "Traffic-Quelle", ...SPALTEN.map((s) => s.label)];
    if (mitVergleich) kopf.push(...SPALTEN.map((s) => `${s.label} (Vergleich)`));
    kopf.push("Stand Rankings", "Stand Visibility", "Hinweise");
    const zahl = (v) => (v == null ? "" : String(Math.round(v * 10000) / 10000).replace(".", ","));
    const zeileCsv = (name, domain, quelle, cur, prev, stand, hinweise) => [
      name,
      domain,
      quelle,
      ...SPALTEN.map((s) => zahl(cur?.[s.key])),
      ...(mitVergleich ? SPALTEN.map((s) => zahl(prev?.[s.key])) : []),
      stand?.cur?.rank ? dmy(stand.cur.rank) : "",
      stand?.cur?.visibility ? dmy(stand.cur.visibility) : "",
      hinweise,
    ];
    const lines = [
      kopf,
      ...gefiltert.map((z) =>
        zeileCsv(
          z.client.name,
          z.client.domain || "",
          z.quelle === "ga4" ? "GA4" : z.quelle === "gsc" ? "Search Console" : "",
          z.cur,
          z.prev,
          z.stand,
          [z.error, ...z.hinweise].filter(Boolean).join(" · "),
        ),
      ),
      zeileCsv("Gesamt", "", "", gesamt.cur, gesamt.prev, null, ""),
    ].map((l) => l.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(";"));
    downloadFile(
      "﻿" + lines.join("\n"),
      "text/csv;charset=utf-8",
      `seo-report-alle-kunden_${startDate}_${endDate}.csv`,
    );
  };

  const th = {
    padding: "10px 12px",
    fontSize: 11.5,
    fontWeight: 600,
    color: C.textMuted,
    textAlign: "right",
    whiteSpace: "nowrap",
    cursor: "pointer",
    userSelect: "none",
    background: "#faf7fb",
    borderBottom: `1px solid ${C.border}`,
  };
  const td = {
    padding: "9px 12px",
    textAlign: "right",
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
    borderBottom: `1px solid ${C.hairline}`,
    verticalAlign: "top",
  };
  const rankBg = "rgba(119,0,140,.035)";
  const gruppe = { cursor: "default", padding: "6px 12px 4px" };
  const stickyName = { position: "sticky", left: 0, zIndex: 1 };

  const SortKopf = ({ col }) => (
    <th
      title={col.hint}
      onClick={() => setSort((s) => ({ key: col.key, dir: s.key === col.key ? -s.dir : -1 }))}
      style={{
        ...th,
        color: sort.key === col.key ? C.accent : C.textMuted,
        background: col.group === "rank" ? "#f5eef7" : th.background,
      }}
    >
      {col.label}
      {sort.key === col.key &&
        (sort.dir === -1 ? (
          <ArrowDown
            size={11}
            style={{ display: "inline-block", marginLeft: 3, verticalAlign: -1 }}
          />
        ) : (
          <ArrowUp
            size={11}
            style={{ display: "inline-block", marginLeft: 3, verticalAlign: -1 }}
          />
        ))}
    </th>
  );

  const standTitel = (col, stand) => {
    if (!stand) return undefined;
    if (col.key === "visibility" && stand.cur?.visibility)
      return `Sistrix-Stand ${dmy(stand.cur.visibility)}${stand.prev?.visibility ? ` · Vergleich ${dmy(stand.prev.visibility)}` : ""}`;
    if ((col.key === "top3" || col.key === "top10") && stand.cur?.rank)
      return `Rankings-Stand ${dmy(stand.cur.rank)}${stand.prev?.rank ? ` · Vergleich ${dmy(stand.prev.rank)}` : ""}`;
    return undefined;
  };

  const zelle = (
    col,
    cur,
    prev,
    {
      fett = false,
      quelle = null,
      stand = null,
      rankVergleich = null,
      rankVergleichGrund = null,
      visibilityLand = null,
    } = {},
  ) => (
    <td
      key={col.key}
      title={standTitel(col, stand)}
      style={{
        ...td,
        background: col.group === "rank" ? rankBg : undefined,
        fontWeight: fett ? 700 : 400,
      }}
    >
      <div style={{ color: C.text, fontSize: 13 }}>
        {cur?.[col.key] == null ? (
          <span style={{ color: C.textFaint }}>—</span>
        ) : (
          <>
            {col.fmt(cur[col.key])}
            {col.key === "traffic" && quelle === "gsc" && (
              <span
                title="Kein GA4 — Google-Klicks aus der Search Console"
                style={{
                  marginLeft: 6,
                  fontSize: 9.5,
                  fontWeight: 700,
                  color: C.orange,
                  background: "rgba(245,158,11,.12)",
                  borderRadius: 5,
                  padding: "1px 5px",
                  verticalAlign: 1,
                }}
              >
                GSC
              </span>
            )}
            {col.key === "visibility" && visibilityLand && visibilityLand !== "ch" && (
              <span
                title={`Sistrix-Index ${visibilityLand.toUpperCase()} statt Schweiz (Einstellung je Kunde)`}
                style={{
                  marginLeft: 6,
                  fontSize: 9.5,
                  fontWeight: 700,
                  color: C.accent,
                  background: C.accentDim,
                  borderRadius: 5,
                  padding: "1px 5px",
                  verticalAlign: 1,
                }}
              >
                {visibilityLand.toUpperCase()}
              </span>
            )}
          </>
        )}
      </div>
      {mitVergleich && col.delta && (
        <div style={{ marginTop: 3 }}>
          {rankVergleich === "methodenwechsel" && (col.key === "top3" || col.key === "top10") ? (
            <span
              title={`Kein Vergleich: ${rankVergleichGrund || "Vergleichslauf nach einer anderen Methode gezählt"}. Ein Delta wäre ein Methodeneffekt, kein Ranking-Verlust.`}
              style={{ fontSize: 10, color: C.textMuted, whiteSpace: "nowrap" }}
            >
              Methode geändert
            </span>
          ) : (
            <Delta cur={cur?.[col.key] ?? null} prev={prev?.[col.key] ?? null} mode={col.delta} />
          )}
        </div>
      )}
    </td>
  );

  const vergleichLabel = compareName(dateRange?.compareMode);
  const hatGsc = zeilen.some((z) => z.quelle === "gsc");

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        boxShadow: C.cardShadow,
        overflow: "hidden",
      }}
    >
      {/* Werkzeugleiste: Zeitraum-Info links, Suche/Filter/Export rechts */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "14px 18px",
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
            Kunden ({gefiltert.length} von {clients.length})
          </div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>
            {data.range
              ? `${dmy(data.range.from)} – ${dmy(data.range.to)}`
              : `${startDate ? dmy(startDate) : ""} – ${endDate ? dmy(endDate) : ""}`}
            {mitVergleich && data.prevRange && (
              <span style={{ color: C.accentLight }}>
                {" "}
                · verglichen mit {vergleichLabel || "Vergleich"} ({dmy(data.prevRange.from)} –{" "}
                {dmy(data.prevRange.to)})
              </span>
            )}
            {!mitVergleich && onCompareMode && (
              <>
                {" · "}
                <button
                  type="button"
                  onClick={() => onCompareMode("prevPeriod")}
                  style={{
                    border: "none",
                    background: "none",
                    padding: 0,
                    color: C.accent,
                    fontWeight: 600,
                    fontSize: 12,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  Veränderung zur Vorperiode anzeigen
                </button>
              </>
            )}
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <span style={{ position: "relative", display: "block", width: 220, maxWidth: "100%" }}>
            <Search
              size={14}
              color={C.textDim}
              style={{ position: "absolute", left: 10, top: 10, pointerEvents: "none" }}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Kunde suchen …"
              aria-label="Kunde suchen"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "8px 10px 8px 30px",
                border: `1px solid ${C.inputBorder}`,
                borderRadius: 9,
                fontSize: 12.5,
                fontFamily: "inherit",
                background: "#fff",
              }}
            />
          </span>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter"
            style={{
              padding: "8px 10px",
              border: `1px solid ${C.inputBorder}`,
              borderRadius: 9,
              fontSize: 12.5,
              fontFamily: "inherit",
              background: "#fff",
              color: C.text,
            }}
          >
            {FILTER.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={exportCsv}
            disabled={data.loading || !gefiltert.length}
            title="Aktuelle Ansicht als CSV (Excel) herunterladen"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 12px",
              border: `1px solid ${C.inputBorder}`,
              borderRadius: 9,
              background: "#fff",
              color: C.text,
              fontSize: 12.5,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: data.loading ? "default" : "pointer",
              opacity: data.loading ? 0.5 : 1,
            }}
          >
            <Download size={14} /> CSV
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            margin: "12px 18px 0",
            fontSize: 12.5,
            color: C.red,
            background: C.redDim,
            borderRadius: 8,
            padding: "9px 12px",
          }}
        >
          SEO-Daten konnten nicht geladen werden: {error}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            minWidth: 900,
            borderCollapse: "separate",
            borderSpacing: 0,
            fontSize: 13,
          }}
        >
          <thead>
            <tr>
              <th
                rowSpan={2}
                onClick={() =>
                  setSort((s) => ({ key: "name", dir: s.key === "name" ? -s.dir : 1 }))
                }
                style={{
                  ...th,
                  ...stickyName,
                  zIndex: 2,
                  textAlign: "left",
                  verticalAlign: "bottom",
                  color: sort.key === "name" ? C.accent : C.textMuted,
                }}
              >
                Kunde
                {sort.key === "name" &&
                  (sort.dir === 1 ? (
                    <ArrowDown
                      size={11}
                      style={{ display: "inline-block", marginLeft: 3, verticalAlign: -1 }}
                    />
                  ) : (
                    <ArrowUp
                      size={11}
                      style={{ display: "inline-block", marginLeft: 3, verticalAlign: -1 }}
                    />
                  ))}
              </th>
              <th
                colSpan={3}
                style={{
                  ...th,
                  ...gruppe,
                  textAlign: "center",
                  color: C.textMuted,
                  borderBottom: `1px solid ${C.border}`,
                  fontSize: 10.5,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                }}
              >
                Organischer Traffic
              </th>
              <th
                colSpan={3}
                style={{
                  ...th,
                  ...gruppe,
                  textAlign: "center",
                  background: "#f5eef7",
                  color: C.accent,
                  borderBottom: `1px solid ${C.border}`,
                  fontSize: 10.5,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                }}
              >
                Rankings & Sichtbarkeit
              </th>
            </tr>
            <tr>
              {SPALTEN.map((col) => (
                <SortKopf key={col.key} col={col} />
              ))}
            </tr>
          </thead>
          <tbody>
            {data.loading &&
              Array.from({ length: Math.min(6, clients.length || 6) }).map((_, i) => (
                <tr key={`sk${i}`}>
                  <td style={{ ...td, textAlign: "left" }}>
                    <div style={{ height: 14, width: 160, borderRadius: 6, background: C.segBg }} />
                  </td>
                  {SPALTEN.map((col) => (
                    <td key={col.key} style={td}>
                      <div
                        style={{
                          height: 12,
                          width: 60,
                          marginLeft: "auto",
                          borderRadius: 6,
                          background: C.segBg,
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            {!data.loading &&
              sichtbar.map((z) => {
                const warn = [z.error, ...z.hinweise].filter(Boolean).join(" · ");
                return (
                  <tr
                    key={z.client.id}
                    onClick={() => onSelect?.(z.client.id)}
                    title="Dashboard dieses Kunden öffnen"
                    style={{ cursor: "pointer" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = C.cardHover)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                  >
                    <td
                      style={{
                        ...td,
                        ...stickyName,
                        textAlign: "left",
                        background: C.card,
                        verticalAlign: "middle",
                        borderRight: `1px solid ${C.hairline}`,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                        <ClientAvatar
                          name={z.client.name}
                          domain={z.client.domain}
                          size={26}
                          radius={7}
                          bg={C.accentDim}
                          fg={C.accentLight}
                          fontSize={10}
                        />
                        <div style={{ minWidth: 0, maxWidth: 200 }}>
                          <div
                            style={{
                              fontWeight: 650,
                              color: C.text,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {z.client.name}
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: C.textDim,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {z.client.domain || ""}
                          </div>
                        </div>
                        {warn && (
                          <span title={warn} style={{ flexShrink: 0, display: "inline-flex" }}>
                            <AlertTriangle size={14} color={C.orange} aria-label={warn} />
                          </span>
                        )}
                      </div>
                    </td>
                    {SPALTEN.map((col) =>
                      zelle(col, z.cur, z.prev, {
                        quelle: z.quelle,
                        stand: z.stand,
                        rankVergleich: z.rankVergleich,
                        rankVergleichGrund: z.rankVergleichGrund,
                        visibilityLand: z.visibilityLand,
                      }),
                    )}
                  </tr>
                );
              })}
            {!data.loading && !sichtbar.length && (
              <tr>
                <td
                  colSpan={SPALTEN.length + 1}
                  style={{ ...td, textAlign: "center", color: C.textMuted, padding: 28 }}
                >
                  Keine Kunden für diese Suche/diesen Filter.
                </td>
              </tr>
            )}
          </tbody>
          {!data.loading && gefiltert.length > 0 && (
            <tfoot>
              <tr style={{ background: "#fbf5ef" }}>
                <td
                  style={{
                    ...td,
                    ...stickyName,
                    textAlign: "left",
                    fontWeight: 700,
                    background: "#fbf5ef",
                    borderTop: `1px solid ${C.border}`,
                    verticalAlign: "middle",
                  }}
                >
                  Gesamt · {gefiltert.length} Kunden
                </td>
                {SPALTEN.map((col) => zelle(col, gesamt.cur, gesamt.prev, { fett: true }))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
          padding: "12px 18px",
          fontSize: 11.5,
          color: C.textMuted,
        }}
      >
        <span>
          Org. Traffic = GA4-Sitzungen «Organic Search»
          {hatGsc ? " (GSC = Google-Klicks, wo kein GA4 verbunden ist)" : ""} · Top 3/10 =
          Rankings-Crawl zum Zeitraum-Ende · Visibility Index = Sistrix Schweiz (Marke «FR» usw. =
          anderes Sistrix-Land je Kunde), in der Summe nicht addiert
          {mitVergleich && methodenwechsel
            ? " · «Methode geändert» = Vergleichslauf anders gezählt (vor 14.09.2026) oder an anderem Crawl-Standort gemessen, daher kein Top-3/10-Vergleich (Grund im Tooltip)"
            : ""}
        </span>
        {seiten > 1 && (
          <span style={{ display: "inline-flex", gap: 4 }}>
            {Array.from({ length: seiten }).map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setPage(i)}
                style={{
                  minWidth: 28,
                  height: 28,
                  borderRadius: 7,
                  border: `1px solid ${i === page ? C.accent : C.border}`,
                  background: i === page ? C.accentDim : "#fff",
                  color: i === page ? C.accent : C.textMuted,
                  fontWeight: 600,
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                {i + 1}
              </button>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
