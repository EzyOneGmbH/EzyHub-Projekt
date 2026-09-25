// EzyPerformance — Agentur-Performance-Tabelle (25.09.2026): alle Ads-Konten
// in einer Tabelle wie im Looker-Studio-Report, mit Zeitraum/Vergleich aus der
// Kopfzeile und Conversions getrennt nach Buchung und Allgemein.
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
const n1 = (v) => (Math.round(v * 10) / 10).toLocaleString("de-CH", { maximumFractionDigits: 1 });
const chf = (v, dec = 0) =>
  `CHF ${Number(v).toLocaleString("de-CH", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  })}`;
const pct = (v) => `${v.toFixed(2).replace(".", ",")} %`;
const roasTxt = (v) => `${v.toFixed(2).replace(".", ",")}×`;

// Abgeleitete Kennzahlen einer Periode (auch fuer die Summenzeile).
function ableiten(k) {
  if (!k) return null;
  return {
    ...k,
    ctr: k.impressions > 0 ? (k.clicks / k.impressions) * 100 : null,
    cpc: k.clicks > 0 ? k.cost / k.clicks : null,
    cpb: k.bookings > 0 ? k.cost / k.bookings : null,
    roas: k.cost > 0 ? k.conversionValue / k.cost : null,
  };
}
function summe(list) {
  const keys = [
    "cost",
    "impressions",
    "clicks",
    "conversions",
    "conversionValue",
    "bookings",
    "bookingValue",
    "general",
  ];
  const out = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const k of list) if (k) for (const key of keys) out[key] += Number(k[key] || 0);
  return ableiten(out);
}

// tone: "up" = steigen ist gut, "down" = sinken ist gut, "neutral" = nur Info.
const SPALTEN = [
  { key: "cost", label: "Kosten", fmt: (v) => chf(v, 2), tone: "neutral" },
  { key: "impressions", label: "Impressionen", fmt: n0, tone: "up" },
  { key: "clicks", label: "Klicks", fmt: n0, tone: "up" },
  { key: "ctr", label: "CTR", fmt: pct, tone: "up" },
  { key: "cpc", label: "Ø CPC", fmt: (v) => chf(v, 2), tone: "down" },
  {
    key: "bookings",
    label: "Buchungen",
    fmt: n1,
    tone: "up",
    group: "conv",
    hint: "Conversion-Aktionen der Kategorie Kauf/Buchung (z. B. Buchungsmaschine)",
  },
  {
    key: "cpb",
    label: "Kosten/Buchung",
    fmt: (v) => chf(v, 2),
    tone: "down",
    group: "conv",
    hint: "Kosten geteilt durch Buchungen",
  },
  {
    key: "general",
    label: "Allgemein",
    fmt: n1,
    tone: "up",
    group: "conv",
    hint: "Alle übrigen Conversions: Anfragen, Anrufe, Kontakt, Newsletter …",
  },
  { key: "conversionValue", label: "Umsatz", fmt: (v) => chf(v, 0), tone: "up" },
  { key: "roas", label: "ROAS", fmt: roasTxt, tone: "up" },
];

const FILTER = [
  { id: "alle", label: "Alle Konten" },
  { id: "buchungen", label: "Mit Buchungen" },
  { id: "ohneBuchungen", label: "Ohne Buchungen" },
  { id: "roasUnter1", label: "ROAS unter 1" },
  { id: "kostenPlus", label: "Kosten gestiegen" },
  { id: "fehler", label: "Datenfehler" },
];

function Delta({ cur, prev, tone }) {
  const d = cur == null || prev == null ? null : pctDelta(cur, prev);
  if (d == null) return <span style={{ fontSize: 10.5, color: C.textFaint }}>—</span>;
  const up = d > 0;
  const gut = tone === "neutral" || d === 0 ? null : tone === "up" ? up : !up;
  const color = gut == null ? C.textMuted : gut ? C.green : C.red;
  const bg = gut == null ? C.segBg : gut ? C.greenDim : C.redDim;
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
      {up ? "↗" : d < 0 ? "↘" : "→"} {d > 0 ? "+" : ""}
      {d.toFixed(1).replace(".", ",")} %
    </span>
  );
}

