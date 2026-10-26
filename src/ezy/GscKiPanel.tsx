// EzyAI → Insights → «Google KI» (Volkan 26.10.2026): Search-Console-Bericht
// «Generative KI» (KI-Übersichten + KI-Modus) — Impressionen je Seite, Land,
// Gerät und Tag. Quelle: live aus der API, sobald Google sie anbietet, sonst
// der zuletzt hochgeladene CSV-Export (s. /api/admin/gsc-ki).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { authedFetch } from "@/lib/authed-fetch";
import { isoDay, type ResolvedRange } from "@/ezy/data/rangeStore";
import {
  leseUpload,
  reiheFuer,
  summeTage,
  tagesWerte,
  type KiImport,
  type KiTabelle,
  type KiTag,
  type KiZeile,
} from "@/lib/gsc-ki-import";

type Tokens = Record<string, string>;
type Antwort = {
  ok: boolean;
  error?: string;
  quelle: "api" | "import" | null;
  property: string | null;
  tabelleFehlt?: boolean;
  tageTabelleFehlt?: boolean;
  tage?: KiTag[];
  historie?: { von: string; bis: string; anzahl: number } | null;
  import?: (KiImport & { dateiname?: string | null; importiertAm?: string }) | null;
};

const TABS: Array<[KiTabelle, string, string]> = [
  ["page", "Seiten", "Seite"],
  ["country", "Länder", "Land"],
  ["device", "Geräte", "Gerät"],
  ["date", "Datum", "Datum"],
];
const nf = (n: number) => n.toLocaleString("de-CH");
const fmtDatum = (iso?: string | null) =>
  iso && /^\d{4}-\d{2}-\d{2}/.test(iso)
    ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
    : "—";
const delta = (cur: number, prev: number | null) => {
  if (prev === null) return null;
  if (!prev) return cur ? null : 0;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
};

async function token() {
  return (await supabase.auth.getSession()).data.session?.access_token || "";
}

