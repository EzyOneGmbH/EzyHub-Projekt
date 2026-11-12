import { useEffect, useMemo, useState } from "react";
import {
  ARTIKELTYP_TEXT,
  Block,
  FilterChip,
  HAARLINIE,
  Hinweis,
  MODUS_TEXT,
  P,
  Schwierigkeit,
  Segmente,
  StatusMarke,
  api,
  artikelStatus,
  datumText,
  eingabe,
  eintragVerweis,
  montag,
  plusTage,
  zahl,
  type Eintrag,
} from "@/ezy/BlogUi";

// Blog-Tab «Kalender»: vier Wochen als Tabelle oder Raster, mit Suche und
// Statusfilter. Artikel und freigegebene Themen ohne Artikel.

type Ansicht = "tabelle" | "raster";
const MERKER = "ezyBlogKalender.v1";
const WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const wochentag = (d: Date) => new Intl.DateTimeFormat("de-CH", { weekday: "short" }).format(d);
const kurzMonat = (d: Date) =>
  new Intl.DateTimeFormat("de-CH", { day: "numeric", month: "short" }).format(d);
const tagNr = (d: Date) => d.getFullYear() * 10_000 + d.getMonth() * 100 + d.getDate();

const zelle: React.CSSProperties = {
  padding: "10px 12px",
  borderTop: `1px solid ${HAARLINIE}`,
  fontSize: 14,
  verticalAlign: "middle",
  textAlign: "left",
};
const kopf: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: 12.5,
  fontWeight: 700,
  color: P.dim,
  textAlign: "left",
  whiteSpace: "nowrap",
};
const pfeil: React.CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 10,
  border: `1px solid ${P.input}`,
  background: "#fff",
  color: P.text,
  fontSize: 18,
  cursor: "pointer",
  fontFamily: "inherit",
};

