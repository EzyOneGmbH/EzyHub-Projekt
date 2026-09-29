// EzyAI — Agentur-Performance-Tabelle (29.09.2026, analog EzyRank
// SeoAgencyTable / EzyPerformance AdsAgencyTable): alle Kunden in einer
// Tabelle mit Zeitraum/Vergleich aus der Kopfzeile — je eine Konfiguration
// fuer Organic (KI-Besucher, KI-Conversions, KI-Sichtbarkeit) und Ads
// (ChatGPT Ads + GA4 chatgpt / cpc). Daten: /api/admin/aivis-overview.
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
const n2 = (v) => v.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v) => `${v.toFixed(2).replace(".", ",")} %`;

// ── Konfiguration je Modus ────────────────────────────────────────────────
// delta: "pct" = prozentual, "abs" = absolute Differenz. tone: "down" = kleiner
// ist besser (Kosten je Klick/Conversion). group: Spaltengruppe (Kopfzeile).
const MODI = {
  organic: {
    titel: "KI-Sichtbarkeit (Organic)",
    gruppen: [
      { id: "traffic", label: "KI-Traffic (GA4)" },
      { id: "vis", label: "KI-Sichtbarkeit (Messlauf)", akzent: true },
    ],
    ableiten: (k) =>
      k && {
        ...k,
        convRate:
          k.kiBesucher != null && k.kiBesucher > 0 && k.kiConversions != null
            ? (k.kiConversions / k.kiBesucher) * 100
            : null,
      },
    summenKeys: ["kiBesucher", "kiConversions", "mentions", "citations"],
    spalten: [
      {
        key: "kiBesucher",
        label: "KI-Besucher",
        fmt: n0,
        delta: "pct",
        group: "traffic",
        hint: "Sitzungen aus KI-Assistenten (ChatGPT, Perplexity, Gemini, Claude, Copilot …) laut GA4 im Zeitraum",
      },
      {
        key: "kiConversions",
        label: "KI-Conversions",
        fmt: n0,
        delta: "abs",
        group: "traffic",
        hint: "Conversions dieser KI-Sitzungen (GA4 Key Events bzw. «Zählt als Conversion»)",
      },
      {
        key: "convRate",
        label: "Conv.-Rate",
        fmt: pct,
        delta: null,
        group: "traffic",
        hint: "KI-Conversions je KI-Besucher",
      },
      {
        key: "score",
        label: "Score",
        fmt: n0,
        delta: "abs",
        group: "vis",
        hint: "KI-Sichtbarkeits-Score des jüngsten Messlaufs bis Zeitraum-Ende (in der Summe nicht addiert)",
      },
      {
        key: "mentions",
        label: "Erwähnungen",
        fmt: n0,
        delta: "abs",
        group: "vis",
        hint: "Markennennungen in den KI-Antworten des Messlaufs",
      },
      {
        key: "citations",
        label: "Zitate",
        fmt: n0,
        delta: "abs",
        group: "vis",
        hint: "Zitierte Quellen der eigenen Domain im Messlauf",
      },
    ],
    filter: [
      { id: "alle", label: "Alle Kunden" },
      { id: "besucherPlus", label: "KI-Besucher gestiegen" },
      { id: "besucherMinus", label: "KI-Besucher gesunken" },
      { id: "mitConv", label: "Mit KI-Conversions" },
      { id: "ohneDaten", label: "Ohne KI-Besucher" },
      { id: "hinweise", label: "Mit Datenhinweisen" },
    ],
    filtern: (z, f) =>
      f === "besucherPlus"
        ? z.cur?.kiBesucher != null &&
          z.prev?.kiBesucher != null &&
          z.cur.kiBesucher > z.prev.kiBesucher
        : f === "besucherMinus"
          ? z.cur?.kiBesucher != null &&
            z.prev?.kiBesucher != null &&
            z.cur.kiBesucher < z.prev.kiBesucher
          : f === "mitConv"
            ? (z.cur?.kiConversions ?? 0) > 0
            : f === "ohneDaten"
              ? !z.cur?.kiBesucher
              : true,
    defaultSort: "kiBesucher",
    fuss: "KI-Besucher/-Conversions = GA4-Sitzungen aus KI-Assistenten im Zeitraum · Score/Erwähnungen/Zitate = jüngster KI-Messlauf bis Zeitraum-Ende (Stand im Tooltip); Score in der Summe nicht addiert",
    datei: "ezyai-organic-alle-kunden",
  },
  ads: {
    titel: "ChatGPT Ads",
    gruppen: [
      { id: "ads", label: "ChatGPT Ads" },
      { id: "ga4", label: "GA4 (ChatGPT / CPC)", akzent: true },
    ],
    ableiten: (k) =>
      k && {
        ...k,
        ctr: k.impressions > 0 && k.clicks != null ? (k.clicks / k.impressions) * 100 : null,
        cpc: k.clicks > 0 && k.spend != null ? k.spend / k.clicks : null,
        cpm: k.impressions > 0 && k.spend != null ? (k.spend / k.impressions) * 1000 : null,
        cpa: k.conversions > 0 && k.spend != null ? k.spend / k.conversions : null,
      },
    summenKeys: ["spend", "impressions", "clicks", "conversions", "ga4Sessions", "ga4Conversions"],
    spalten: [
      {
        key: "spend",
        label: "Kosten",
        fmt: n2,
        delta: "pct",
        tone: "neutral",
        group: "ads",
        hint: "Ausgaben im Zeitraum (Kontowährung)",
      },
      { key: "impressions", label: "Impressionen", fmt: n0, delta: "pct", group: "ads" },
      { key: "clicks", label: "Klicks", fmt: n0, delta: "pct", group: "ads" },
      {
        key: "ctr",
        label: "CTR",
        fmt: pct,
        delta: "pct",
        group: "ads",
        hint: "Klicks je Impression",
      },
      {
        key: "cpc",
        label: "Ø CPC",
        fmt: n2,
        delta: "pct",
        tone: "down",
        group: "ads",
        hint: "Kosten je Klick",
      },
      {
        key: "cpm",
        label: "Ø CPM",
        fmt: n2,
        delta: "pct",
        tone: "down",
        group: "ads",
        hint: "Kosten je 1'000 Impressionen",
      },
      {
        key: "conversions",
        label: "Conversions",
        fmt: n0,
        delta: "abs",
        group: "ads",
        hint: "Conversions laut ChatGPT Ads (OpenAI-Pixel/CAPI)",
      },
      {
        key: "cpa",
        label: "Kosten/Conv.",
        fmt: n2,
        delta: "pct",
        tone: "down",
        group: "ads",
        hint: "Kosten je Ads-Conversion (berechnet)",
      },
      {
        key: "ga4Sessions",
        label: "Sessions",
        fmt: n0,
        delta: "pct",
        group: "ga4",
        hint: "GA4-Sitzungen aus Quelle ChatGPT / Medium CPC",
      },
      {
        key: "ga4Conversions",
        label: "Conversions",
        fmt: n0,
        delta: "abs",
        group: "ga4",
        hint: "GA4 Key Events dieser Sitzungen",
      },
    ],
    filter: [
      { id: "alle", label: "Alle Konten" },
      { id: "mitKosten", label: "Mit Ausgaben" },
      { id: "ohneKosten", label: "Ohne Ausgaben" },
      { id: "mitConv", label: "Mit Conversions" },
      { id: "kostenPlus", label: "Kosten gestiegen" },
      { id: "hinweise", label: "Mit Datenhinweisen" },
    ],
    filtern: (z, f) =>
      f === "mitKosten"
        ? (z.cur?.spend ?? 0) > 0
        : f === "ohneKosten"
          ? !(z.cur?.spend > 0)
          : f === "mitConv"
            ? (z.cur?.conversions ?? 0) > 0 || (z.cur?.ga4Conversions ?? 0) > 0
            : f === "kostenPlus"
              ? z.cur?.spend != null && z.prev?.spend != null && z.cur.spend > z.prev.spend
              : true,
    defaultSort: "spend",
    fuss: "Kosten/Impressionen/Klicks/Conversions = ChatGPT Ads (täglicher Sync) · Sessions/Conversions (GA4) = Quelle ChatGPT / Medium CPC · Beträge in Kontowährung",
    datei: "ezyai-chatgpt-ads-alle-konten",
  },
};