export default function GscKiPanel({
  clientId,
  S,
  range,
  compare = null,
  canUpload,
}: {
  clientId: string;
  S: Tokens;
  range: ResolvedRange;
  /** Vergleichszeitraum aus dem Portal (null = kein Vergleich) */
  compare?: { start: Date; end: Date } | null;
  canUpload: boolean;
}) {
  const [data, setData] = useState<Antwort | null>(null);
  const [reload, setReload] = useState(0);
  const [tab, setTab] = useState<KiTabelle>("page");
  const [suche, setSuche] = useState("");
  const [alle, setAlle] = useState(false);
  const [vorschau, setVorschau] = useState<(KiImport & { dateiname: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const start = isoDay(range.start);
  const end = isoDay(range.end);
  const cmpStart = compare ? isoDay(compare.start) : "";
  const cmpEnd = compare ? isoDay(compare.end) : "";

  useEffect(() => {
    let alive = true;
    setData(null);
    (async () => {
      const r = await authedFetch(
        `/api/admin/gsc-ki?client=${encodeURIComponent(clientId)}&start=${start}&end=${end}` +
          (cmpStart ? `&cmpStart=${cmpStart}&cmpEnd=${cmpEnd}` : ""),
        { headers: { Authorization: `Bearer ${await token()}` } },
      );
      const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
      if (alive) setData(j);
    })();
    return () => {
      alive = false;
    };
  }, [clientId, start, end, cmpStart, cmpEnd, reload]);

  const waehleDateien = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setErr("");
    try {
      const imp = await leseUpload(
        await Promise.all(
          Array.from(files).map(async (f) => ({ name: f.name, buf: await f.arrayBuffer() })),
        ),
      );
      if (!Object.values(imp.tabellen).some((t) => t?.length)) {
        setErr(
          "In der Datei wurde keine Tabelle mit Impressionen erkannt. Bitte den Export «Generative KI» als CSV (ZIP) hochladen.",
        );
        return;
      }
      setVorschau({ ...imp, dateiname: Array.from(files, (f) => f.name).join(", ") });
    } catch (e) {
      setErr(`Datei nicht lesbar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }, []);

  const speichern = async () => {
    if (!vorschau) return;
    setBusy(true);
    setErr("");
    const { dateiname, dateien: _d, ...imp } = vorschau;
    const r = await authedFetch("/api/admin/gsc-ki", {
      method: "POST",
      headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ client: clientId, dateiname, import: imp }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!j.ok) {
      setErr(j.error || `HTTP ${r.status}`);
      return;
    }
    if (j.tageFehler) setErr(`Import gespeichert, Tageswerte aber nicht: ${j.tageFehler}`);
    setVorschau(null);
    setReload((x) => x + 1);
  };

  const imp = vorschau || data?.import || null;
  // Mit Historie (Tageswerte aller Importe bzw. API) folgen Kennzahl, Verlauf
  // und Datumstabelle dem Zeitraum + Vergleich oben im Portal.
  const mitHistorie = !vorschau && !!data?.historie && !!imp;
  const histReihe = useMemo(
    () =>
      mitHistorie
        ? reiheFuer(data?.tage || [], start, end, cmpStart ? { von: cmpStart, bis: cmpEnd } : null)
        : [],
    [mitHistorie, data, start, end, cmpStart, cmpEnd],
  );
  const tabellen = useMemo(
    () => (mitHistorie && imp ? { ...imp.tabellen, date: histReihe } : imp?.tabellen || {}),
    [mitHistorie, imp, histReihe],
  ) as KiImport["tabellen"];
  const zeilen: KiZeile[] = useMemo(() => {
    const t = (tabellen[tab] || []) as KiZeile[];
    const q = suche.trim().toLowerCase();
    return q ? t.filter((z) => z.key.toLowerCase().includes(q)) : t;
  }, [tabellen, tab, suche]);
  const reihe = (tabellen.date || []) as KiZeile[];
  const vorschauTage = useMemo(() => (vorschau ? tagesWerte(vorschau) : []), [vorschau]);
  const mitPrev = zeilen.some((z) => z.impPrev !== null);

  const karte: React.CSSProperties = {
    background: S.panel,
    border: `1px solid ${S.line}`,
    borderRadius: 14,
    padding: 18,
  };
  const knopf = (primaer = false): React.CSSProperties => ({
    fontSize: 12.5,
    fontWeight: 600,
    padding: "7px 14px",
    borderRadius: 999,
    border: primaer ? "none" : `1px solid ${S.line}`,
    background: primaer ? S.app : "transparent",
    color: primaer ? "#fff" : S.txt,
    cursor: "pointer",
    fontFamily: "inherit",
  });
  const gscLink = data?.property
    ? `https://search.google.com/search-console/performance/search-analytics/ai?resource_id=${encodeURIComponent(data.property)}&breakdown=page`
    : "https://search.google.com/search-console";

  const kopf = (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 280px" }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: S.txt }}>
          Google KI-Übersichten &amp; KI-Modus
        </div>
        <div style={{ fontSize: 12, color: S.mut, marginTop: 3 }}>
          Search Console · Bericht «Generative KI» — wie oft Seiten in Googles KI-Antworten
          erschienen (nur Impressionen, Google liefert hierfür keine Klicks).
        </div>
      </div>
      {data?.quelle === "api" && !vorschau && (
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "#0f9d6c" }}>
          ● Live aus der Search-Console-API
        </span>
      )}
      {data?.quelle === "import" && !vorschau && data.import?.importiertAm && (
        <span style={{ fontSize: 11.5, color: S.mut }}>
          CSV-Import vom {fmtDatum(data.import.importiertAm.slice(0, 10))}
        </span>
      )}
      {canUpload && data?.quelle !== "api" && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,.csv,text/csv,application/zip"
            multiple
            style={{ display: "none" }}
            onChange={(e) => void waehleDateien(e.target.files)}
            data-testid="gsc-ki-datei"
          />
          <button style={knopf(!data?.import)} onClick={() => fileRef.current?.click()}>
            {data?.import ? "Neuen Export importieren" : "CSV importieren"}
          </button>
        </>
      )}
    </div>
  );

  if (data === null)
    return (
      <div style={karte}>
        {kopf}
        <div style={{ fontSize: 12.5, color: S.mut, padding: "30px 0", textAlign: "center" }}>
          Lade Search-Console-Daten…
        </div>
      </div>
    );

  const anleitung = (
    <div style={{ fontSize: 12.5, color: S.mut, lineHeight: 1.6, marginTop: 14 }}>
      {data.tabelleFehlt ? (
        <div style={{ color: "#b45309", marginBottom: 8 }}>
          Speicher für Importe ist noch nicht eingerichtet (Migration 20261026120000).
        </div>
      ) : null}
      Google stellt den Bericht «Generative KI» (noch) nicht über die API bereit. So kommen die
      Zahlen hierher:
      <ol style={{ margin: "6px 0 0 18px" }}>
        <li>
          In der{" "}
          <a href={gscLink} target="_blank" rel="noreferrer" style={{ color: S.app }}>
            Search Console → Leistung → Generative KI
          </a>{" "}
          den Zeitraum «16 Monate» wählen — die ganze Historie; Zeitraum und Vergleich wählst du
          danach frei hier im Portal.
        </li>
        <li>Oben rechts «Exportieren» → «CSV herunterladen».</li>
        <li>Die heruntergeladene ZIP-Datei hier mit «CSV importieren» hochladen.</li>
      </ol>
      Sobald Google die Daten in der API anbietet, erscheinen sie hier automatisch.
    </div>
  );

  if (!data.ok)
    return (
      <div style={karte}>
        {kopf}
        <div style={{ fontSize: 12.5, color: "#b91c1c", marginTop: 12 }}>{data.error}</div>
      </div>
    );

  const vergleich = cmpStart ? { von: cmpStart, bis: cmpEnd } : null;
  const total = mitHistorie ? summeTage(data?.tage || [], start, end) : imp?.totalImp || 0;
  const totalPrev = mitHistorie
    ? vergleich
      ? summeTage(data?.tage || [], vergleich.von, vergleich.bis)
      : null
    : (imp?.totalImpPrev ?? null);
  const d = imp ? delta(total, totalPrev) : null;
  const hist = data?.historie || null;
  const luecke = !!(mitHistorie && hist && (start < hist.von || end > hist.bis));
  const exportAbweichend = !!(
    mitHistorie &&
    imp &&
    (imp.startDate !== start || imp.endDate !== end)
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={karte}>
        {kopf}
        {err && <div style={{ fontSize: 12.5, color: "#b91c1c", marginTop: 10 }}>{err}</div>}

        {vorschau && (
          <div
            style={{
              marginTop: 14,
              border: `1px dashed ${S.app}`,
              borderRadius: 12,
              padding: 14,
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              alignItems: "center",
              fontSize: 12.5,
            }}
          >
            <b style={{ color: S.txt }}>Vorschau: {vorschau.dateiname}</b>
            <span style={{ color: S.mut }}>
              {vorschauTage.length > 0 &&
                `${nf(vorschauTage.length)} Tageswerte für die Historie (${fmtDatum(vorschauTage[0].datum)} – ${fmtDatum(vorschauTage[vorschauTage.length - 1].datum)}) · `}
              {(Object.keys(vorschau.tabellen) as KiTabelle[])
                .map(
                  (k) => `${TABS.find((t) => t[0] === k)?.[1]} (${vorschau.tabellen[k]?.length})`,
                )
                .join(" · ")}
            </span>
            <label style={{ color: S.mut }}>
              Zeitraum{" "}
              <input
                type="date"
                value={vorschau.startDate || ""}
                onChange={(e) => setVorschau({ ...vorschau, startDate: e.target.value || null })}
              />{" "}
              –{" "}
              <input
                type="date"
                value={vorschau.endDate || ""}
                onChange={(e) => setVorschau({ ...vorschau, endDate: e.target.value || null })}
              />
            </label>
            <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button style={knopf()} onClick={() => setVorschau(null)} disabled={busy}>
                Verwerfen
              </button>
              <button style={knopf(true)} onClick={speichern} disabled={busy}>
                {busy ? "Speichere…" : "Import speichern"}
              </button>
            </span>
          </div>
        )}

        {!imp ? (
          anleitung
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 28, marginTop: 16 }}>
              <div>
                <div style={{ fontSize: 12, color: S.mut }}>Impressionen in KI-Antworten</div>
                <div style={{ fontSize: 26, fontWeight: 700, color: S.txt }}>{nf(total)}</div>
                {d !== null && (
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: d >= 0 ? "#0f9d6c" : "#b91c1c",
                    }}
                  >
                    {d >= 0 ? "▲" : "▼"} {Math.abs(d).toLocaleString("de-CH")} % ggü. Vorperiode (
                    {nf(totalPrev || 0)})
                  </div>
                )}
              </div>
              <div>
                <div style={{ fontSize: 12, color: S.mut }}>Seiten mit KI-Impressionen</div>
                <div style={{ fontSize: 26, fontWeight: 700, color: S.txt }}>
                  {nf((tabellen.page || []).filter((z) => z.imp > 0).length)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: S.mut }}>Zeitraum</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: S.txt, marginTop: 6 }}>
                  {mitHistorie
                    ? `${fmtDatum(start)} – ${fmtDatum(end)}`
                    : `${fmtDatum(imp.startDate)} – ${fmtDatum(imp.endDate)}`}
                </div>
                {mitHistorie && vergleich && (
                  <div style={{ fontSize: 11.5, color: S.mut }}>
                    Vergleich: {fmtDatum(vergleich.von)} – {fmtDatum(vergleich.bis)}
                  </div>
                )}
                {data.quelle === "import" && !vorschau && !mitHistorie && (
                  <div style={{ fontSize: 11.5, color: S.mut }}>
                    Zeitraum des Exports — die Datumsauswahl oben gilt hier nicht
                  </div>
                )}
              </div>
              {hist && data.quelle === "import" && !vorschau && (
                <div>
                  <div style={{ fontSize: 12, color: S.mut }}>Hochgeladene Historie</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: S.txt, marginTop: 6 }}>
                    {fmtDatum(hist.von)} – {fmtDatum(hist.bis)}
                  </div>
                  <div style={{ fontSize: 11.5, color: luecke ? "#b45309" : S.mut }}>
                    {luecke
                      ? "Zeitraum/Vergleich reicht über die Historie hinaus — fehlende Tage zählen als 0"
                      : `${nf(hist.anzahl)} Tage`}
                  </div>
                </div>
              )}
            </div>
            {reihe.length > 1 && <Verlauf reihe={reihe} S={S} />}
          </>
        )}
      </div>

      {imp && (
        <div style={{ ...karte, padding: 0, overflow: "hidden" }}>
          <div
            style={{
              display: "flex",
              gap: 20,
              padding: "0 18px",
              borderBottom: `1px solid ${S.line}`,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            {TABS.map(([id, label]) => (
              <button
                key={id}
                onClick={() => {
                  setTab(id);
                  setAlle(false);
                  setSuche("");
                }}
                disabled={!tabellen[id]?.length}
                style={{
                  background: "none",
                  border: "none",
                  borderBottom: `2px solid ${tab === id ? S.app : "transparent"}`,
                  color: !tabellen[id]?.length ? S.line : tab === id ? S.txt : S.mut,
                  fontWeight: tab === id ? 700 : 500,
                  fontSize: 13,
                  padding: "12px 0 10px",
                  cursor: tabellen[id]?.length ? "pointer" : "default",
                  fontFamily: "inherit",
                }}
              >
                {label}
              </button>
            ))}
            {exportAbweichend && tab !== "date" && (
              <span style={{ fontSize: 11.5, color: S.mut }}>
                {TABS.find((t) => t[0] === tab)?.[1]} aus dem Export {fmtDatum(imp.startDate)} –{" "}
                {fmtDatum(imp.endDate)}
              </span>
            )}
            {tab === "page" && (
              <input
                value={suche}
                onChange={(e) => setSuche(e.target.value)}
                placeholder="Seite suchen…"
                style={{
                  marginLeft: "auto",
                  fontSize: 12.5,
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: `1px solid ${S.line}`,
                  background: "transparent",
                  color: S.txt,
                  fontFamily: "inherit",
                }}
              />
            )}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
              <thead>
                <tr>
                  {[TABS.find((t) => t[0] === tab)?.[2] || "", "Impressionen"]
                    .concat(mitPrev ? ["Vorperiode", "Veränderung"] : [])
                    .map((h, i) => (
                      <th
                        key={h}
                        style={{
                          textAlign: i === 0 ? "left" : "right",
                          fontSize: 11.5,
                          fontWeight: 600,
                          color: S.mut,
                          padding: "10px 18px",
                          borderBottom: `1px solid ${S.line}`,
                        }}
                      >
                        {h}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {(alle ? zeilen : zeilen.slice(0, 50)).map((z) => {
                  const dz = delta(z.imp, z.impPrev);
                  const td: React.CSSProperties = {
                    fontSize: 12.5,
                    color: S.txt,
                    padding: "9px 18px",
                    borderBottom: `1px solid ${S.line}`,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                    whiteSpace: "nowrap",
                  };
                  return (
                    <tr key={z.key}>
                      <td
                        style={{
                          ...td,
                          textAlign: "left",
                          whiteSpace: "normal",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {tab === "page" && /^https?:\/\//.test(z.key) ? (
                          <a
                            href={z.key}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: S.txt, textDecoration: "none" }}
                          >
                            {z.key.replace(/^https?:\/\/(www\.)?/, "")}
                          </a>
                        ) : tab === "date" ? (
                          fmtDatum(z.key)
                        ) : (
                          z.key
                        )}
                      </td>
                      <td style={td}>{nf(z.imp)}</td>
                      {mitPrev && <td style={{ ...td, color: S.mut }}>{nf(z.impPrev || 0)}</td>}
                      {mitPrev && (
                        <td
                          style={{
                            ...td,
                            color: dz === null ? S.mut : dz >= 0 ? "#0f9d6c" : "#b91c1c",
                          }}
                        >
                          {dz === null
                            ? "neu"
                            : `${dz >= 0 ? "+" : ""}${dz.toLocaleString("de-CH")} %`}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "10px 18px",
              fontSize: 12,
              color: S.mut,
            }}
          >
            <span>{nf(zeilen.length)} Einträge</span>
            {zeilen.length > 50 && (
              <button style={knopf()} onClick={() => setAlle((x) => !x)}>
                {alle ? "Weniger anzeigen" : `Alle ${nf(zeilen.length)} anzeigen`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Kleiner Tagesverlauf (aktuell durchgezogen, Vorperiode gestrichelt).
function Verlauf({ reihe, S }: { reihe: KiZeile[]; S: Tokens }) {
  const W = 760;
  const H = 120;
  const max = Math.max(1, ...reihe.map((z) => Math.max(z.imp, z.impPrev || 0)));
  const x = (i: number) => (i / Math.max(1, reihe.length - 1)) * (W - 8) + 4;
  const y = (v: number) => H - 6 - (v / max) * (H - 18);
  const pfad = (f: (z: KiZeile) => number) =>
    reihe.map((z, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(f(z)).toFixed(1)}`).join(" ");
  const mitPrev = reihe.some((z) => z.impPrev !== null);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: 120, marginTop: 14, display: "block" }}
      role="img"
      aria-label="Impressionen in KI-Antworten je Tag"
    >
      {mitPrev && (
        <path
          d={pfad((z) => z.impPrev || 0)}
          fill="none"
          stroke={S.mut}
          strokeWidth={1.5}
          strokeDasharray="4 4"
        />
      )}
      <path d={pfad((z) => z.imp)} fill="none" stroke={S.app} strokeWidth={2} />
      <text x={4} y={11} fontSize={10} fill={S.mut}>
        max. {max.toLocaleString("de-CH")}
      </text>
    </svg>
  );
}