export default function BlogKalender({
  projekt,
  daten,
  eintraege,
  agentur,
  neuLaden,
}: {
  projekt: any;
  daten: any;
  eintraege: Eintrag[];
  agentur: boolean;
  neuLaden: () => Promise<void>;
}) {
  const projektId: string = projekt.id;
  const [ansicht, setAnsicht] = useState<Ansicht>("tabelle");
  const [versatz, setVersatz] = useState(0);
  const [suche, setSuche] = useState("");
  const [filter, setFilter] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<{ ton: "fehler" | "ok"; text: string } | null>(null);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(MERKER);
      if (v === "raster" || v === "tabelle") setAnsicht(v);
    } catch {
      // ohne Speicher: Standard
    }
  }, []);
  const waehleAnsicht = (a: Ansicht) => {
    setAnsicht(a);
    try {
      window.localStorage.setItem(MERKER, a);
    } catch {
      // nicht merken
    }
  };

  const heute = useMemo(() => new Date(), []);
  const start = useMemo(() => plusTage(montag(heute), versatz * 28), [heute, versatz]);
  const ende = plusTage(start, 27);
  const statusText = (e: Eintrag) =>
    artikelStatus(e.status, { agentur, geprueft: e.geprueft }).text;

  const imBereich = useMemo(() => {
    const bis = plusTage(start, 28).getTime();
    const q = suche.trim().toLowerCase();
    return eintraege
      .filter((e) =>
        e.tag ? e.tag.getTime() >= start.getTime() && e.tag.getTime() < bis : versatz === 0,
      )
      .filter((e) => !q || e.titel.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          (a.tag?.getTime() ?? Number.MAX_SAFE_INTEGER) -
          (b.tag?.getTime() ?? Number.MAX_SAFE_INTEGER),
      );
  }, [eintraege, start, suche, versatz]);

  if (!daten)
    return (
      <Block titel="Kalender">
        <div style={{ fontSize: 14, color: P.muted }}>Wird geladen…</div>
      </Block>
    );

  const zaehler = new Map<string, number>();
  for (const e of imBereich) zaehler.set(statusText(e), (zaehler.get(statusText(e)) ?? 0) + 1);
  const aktiverFilter = filter && zaehler.has(filter) ? filter : null;
  const sichtbar = aktiverFilter
    ? imBereich.filter((e) => statusText(e) === aktiverFilter)
    : imBereich;

  const imMonat = (d: Date | null) =>
    !!d && d.getFullYear() === heute.getFullYear() && d.getMonth() === heute.getMonth();
  const monatArtikel = eintraege.filter(
    (e) => e.artikelId && e.status !== "fehler" && imMonat(e.tag),
  ).length;
  const monatGeplant = eintraege.filter((e) => !e.artikelId && imMonat(e.tag)).length;
  const kontingent: number | null = daten.kontingent ?? null;

  const schreibe = async (topicId: string) => {
    setBusy(topicId);
    setMeldung(null);
    const r = await api(`/api/blog/projects/${projektId}/write-now`, "POST", { topicId });
    setBusy(null);
    if (!r.ok || !r.json?.ok) {
      setMeldung({
        ton: "fehler",
        text: r.json?.error || "Das hat nicht geklappt. Bitte nochmals versuchen.",
      });
      return;
    }
    setMeldung({ ton: "ok", text: "Der Artikel wird geschrieben. Das dauert ein paar Minuten." });
    await neuLaden();
  };

  const aktion = (e: Eintrag) => {
    const v = eintragVerweis(e, agentur);
    if (v)
      return (
        <a
          href={`/ezyrank/blog/artikel/${e.artikelId}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: 44,
            padding: v.stark ? "0 16px" : "0 2px",
            borderRadius: 99,
            fontSize: 14,
            fontWeight: 700,
            textDecoration: "none",
            whiteSpace: "nowrap",
            background: v.stark ? P.grad : "transparent",
            color: v.stark ? "#fff" : P.accent,
          }}
        >
          {v.text}
        </a>
      );
    if (agentur && !e.artikelId && e.topicId)
      return (
        <button
          type="button"
          onClick={() => void schreibe(e.topicId as string)}
          disabled={busy !== null}
          style={{
            minHeight: 44,
            padding: "0 2px",
            border: "none",
            background: "transparent",
            color: P.accent,
            fontSize: 14,
            fontWeight: 700,
            whiteSpace: "nowrap",
            cursor: busy !== null ? "not-allowed" : "pointer",
            opacity: busy !== null ? 0.55 : 1,
            fontFamily: "inherit",
          }}
        >
          {busy === e.topicId ? "Wird gestartet…" : "Jetzt schreiben"}
        </button>
      );
    return null;
  };

  const tabelle = (zeilen: Eintrag[]) => (
    <div style={{ overflowX: "auto", margin: "0 -8px" }}>
      <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th scope="col" style={kopf}>
              Datum
            </th>
            <th scope="col" style={kopf}>
              Inhalt
            </th>
            <th scope="col" style={kopf}>
              Status
            </th>
            <th scope="col" style={{ ...kopf, textAlign: "right" }}>
              Suchvolumen
            </th>
            <th scope="col" style={kopf}>
              Schwierigkeit
            </th>
            <th scope="col" style={kopf} aria-label="Aktion" />
          </tr>
        </thead>
        <tbody>
          {zeilen.map((e) => (
            <tr key={e.schluessel}>
              <td style={{ ...zelle, whiteSpace: "nowrap", color: P.muted }}>
                {e.tag ? (
                  <>
                    <span style={{ color: P.dim }}>{wochentag(e.tag)}</span> {datumText(e.tag)}
                  </>
                ) : (
                  "Kein Termin"
                )}
              </td>
              <td style={{ ...zelle, minWidth: 260 }}>
                <div style={{ fontWeight: 700, lineHeight: 1.3, overflowWrap: "anywhere" }}>
                  {e.titel}
                </div>
                <div style={{ fontSize: 12.5, color: P.muted, marginTop: 2 }}>
                  {MODUS_TEXT[e.modus] ?? e.modus}
                  {e.typ && ARTIKELTYP_TEXT[e.typ] ? ` · ${ARTIKELTYP_TEXT[e.typ]}` : ""}
                  {agentur && e.ungesendet ? " · Änderungen nicht gesendet" : ""}
                </div>
                {agentur && e.status === "fehler" && e.fehler && (
                  <div
                    style={{
                      fontSize: 12.5,
                      color: P.red,
                      marginTop: 2,
                      overflowWrap: "anywhere",
                    }}
                  >
                    {e.fehler}
                  </div>
                )}
              </td>
              <td style={zelle}>
                <StatusMarke status={e.status} agentur={agentur} geprueft={e.geprueft} />
              </td>
              <td style={{ ...zelle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {zahl(e.volume)}
              </td>
              <td style={zelle}>
                <Schwierigkeit wert={e.difficulty} />
              </td>
              <td style={{ ...zelle, textAlign: "right" }}>{aktion(e)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const tage = Array.from({ length: 28 }, (_, i) => plusTage(start, i));
  const ohneTermin = sichtbar.filter((e) => !e.tag);

  return (
    <Block
      titel="Kalender"
      rechts={
        <div style={{ fontSize: 13.5, color: P.muted }}>
          {kontingent
            ? `Diesen Monat: ${monatArtikel} von ${kontingent} Artikeln`
            : `Diesen Monat: ${monatArtikel} Artikel`}
          {monatGeplant > 0 ? `, ${monatGeplant} geplant` : ""}
        </div>
      }
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px 16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            aria-label="Vier Wochen zurück"
            onClick={() => setVersatz((v) => v - 1)}
            style={pfeil}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Vier Wochen vor"
            onClick={() => setVersatz((v) => v + 1)}
            style={pfeil}
          >
            ›
          </button>
          <div style={{ fontSize: 15, fontWeight: 700, marginLeft: 4 }}>
            {datumText(start)} bis {datumText(ende, true)}
          </div>
          {versatz !== 0 && (
            <button
              type="button"
              onClick={() => setVersatz(0)}
              style={{
                minHeight: 44,
                padding: "0 8px",
                border: "none",
                background: "transparent",
                color: P.accent,
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Heute
            </button>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <input
            type="search"
            value={suche}
            onChange={(ev) => setSuche(ev.target.value)}
            placeholder="Artikel suchen"
            aria-label="Artikel suchen"
            style={{ ...eingabe, width: 220, maxWidth: "100%" }}
          />
          <Segmente
            klein
            label="Ansicht"
            wert={ansicht}
            onChange={waehleAnsicht}
            optionen={[
              { id: "tabelle", label: "Tabelle" },
              { id: "raster", label: "Raster" },
            ]}
          />
        </div>
      </div>

      {zaehler.size > 1 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <FilterChip an={!aktiverFilter} onClick={() => setFilter(null)} anzahl={imBereich.length}>
            Alle
          </FilterChip>
          {[...zaehler.entries()].map(([text, n]) => (
            <FilterChip
              key={text}
              an={aktiverFilter === text}
              onClick={() => setFilter(text)}
              anzahl={n}
            >
              {text}
            </FilterChip>
          ))}
        </div>
      )}

      {meldung && <Hinweis ton={meldung.ton}>{meldung.text}</Hinweis>}

      {eintraege.length === 0 ? (
        <div style={{ fontSize: 14, color: P.muted }}>
          Noch keine Artikel geplant. Sobald Themen freigegeben sind, erscheinen sie hier.
        </div>
      ) : ansicht === "tabelle" ? (
        sichtbar.length === 0 ? (
          <div style={{ fontSize: 14, color: P.muted }}>
            {suche.trim()
              ? "Kein Artikel passt zur Suche."
              : "In diesen vier Wochen ist nichts geplant."}
          </div>
        ) : (
          tabelle(sichtbar)
        )
      ) : (
        <>
          <div style={{ overflowX: "auto" }}>
            <div
              style={{
                minWidth: 840,
                display: "grid",
                gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                border: `1px solid ${HAARLINIE}`,
                borderRadius: 12,
                overflow: "hidden",
              }}
            >
              {WOCHENTAGE.map((w) => (
                <div
                  key={w}
                  style={{
                    padding: "8px 10px",
                    fontSize: 12.5,
                    fontWeight: 700,
                    color: P.dim,
                    background: "rgba(43,0,51,.03)",
                  }}
                >
                  {w}
                </div>
              ))}
              {tage.map((d, i) => {
                const istHeute = tagNr(d) === tagNr(heute);
                const liste = sichtbar.filter((e) => e.tag && tagNr(e.tag) === tagNr(d));
                return (
                  <div
                    key={i}
                    style={{
                      minHeight: 112,
                      padding: 6,
                      borderTop: `1px solid ${HAARLINIE}`,
                      borderLeft: i % 7 === 0 ? "none" : `1px solid ${HAARLINIE}`,
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        alignSelf: "flex-start",
                        fontSize: 12.5,
                        fontWeight: istHeute ? 800 : 600,
                        color: istHeute ? "#fff" : P.muted,
                        background: istHeute ? P.accent : "transparent",
                        borderRadius: 99,
                        padding: "2px 8px",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {i === 0 || d.getDate() === 1 ? kurzMonat(d) : d.getDate()}
                    </div>
                    {liste.map((e) => {
                      const s = artikelStatus(e.status, { agentur, geprueft: e.geprueft });
                      const v = eintragVerweis(e, agentur);
                      const stil: React.CSSProperties = {
                        display: "block",
                        minHeight: 44,
                        padding: "6px 8px",
                        borderRadius: 8,
                        background: s.grund,
                        color: P.text,
                        textDecoration: "none",
                        fontSize: 12.5,
                        lineHeight: 1.3,
                        minWidth: 0,
                      };
                      const inhalt = (
                        <>
                          <span
                            style={{
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                              fontWeight: 700,
                              overflowWrap: "anywhere",
                            }}
                          >
                            {e.titel}
                          </span>
                          <span style={{ color: s.farbe, fontWeight: 700, fontSize: 11.5 }}>
                            {s.text}
                          </span>
                        </>
                      );
                      return v ? (
                        <a
                          key={e.schluessel}
                          href={`/ezyrank/blog/artikel/${e.artikelId}`}
                          title={`${e.titel} – ${v.text}`}
                          style={stil}
                        >
                          {inhalt}
                        </a>
                      ) : (
                        <div key={e.schluessel} title={e.titel} style={stil}>
                          {inhalt}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
          {ohneTermin.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>Ohne Termin</h3>
              {tabelle(ohneTermin)}
            </div>
          )}
        </>
      )}
    </Block>
  );
}
