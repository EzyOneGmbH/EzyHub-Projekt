import { useCallback, useEffect, useState } from "react";
import {
  Block,
  FilterChip,
  HAARLINIE,
  Hinweis,
  Knopf,
  P,
  api,
  datumText,
  tagLokal,
  verweisStil,
} from "@/ezy/BlogUi";

// Blog-Tab «Optimierung», oberer Teil: alle veröffentlichten Artikel mit
// Einschätzung. «Mit KI optimieren» legt eine Überarbeitung als Entwurf an und
// öffnet sie im Editor; der Artikel auf der Website bleibt bis zur Freigabe.

const STUFE: Record<string, { text: string; farbe: string; grund: string }> = {
  hoch: { text: "Optimieren", farbe: P.accent, grund: P.accentDim },
  mittel: { text: "Auffrischen", farbe: P.text, grund: "rgba(43,0,51,.08)" },
  ok: { text: "In Ordnung", farbe: "#00704a", grund: P.greenDim },
};
const SEITE = 25;

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
const editor = (id: string) => `/ezyrank/blog/artikel/${id}`;

export default function BlogOptimierungArtikel({
  projektId,
  agentur,
}: {
  projektId: string;
  agentur: boolean;
}) {
  const [liste, setListe] = useState<any[] | null>(null);
  const [fehler, setFehler] = useState(false);
  const [filter, setFilter] = useState<"alle" | "empfohlen" | "arbeit">("alle");
  const [busy, setBusy] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);
  const [alleZeigen, setAlleZeigen] = useState(false);

  const laden = useCallback(async () => {
    const r = await api(`/api/blog/projects/${projektId}/optimierung`);
    if (r.ok && r.json?.ok) {
      setListe(r.json.artikel ?? []);
      setFehler(false);
    } else setFehler(true);
  }, [projektId]);

  useEffect(() => {
    setListe(null);
    void laden();
  }, [laden]);

  const schreibt = (liste ?? []).some((a) => a.ueberarbeitung?.zustand === "laeuft");
  useEffect(() => {
    if (!schreibt) return;
    const t = window.setInterval(() => void laden(), 8000);
    return () => window.clearInterval(t);
  }, [schreibt, laden]);

  const optimiere = async (articleId: string) => {
    setBusy(articleId);
    setMeldung(null);
    const r = await api(`/api/blog/projects/${projektId}/optimize`, "POST", { articleId });
    const ziel = r.json?.article?.id;
    if (ziel && (r.json?.ok || r.status === 409)) {
      window.location.href = editor(ziel);
      return;
    }
    setBusy(null);
    setMeldung(
      r.json?.error || "Die Optimierung liess sich nicht starten. Bitte nochmals versuchen.",
    );
  };

  const alle = liste ?? [];
  const empfohlen = alle.filter((a) => a.einschaetzung?.stufe !== "ok");
  const inArbeit = alle.filter((a) => a.ueberarbeitung);
  const gefiltert = filter === "empfohlen" ? empfohlen : filter === "arbeit" ? inArbeit : alle;
  const sichtbar = alleZeigen ? gefiltert : gefiltert.slice(0, SEITE);

  return (
    <Block titel="Veröffentlichte Artikel">
      <div style={{ fontSize: 14, color: P.muted, maxWidth: 720 }}>
        Alle Artikel, die auf deiner Website live sind, mit einer Einschätzung. Eine Optimierung
        entsteht als Entwurf im Editor. Der Artikel auf der Website bleibt unverändert, bis die
        Überarbeitung freigegeben ist.
      </div>

      {meldung && <Hinweis ton="fehler">{meldung}</Hinweis>}

      {fehler ? (
        <Hinweis ton="fehler">Die Artikel liessen sich nicht laden. Bitte Seite neu laden.</Hinweis>
      ) : !liste ? (
        <div style={{ fontSize: 14, color: P.muted }}>Wird geladen…</div>
      ) : alle.length === 0 ? (
        <div style={{ fontSize: 14, color: P.muted }}>
          Es sind noch keine veröffentlichten Artikel erfasst.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <FilterChip
              an={filter === "alle"}
              onClick={() => setFilter("alle")}
              anzahl={alle.length}
            >
              Alle
            </FilterChip>
            <FilterChip
              an={filter === "empfohlen"}
              onClick={() => setFilter("empfohlen")}
              anzahl={empfohlen.length}
            >
              Optimierung empfohlen
            </FilterChip>
            <FilterChip
              an={filter === "arbeit"}
              onClick={() => setFilter("arbeit")}
              anzahl={inArbeit.length}
            >
              In Arbeit
            </FilterChip>
          </div>
          {sichtbar.length === 0 ? (
            <div style={{ fontSize: 14, color: P.muted }}>Nichts in dieser Auswahl.</div>
          ) : (
            <div style={{ overflowX: "auto", maxWidth: "100%" }}>
              <table style={{ width: "100%", minWidth: 640, borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th scope="col" style={kopf}>
                      Artikel
                    </th>
                    <th scope="col" style={kopf}>
                      Veröffentlicht
                    </th>
                    <th scope="col" style={kopf}>
                      Einschätzung
                    </th>
                    <th scope="col" style={kopf}>
                      {agentur ? "Aktion" : "Überarbeitung"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sichtbar.map((a) => {
                    const s = STUFE[a.einschaetzung?.stufe] ?? STUFE.ok;
                    const u = a.ueberarbeitung;
                    const tag = a.published_at
                      ? tagLokal(String(a.published_at).slice(0, 10))
                      : null;
                    return (
                      <tr key={a.id}>
                        <td style={{ ...zelle, minWidth: 200 }}>
                          <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>
                            {a.title || "Ohne Titel"}
                          </div>
                          {a.url && (
                            <a
                              href={a.url}
                              target="_blank"
                              rel="noreferrer"
                              style={{ fontSize: 12.5, color: P.muted, overflowWrap: "anywhere" }}
                            >
                              {String(a.url).replace(/^https?:\/\/(www\.)?/, "")}
                            </a>
                          )}
                        </td>
                        <td style={{ ...zelle, whiteSpace: "nowrap", color: P.muted }}>
                          {tag ? datumText(tag, true) : "–"}
                        </td>
                        <td style={{ ...zelle, minWidth: 180 }}>
                          <span
                            style={{
                              display: "inline-block",
                              fontSize: 12.5,
                              fontWeight: 700,
                              color: s.farbe,
                              background: s.grund,
                              borderRadius: 99,
                              padding: "4px 10px",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {s.text}
                          </span>
                          {a.einschaetzung?.grund && a.einschaetzung.stufe !== "ok" && (
                            <div style={{ fontSize: 12.5, color: P.dim, marginTop: 4 }}>
                              {a.einschaetzung.grund}
                            </div>
                          )}
                        </td>
                        <td style={{ ...zelle, minWidth: 190 }}>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "flex-start",
                              gap: 2,
                            }}
                          >
                            {u?.zustand === "laeuft" && (
                              <span style={{ fontSize: 13.5, color: P.muted }}>
                                Wird geschrieben…
                              </span>
                            )}
                            {u?.zustand === "fehler" && (
                              <span style={{ fontSize: 13.5, color: P.muted }}>
                                Überarbeitung fehlgeschlagen
                              </span>
                            )}
                            {u && (
                              <a href={editor(u.id)} style={verweisStil}>
                                {u.zustand === "bereit"
                                  ? "Überarbeitung im Editor öffnen"
                                  : "Im Editor öffnen"}
                              </a>
                            )}
                            {!u && agentur && (
                              <Knopf
                                art="sekundaer"
                                onClick={() => void optimiere(a.id)}
                                disabled={busy !== null}
                              >
                                {busy === a.id ? "Wird gestartet…" : "Mit KI optimieren"}
                              </Knopf>
                            )}
                            {!u && !a.extern && (
                              <a href={editor(a.id)} style={verweisStil}>
                                Im Editor öffnen
                              </a>
                            )}
                            {!u && !agentur && a.extern && (
                              <span style={{ fontSize: 13.5, color: P.dim }}>–</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!alleZeigen && gefiltert.length > SEITE && (
            <div>
              <Knopf art="text" onClick={() => setAlleZeigen(true)}>
                Alle {gefiltert.length} anzeigen
              </Knopf>
            </div>
          )}
        </>
      )}
    </Block>
  );
}