function Delta({ cur, prev, mode, tone }) {
  if (cur == null || prev == null)
    return <span style={{ fontSize: 10.5, color: C.textFaint }}>—</span>;
  const d = mode === "abs" ? cur - prev : pctDelta(cur, prev);
  if (d == null) return <span style={{ fontSize: 10.5, color: C.textFaint }}>—</span>;
  const up = d > 0;
  const gut = d === 0 || tone === "neutral" ? null : tone === "down" ? !up : up;
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

export function EzyAiAgencyTable({
  mode = "organic",
  clients,
  dateRange,
  onSelect,
  onCompareMode = null,
}) {
  const M = MODI[mode];
  const [data, setData] = useState({ loading: true, rows: {}, range: null, prevRange: null });
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("alle");
  const [sort, setSort] = useState({ key: M.defaultSort, dir: -1 });
  const [page, setPage] = useState(0);
  const mitVergleich = !!dateRange?.compare;

  const ids = useMemo(() => clients.map((c) => c.id).filter(Boolean), [clients]);
  const startDate = dateRange?.start ? ymd(dateRange.start) : null;
  const endDate = dateRange?.end ? ymd(dateRange.end) : null;
  const compareStart = dateRange?.compare?.start ? ymd(dateRange.compare.start) : null;
  const compareEnd = dateRange?.compare?.end ? ymd(dateRange.compare.end) : null;

  useEffect(() => {
    setSort({ key: MODI[mode].defaultSort, dir: -1 });
    setFilter("alle");
  }, [mode]);

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
            const body = { mode, clientIds, startDate, endDate };
            if (compareStart && compareEnd) Object.assign(body, { compareStart, compareEnd });
            const res = await ezyFetch("/api/admin/aivis-overview", {
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
  }, [ids, mode, startDate, endDate, compareStart, compareEnd]);

  useEffect(() => setPage(0), [query, filter, sort, ids, mode]);

  const zeilen = useMemo(
    () =>
      clients
        .map((c) => {
          const r = data.rows[c.id];
          return {
            client: c,
            cur: M.ableiten(r?.cur),
            prev: mitVergleich ? M.ableiten(r?.prev) : null,
            currency: r?.currency || null,
            stand: r?.stand || null,
            keinKonto: !!r?.keinKonto,
            demo: !!r?.demo,
            hinweise: r?.hinweise || [],
            error: r?.error || null,
          };
        })
        // Ads: nur Kunden mit ChatGPT-Ads-Konto
        .filter((z) => !(mode === "ads" && !data.loading && z.keinKonto)),
    [clients, data.rows, data.loading, mitVergleich, mode, M],
  );

  const summe = (list) => {
    const out = {};
    for (const key of M.summenKeys) out[key] = null;
    for (const k of list) {
      if (!k) continue;
      for (const key of M.summenKeys) {
        if (k[key] == null) continue;
        out[key] = (out[key] ?? 0) + Number(k[key]);
      }
    }
    return M.ableiten(out);
  };

  const gefiltert = useMemo(() => {
    const q = query.trim().toLowerCase();
    const passt = (z) => {
      if (q && !`${z.client.name || ""} ${z.client.domain || ""}`.toLowerCase().includes(q))
        return false;
      if (filter === "hinweise") return !!z.error || z.hinweise.length > 0;
      return M.filtern(z, filter);
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
  }, [zeilen, query, filter, sort, M]);

  const gesamt = useMemo(
    () => ({
      // Demo-Konten (Testdaten) zaehlen nicht in die Summe.
      cur: summe(gefiltert.filter((z) => !z.demo).map((z) => z.cur)),
      prev: mitVergleich ? summe(gefiltert.filter((z) => !z.demo).map((z) => z.prev)) : null,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gefiltert, mitVergleich, mode],
  );
  const waehrungen = [
    ...new Set(
      gefiltert
        .filter((z) => !z.demo)
        .map((z) => z.currency)
        .filter(Boolean),
    ),
  ];
  const anzahlDemo = gefiltert.filter((z) => z.demo).length;

  const seiten = Math.max(1, Math.ceil(gefiltert.length / PAGE));
  const sichtbar = gefiltert.slice(page * PAGE, page * PAGE + PAGE);

  const exportCsv = () => {
    const kopf = [
      "Kunde",
      "Domain",
      ...(mode === "ads" ? ["Währung"] : []),
      ...M.spalten.map((s) => s.label),
    ];
    if (mitVergleich) kopf.push(...M.spalten.map((s) => `${s.label} (Vergleich)`));
    if (mode === "organic") kopf.push("Stand Messlauf");
    kopf.push("Hinweise");
    const zahl = (v) => (v == null ? "" : String(Math.round(v * 10000) / 10000).replace(".", ","));
    const zeileCsv = (name, domain, cur, prev, extra, stand, hinweise) => [
      name,
      domain,
      ...(mode === "ads" ? [extra || ""] : []),
      ...M.spalten.map((s) => zahl(cur?.[s.key])),
      ...(mitVergleich ? M.spalten.map((s) => zahl(prev?.[s.key])) : []),
      ...(mode === "organic" ? [stand?.cur ? dmy(stand.cur) : ""] : []),
      hinweise,
    ];
    const lines = [
      kopf,
      ...gefiltert.map((z) =>
        zeileCsv(
          z.client.name,
          z.client.domain || "",
          z.cur,
          z.prev,
          z.currency,
          z.stand,
          [z.error, ...z.hinweise].filter(Boolean).join(" · "),
        ),
      ),
      zeileCsv("Gesamt", "", gesamt.cur, gesamt.prev, waehrungen.join("/"), null, ""),
    ].map((l) => l.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(";"));
    downloadFile(
      "﻿" + lines.join("\n"),
      "text/csv;charset=utf-8",
      `${M.datei}_${startDate}_${endDate}.csv`,
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
  const akzentGruppe = new Set(M.gruppen.filter((g) => g.akzent).map((g) => g.id));
  const akzentBg = "rgba(119,0,140,.035)";
  const stickyName = { position: "sticky", left: 0, zIndex: 1 };

  const SortKopf = ({ col }) => (
    <th
      title={col.hint}
      onClick={() => setSort((s) => ({ key: col.key, dir: s.key === col.key ? -s.dir : -1 }))}
      style={{
        ...th,
        color: sort.key === col.key ? C.accent : C.textMuted,
        background: akzentGruppe.has(col.group) ? "#f5eef7" : th.background,
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

  const zelle = (col, cur, prev, { fett = false, stand = null } = {}) => (
    <td
      key={col.key}
      title={
        mode === "organic" && col.group === "vis" && stand?.cur
          ? `Messlauf ${dmy(stand.cur)}${stand.prev && stand.prev !== stand.cur ? ` · Vergleich ${dmy(stand.prev)}` : ""}`
          : undefined
      }
      style={{
        ...td,
        background: akzentGruppe.has(col.group) ? akzentBg : undefined,
        fontWeight: fett ? 700 : 400,
      }}
    >
      <div style={{ color: C.text, fontSize: 13 }}>
        {cur?.[col.key] == null ? (
          <span style={{ color: C.textFaint }}>—</span>
        ) : (
          col.fmt(cur[col.key])
        )}
      </div>
      {mitVergleich && col.delta && (
        <div style={{ marginTop: 3 }}>
          <Delta
            cur={cur?.[col.key] ?? null}
            prev={prev?.[col.key] ?? null}
            mode={col.delta}
            tone={col.tone}
          />
        </div>
      )}
    </td>
  );

  const vergleichLabel = compareName(dateRange?.compareMode);
  const anzahlGesamt = mode === "ads" ? zeilen.length : clients.length;

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
            {mode === "ads" ? "Konten" : "Kunden"} ({gefiltert.length} von {anzahlGesamt})
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
            {M.filter.map((f) => (
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
          Daten konnten nicht geladen werden: {error}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            minWidth: mode === "ads" ? 1180 : 900,
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
              {M.gruppen.map((g) => (
                <th
                  key={g.id}
                  colSpan={M.spalten.filter((s) => s.group === g.id).length}
                  style={{
                    ...th,
                    cursor: "default",
                    padding: "6px 12px 4px",
                    textAlign: "center",
                    background: g.akzent ? "#f5eef7" : th.background,
                    color: g.akzent ? C.accent : C.textMuted,
                    fontSize: 10.5,
                    letterSpacing: ".06em",
                    textTransform: "uppercase",
                  }}
                >
                  {g.label}
                </th>
              ))}
            </tr>
            <tr>
              {M.spalten.map((col) => (
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
                  {M.spalten.map((col) => (
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
                            {mode === "ads" && z.currency ? ` · ${z.currency}` : ""}
                          </div>
                        </div>
                        {warn && (
                          <span title={warn} style={{ flexShrink: 0, display: "inline-flex" }}>
                            <AlertTriangle size={14} color={C.orange} aria-label={warn} />
                          </span>
                        )}
                      </div>
                    </td>
                    {M.spalten.map((col) => zelle(col, z.cur, z.prev, { stand: z.stand }))}
                  </tr>
                );
              })}
            {!data.loading && !sichtbar.length && (
              <tr>
                <td
                  colSpan={M.spalten.length + 1}
                  style={{ ...td, textAlign: "center", color: C.textMuted, padding: 28 }}
                >
                  {mode === "ads" && !zeilen.length
                    ? "Kein Kunde mit verbundenem ChatGPT-Ads-Konto."
                    : "Keine Kunden für diese Suche/diesen Filter."}
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
                  Gesamt · {gefiltert.length - anzahlDemo} {mode === "ads" ? "Konten" : "Kunden"}
                  {anzahlDemo > 0 && (
                    <div style={{ fontSize: 10.5, fontWeight: 400, color: C.textMuted }}>
                      ohne {anzahlDemo} Demo-Konto{anzahlDemo > 1 ? "en" : ""}
                    </div>
                  )}
                  {mode === "ads" && waehrungen.length > 1 && (
                    <div style={{ fontSize: 10.5, fontWeight: 400, color: C.orange }}>
                      gemischte Währungen ({waehrungen.join("/")})
                    </div>
                  )}
                </td>
                {M.spalten.map((col) => zelle(col, gesamt.cur, gesamt.prev, { fett: true }))}
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
        <span>{M.fuss}</span>
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