function RoasPill({ v }) {
  if (v == null) return <span style={{ color: C.textFaint }}>—</span>;
  const color = v < 1 ? C.red : v >= 4 ? C.green : C.text;
  const bg = v < 1 ? C.redDim : v >= 4 ? C.greenDim : "transparent";
  return (
    <span
      style={{
        fontWeight: 700,
        color,
        background: bg,
        borderRadius: 7,
        padding: bg === "transparent" ? 0 : "2px 8px",
      }}
    >
      {roasTxt(v)}
    </span>
  );
}

export function AdsAgencyTable({ clients, dateRange, onSelect, onCompareMode = null }) {
  const [data, setData] = useState({ loading: true, rows: {}, range: null, prevRange: null });
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("alle");
  const [sort, setSort] = useState({ key: "clicks", dir: -1 });
  const [page, setPage] = useState(0);
  const mitVergleich = !!dateRange?.compare;

  const ids = useMemo(() => clients.map((c) => c.id).filter(Boolean), [clients]);
  const startDate = dateRange?.start ? ymd(dateRange.start) : null;
  const endDate = dateRange?.end ? ymd(dateRange.end) : null;
  const compareStart = dateRange?.compare?.start ? ymd(dateRange.compare.start) : null;
  const compareEnd = dateRange?.compare?.end ? ymd(dateRange.compare.end) : null;

  useEffect(() => {
    if (!ids.length || !startDate || !endDate) return;
    let alive = true;
    setData((d) => ({ ...d, loading: true }));
    setError("");
    (async () => {
      try {
        const bloecke = [];
        for (let i = 0; i < ids.length; i += 40) bloecke.push(ids.slice(i, i + 40));
        const antworten = await Promise.all(
          bloecke.map(async (clientIds) => {
            const body = { clientIds, startDate, endDate };
            if (compareStart && compareEnd) Object.assign(body, { compareStart, compareEnd });
            const res = await ezyFetch("/api/google/ads-overview", {
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
        setData({
          loading: false,
          rows,
          range: antworten[0]?.range ?? null,
          prevRange: antworten[0]?.prevRange ?? null,
        });
      } catch (e) {
        if (!alive) return;
        setError(e?.message || String(e));
        setData((d) => ({ ...d, loading: false }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [ids, startDate, endDate, compareStart, compareEnd]);

  useEffect(() => setPage(0), [query, filter, sort, ids]);

  const zeilen = useMemo(
    () =>
      clients.map((c) => {
        const r = data.rows[c.id];
        return {
          client: c,
          cur: ableiten(r?.cur),
          prev: mitVergleich ? ableiten(r?.prev) : null,
          error: r?.error || null,
        };
      }),
    [clients, data.rows, mitVergleich],
  );

  const gefiltert = useMemo(() => {
    const q = query.trim().toLowerCase();
    const passt = (z) => {
      if (
        q &&
        !`${z.client.name || ""} ${z.client.domain || ""} ${z.client.googleAdsCustomer || z.client.google_ads_customer || ""}`
          .toLowerCase()
          .includes(q)
      )
        return false;
      switch (filter) {
        case "buchungen":
          return (z.cur?.bookings || 0) > 0;
        case "ohneBuchungen":
          return !!z.cur && (z.cur.bookings || 0) === 0;
        case "roasUnter1":
          return z.cur?.roas != null && z.cur.roas < 1;
        case "kostenPlus":
          return !!z.cur && !!z.prev && z.cur.cost > z.prev.cost;
        case "fehler":
          return !!z.error;
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

  const gesamt = useMemo(
    () => ({
      cur: summe(gefiltert.map((z) => z.cur)),
      prev: mitVergleich ? summe(gefiltert.map((z) => z.prev)) : null,
    }),
    [gefiltert, mitVergleich],
  );

  const seiten = Math.max(1, Math.ceil(gefiltert.length / PAGE));
  const sichtbar = gefiltert.slice(page * PAGE, page * PAGE + PAGE);

  const exportCsv = () => {
    const kopf = ["Konto", "Domain", ...SPALTEN.map((s) => s.label)];
    if (mitVergleich) kopf.push(...SPALTEN.map((s) => `${s.label} (Vergleich)`));
    const zahl = (v) => (v == null ? "" : String(Math.round(v * 100) / 100).replace(".", ","));
    const zeileCsv = (name, domain, cur, prev) => [
      name,
      domain,
      ...SPALTEN.map((s) => zahl(cur?.[s.key])),
      ...(mitVergleich ? SPALTEN.map((s) => zahl(prev?.[s.key])) : []),
    ];
    const lines = [
      kopf,
      ...gefiltert.map((z) => zeileCsv(z.client.name, z.client.domain || "", z.cur, z.prev)),
      zeileCsv("Gesamt", "", gesamt.cur, gesamt.prev),
    ].map((l) => l.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(";"));
    downloadFile(
      "﻿" + lines.join("\n"),
      "text/csv;charset=utf-8",
      `ads-report-alle-kunden_${startDate}_${endDate}.csv`,
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
  const convBg = "rgba(119,0,140,.035)";
  const gruppe = { cursor: "default", padding: "6px 12px 4px" };
  const stickyName = { position: "sticky", left: 0, zIndex: 1 };

  const SortKopf = ({ col }) => (
    <th
      title={col.hint}
      onClick={() => setSort((s) => ({ key: col.key, dir: s.key === col.key ? -s.dir : -1 }))}
      style={{
        ...th,
        color: sort.key === col.key ? C.accent : C.textMuted,
        background: col.group === "conv" ? "#f5eef7" : th.background,
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

  const zelle = (col, cur, prev, fett = false) => (
    <td
      key={col.key}
      style={{
        ...td,
        background: col.group === "conv" ? convBg : undefined,
        fontWeight: fett ? 700 : 400,
      }}
    >
      <div style={{ color: C.text, fontSize: 13 }}>
        {col.key === "roas" ? (
          <RoasPill v={cur?.roas ?? null} />
        ) : cur?.[col.key] == null ? (
          <span style={{ color: C.textFaint }}>—</span>
        ) : (
          col.fmt(cur[col.key])
        )}
      </div>
      {mitVergleich && (
        <div style={{ marginTop: 3 }}>
          <Delta cur={cur?.[col.key] ?? null} prev={prev?.[col.key] ?? null} tone={col.tone} />
        </div>
      )}
    </td>
  );

  const vergleichLabel = compareName(dateRange?.compareMode);

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
            Konten ({gefiltert.length} von {clients.length})
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
              placeholder="Konto suchen …"
              aria-label="Konto suchen"
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
          Ads-Daten konnten nicht geladen werden: {error}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            minWidth: 1180,
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
                Konto
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
              <th colSpan={5} style={{ ...th, ...gruppe, borderBottom: "none" }} />
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
                Conversions
              </th>
              <th colSpan={2} style={{ ...th, ...gruppe, borderBottom: "none" }} />
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
              sichtbar.map((z) => (
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
                      <div style={{ minWidth: 0, maxWidth: 190 }}>
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
                      {z.error && (
                        <span title={z.error} style={{ flexShrink: 0, display: "inline-flex" }}>
                          <AlertTriangle size={14} color={C.orange} aria-label={z.error} />
                        </span>
                      )}
                    </div>
                  </td>
                  {SPALTEN.map((col) => zelle(col, z.cur, z.prev))}
                </tr>
              ))}
            {!data.loading && !sichtbar.length && (
              <tr>
                <td
                  colSpan={SPALTEN.length + 1}
                  style={{ ...td, textAlign: "center", color: C.textMuted, padding: 28 }}
                >
                  Keine Konten für diese Suche/diesen Filter.
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
                  Gesamt · {gefiltert.length} Konten
                </td>
                {SPALTEN.map((col) => zelle(col, gesamt.cur, gesamt.prev, true))}
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
          Buchungen = Conversion-Aktionen der Kategorie Kauf/Buchung · Allgemein = alle übrigen
          Conversions · ROAS = Umsatz ÷ Kosten
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
