// First-Party-Daten (Search Console + GA4), Phase 3 (22.09.2026, Volkan):
// drei Kacheln im SEO-Tab — Chancen-Keywords, Gewinner & Verlierer, organische
// Conversions je Landingpage — aus /api/kpi/first-party (SQL-Auswertungen der
// Phase 2a). Wird NUR fuer Owner/Admin und NUR bei gesetztem Kunden-Flag
// clients.metadata.first_party_kpi gerendert (Gate in SeoDashboard); die Route
// prueft dasselbe serverseitig nochmals. Zeitraum kommt aus dem SEO-Tab.
// GRUNDSATZ: keine erfundenen Werte — Datenstand je Quelle aus kpi_datenstand.
import { useCallback, useEffect, useMemo, useState } from "react";
import DataStatus from "@/ezy/DataStatus";
import { authedFetch } from "@/lib/authed-fetch";
import { C } from "./theme";
import { DTable, LiveEmptyState, Skeleton, fmtCH, fmtPct, liveRangeFor } from "./ui-kit";

const QUELLEN_LABEL = { gsc: "Search Console (GSC)", ga4: "Analytics (GA4)" };
const MIN_IMPRESSIONS_DEFAULT = 100;
const MAX_TAGE = 366;

/** Tag lokal als YYYY-MM-DD (wie tagLokal in ui-kit — Kalendertag, nicht UTC). */
function tagLokal(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  const p = (n) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}

/**
 * Zeitraum-Query aus dem SEO-Tab: liveRangeFor liefert {startDate,endDate}
 * (bis 90 Tage) oder eine Tageszahl; laengere Custom-Zeitraeume (bis 366 Tage)
 * werden hier direkt aus dateRange gebildet, damit die Route sie exakt erhaelt.
 */
export function zeitraumQuery(dateRange) {
  const r = liveRangeFor(dateRange);
  if (r && typeof r === "object") return `startDate=${r.startDate}&endDate=${r.endDate}`;
  if (typeof r === "number") return `days=${Math.min(MAX_TAGE, Math.max(1, Math.round(r)))}`;
  const startDate = dateRange?.start ? tagLokal(dateRange.start) : null;
  const endDate = dateRange?.end ? tagLokal(dateRange.end) : null;
  if (startDate && endDate && startDate <= endDate)
    return `startDate=${startDate}&endDate=${endDate}`;
  return "days=28";
}

/** Pfad statt voller URL in Tabellen (Titel zeigt die volle Adresse). */
function kurzPfad(url) {
  const s = String(url || "");
  try {
    const u = new URL(s);
    return `${u.pathname}${u.search}` || "/";
  } catch {
    return s || "–";
  }
}

function useFirstPartyKpis(query) {
  const [state, setState] = useState({ data: null, loading: !!query, fehler: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!query) {
      setState({ data: null, loading: false, fehler: null });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true, fehler: null }));
    (async () => {
      try {
        const r = await authedFetch(query);
        const j = await r.json().catch(() => null);
        if (!alive) return;
        if (!r.ok || !j?.ok) {
          setState({
            data: null,
            loading: false,
            fehler: j?.error || `Abfrage fehlgeschlagen (HTTP ${r.status})`,
          });
          return;
        }
        setState({ data: j, loading: false, fehler: null });
      } catch (e) {
        if (alive)
          setState({ data: null, loading: false, fehler: String(e?.message || "Netzwerkfehler") });
      }
    })();
    return () => {
      alive = false;
    };
  }, [query, tick]);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, refresh };
}

function Karte({ title, hint, children }) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        boxShadow: C.cardShadow,
        borderRadius: C.rCard,
        padding: "18px 20px",
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 }}>{title}</div>
      {hint ? (
        <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 12 }}>{hint}</div>
      ) : (
        <div style={{ marginBottom: 12 }} />
      )}
      {children}
    </div>
  );
}

function Delta({ wert, stellen = 0 }) {
  const d = Number(wert);
  if (!Number.isFinite(d) || d === 0) return <span style={{ color: C.textDim }}>±0</span>;
  return (
    <span style={{ color: d > 0 ? C.green : C.red, fontWeight: 600, whiteSpace: "nowrap" }}>
      {d > 0 ? "▲ +" : "▼ "}
      {fmtCH(d, stellen)}
    </span>
  );
}

function Leer({ text }) {
  return <div style={{ fontSize: 12.5, color: C.textMuted, padding: "8px 0" }}>{text}</div>;
}

function Fehler({ text }) {
  return <div style={{ fontSize: 12.5, color: C.red, padding: "8px 0" }}>Fehler: {text}</div>;
}

const SPALTEN_CHANCEN = [
  {
    key: "query",
    label: "Query",
    render: (r) => (
      <span title={r.top_page ? `Top-Seite: ${r.top_page}` : undefined}>{r.query}</span>
    ),
  },
  { key: "pos", label: "Position", align: "right", render: (r) => fmtCH(r.pos, 1) },
  {
    key: "impressions",
    label: "Impressionen",
    align: "right",
    render: (r) => fmtCH(r.impressions),
  },
  { key: "ctr", label: "CTR", align: "right", render: (r) => fmtPct(Number(r.ctr) * 100, 1) },
  {
    key: "erwartete_ctr",
    label: "Erwartete CTR",
    align: "right",
    render: (r) => fmtPct(Number(r.erwartete_ctr) * 100, 1),
  },
  {
    key: "potenzial_klicks",
    label: "Potenzial-Klicks",
    align: "right",
    render: (r) => fmtCH(r.potenzial_klicks),
  },
  { key: "score", label: "Score", align: "right", render: (r) => fmtCH(r.score, 1) },
];

const SPALTEN_SEITEN = [
  {
    key: "page",
    label: "Seite",
    render: (r) => (
      <span
        title={r.page}
        style={{
          display: "inline-block",
          maxWidth: 260,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          verticalAlign: "bottom",
        }}
      >
        {kurzPfad(r.page)}
      </span>
    ),
  },
  {
    key: "clicks",
    label: "Klicks",
    align: "right",
    render: (r) => (
      <span style={{ whiteSpace: "nowrap" }}>
        {fmtCH(r.clicks)} <Delta wert={r.delta_clicks} />
      </span>
    ),
  },
  {
    key: "impressions",
    label: "Impressionen",
    align: "right",
    render: (r) => (
      <span style={{ whiteSpace: "nowrap" }}>
        {fmtCH(r.impressions)} <Delta wert={r.delta_impressions} />
      </span>
    ),
  },
  { key: "pos", label: "Pos.", align: "right", render: (r) => fmtCH(r.pos, 1) },
];

const SPALTEN_CONVERSIONS = [
  {
    key: "landing_page",
    label: "Landingpage",
    render: (r) => (
      <span
        title={r.landing_page}
        style={{
          display: "inline-block",
          maxWidth: 320,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          verticalAlign: "bottom",
        }}
      >
        {kurzPfad(r.landing_page)}
      </span>
    ),
  },
  { key: "sessions", label: "Sessions", align: "right", render: (r) => fmtCH(r.sessions) },
  {
    key: "engaged_sessions",
    label: "Engagiert",
    align: "right",
    render: (r) => fmtCH(r.engaged_sessions),
  },
  { key: "key_events", label: "Conversions", align: "right", render: (r) => fmtCH(r.key_events) },
  {
    key: "conversion_rate",
    label: "Rate",
    align: "right",
    render: (r) => fmtPct(Number(r.conversion_rate) * 100, 1),
  },
];

export default function FirstPartyKpis({ client, dateRange }) {
  // Schwelle (Impressionen-Minimum) wird erst beim Verlassen des Felds bzw.
  // mit Enter uebernommen — kein Request je Tastendruck.
  const [minImpressions, setMinImpressions] = useState(MIN_IMPRESSIONS_DEFAULT);
  const [eingabe, setEingabe] = useState(String(MIN_IMPRESSIONS_DEFAULT));
  const uebernehmen = () => {
    const n = Math.round(Number(eingabe));
    const wert = Number.isFinite(n) && n >= 0 ? n : MIN_IMPRESSIONS_DEFAULT;
    setEingabe(String(wert));
    setMinImpressions(wert);
  };

  const zeitraum = useMemo(() => zeitraumQuery(dateRange), [dateRange]);
  const query = client?.id
    ? `/api/kpi/first-party?client=${encodeURIComponent(client.id)}&${zeitraum}&minImpressions=${minImpressions}`
    : null;
  const { data, loading, fehler, refresh } = useFirstPartyKpis(query);

  const statusItems = useMemo(() => {
    const rows = data?.datenstand?.rows || [];
    const items = ["gsc", "ga4"].map((q) => {
      const r = rows.find((x) => String(x.quelle).toLowerCase() === q);
      const source = QUELLEN_LABEL[q];
      if (!r || !(Number(r.zeilen) > 0)) return { source, state: "none" };
      return {
        source,
        lastAt: String(r.bis).slice(0, 10),
        staleDays: 5,
        detail: `${String(r.von).slice(0, 10)} bis ${String(r.bis).slice(0, 10)} · ${fmtCH(r.zeilen)} Zeilen`,
      };
    });
    if (data?.datenstand?.fehler)
      items.push({ source: "Datenstand", state: "error", error: data.datenstand.fehler });
    return items;
  }, [data]);

  const ctrQuelle = useMemo(() => {
    const rows = data?.ctrKurve?.rows || [];
    if (!rows.length) return null;
    return rows.some((r) => r.quelle === "eigene") ? "eigene Daten" : "Referenz";
  }, [data]);

  if (!client?.id) return null;
  if (data && data.aktiv === false) return null;

  const range = data?.range;
  const rangeText = range
    ? `${fmtStandTag(range.from)} bis ${fmtStandTag(range.to)} (${fmtCH(range.days)} Tage)`
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px 16px",
          flexWrap: "wrap",
          marginTop: 6,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
          First-Party-Daten (Search Console + GA4)
        </div>
        {rangeText ? <span style={{ fontSize: 11.5, color: C.textDim }}>{rangeText}</span> : null}
        <span style={{ flex: 1 }} />
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11.5,
            color: C.textMuted,
          }}
        >
          Min. Impressionen
          <input
            type="number"
            min={0}
            step={10}
            value={eingabe}
            onChange={(e) => setEingabe(e.target.value)}
            onBlur={uebernehmen}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            title="Schwelle fuer Chancen-Keywords (Impressionen im Zeitraum)"
            style={{
              width: 76,
              padding: "4px 8px",
              borderRadius: 8,
              border: `1px solid ${C.inputBorder}`,
              background: C.card,
              color: C.text,
              fontSize: 12,
              fontFamily: "inherit",
              outline: "none",
            }}
          />
        </label>
      </div>

      <DataStatus
        items={statusItems}
        actions={[
          {
            label: "Daten neu laden",
            kind: "reload",
            busy: loading,
            title: "Liest nur die gespeicherten First-Party-Daten neu — startet KEINEN Sync",
            onClick: refresh,
          },
        ]}
      />

      {fehler ? (
        <div
          style={{
            background: C.card,
            border: `1px solid ${C.red}`,
            borderRadius: 14,
            padding: "14px 16px",
            fontSize: 12.5,
            color: C.red,
          }}
        >
          First-Party-Daten konnten nicht geladen werden: {fehler}
        </div>
      ) : loading && !data ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
            gap: 14,
          }}
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: C.rCard,
                padding: "18px 20px",
              }}
            >
              <Skeleton w="45%" h={14} />
              <div style={{ height: 12 }} />
              <Skeleton h={12} />
              <div style={{ height: 8 }} />
              <Skeleton h={12} />
              <div style={{ height: 8 }} />
              <Skeleton w="70%" h={12} />
            </div>
          ))}
        </div>
      ) : data?.leer ? (
        <LiveEmptyState
          title="Noch keine Daten verbunden"
          hint="Für diesen Zeitraum liegen keine First-Party-Daten vor. Verbindung und Sync: Admin → Kunde → Google → First-Party-Daten."
        />
      ) : data ? (
        <>
          <Karte
            title="Chancen-Keywords"
            hint={`Position ${fmtCH(data.konfig?.posVon)}–${fmtCH(data.konfig?.posBis)}, mindestens ${fmtCH(data.konfig?.minImpressions)} Impressionen, Ziel Position ${fmtCH(data.konfig?.zielposition)}. CTR-Kurve: ${ctrQuelle || "–"}.`}
          >
            {data.chancen?.fehler ? (
              <Fehler text={data.chancen.fehler} />
            ) : data.chancen?.rows?.length ? (
              <DTable columns={SPALTEN_CHANCEN} data={data.chancen.rows} />
            ) : (
              <Leer text="Keine Chancen-Keywords im Zeitraum — Schwelle senken oder Zeitraum verlängern." />
            )}
          </Karte>

          <Karte
            title="Gewinner & Verlierer"
            hint="Top 10 Seiten nach Klick-Veränderung gegenüber der gleich langen Vorperiode."
          >
            {data.gewinner?.fehler ? (
              <Fehler text={data.gewinner.fehler} />
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))",
                  gap: 16,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.green, marginBottom: 6 }}>
                    Gewinner
                  </div>
                  {data.gewinner?.rows?.length ? (
                    <DTable columns={SPALTEN_SEITEN} data={data.gewinner.rows} />
                  ) : (
                    <Leer text="Keine Gewinner im Zeitraum." />
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.red, marginBottom: 6 }}>
                    Verlierer
                  </div>
                  {data.verlierer?.rows?.length ? (
                    <DTable columns={SPALTEN_SEITEN} data={data.verlierer.rows} />
                  ) : (
                    <Leer text="Keine Verlierer im Zeitraum." />
                  )}
                </div>
              </div>
            )}
          </Karte>

          <Karte
            title="Organische Conversions je Landingpage"
            hint="GA4, Kanal Organic Search: Sessions, engagierte Sessions, Conversions (Key Events) und Rate."
          >
            {data.organicConversions?.fehler ? (
              <Fehler text={data.organicConversions.fehler} />
            ) : data.organicConversions?.rows?.length ? (
              <DTable columns={SPALTEN_CONVERSIONS} data={data.organicConversions.rows} />
            ) : (
              <Leer text="Keine organischen Conversions im Zeitraum." />
            )}
          </Karte>
        </>
      ) : null}
    </div>
  );
}

/** YYYY-MM-DD → DD.MM.YYYY (ohne Zeitzonen-Umrechnung). */
function fmtStandTag(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(ymd || "–");
}
