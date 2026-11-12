import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Block,
  FilterChip,
  HAARLINIE,
  Hinweis,
  Knopf,
  P,
  api,
  verweisStil,
  zahl,
  zeitText,
} from "@/ezy/BlogUi";

// Blog-Tab «Optimierung»: bestehende Inhalte, die mit wenig Aufwand besser
// ranken können. Entschieden wird im Themenplan; hier steht die Übersicht.

const KATEGORIE: Record<string, string> = {
  fast_vorne: "Fast vorne",
  abgedeckt: "Schon abgedeckt",
};
const ENTSCHEID: Record<string, { text: string; farbe: string; grund: string }> = {
  offen: { text: "Offen", farbe: P.muted, grund: "rgba(43,0,51,.06)" },
  uebernommen: { text: "Eingeplant", farbe: "#00704a", grund: P.greenDim },
  refresh: { text: "Überarbeitung geplant", farbe: P.accent, grund: P.accentDim },
  verworfen: { text: "Verworfen", farbe: P.dim, grund: "rgba(43,0,51,.04)" },
};

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
const rechts: React.CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums" };

export default function BlogOptimierung({
  projekt,
  agentur,
  clientId,
  refreshRadar,
}: {
  projekt: any;
  agentur: boolean;
  clientId: string;
  refreshRadar?: ReactNode;
}) {
  const projektId: string = projekt.id;
  const [daten, setDaten] = useState<any>(null);
  const [fehler, setFehler] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);

  const laden = useCallback(async () => {
    const r = await api(`/api/blog/projects/${projektId}/opportunities`);
    if (r.ok && r.json?.ok) {
      setDaten(r.json);
      setFehler(false);
    } else setFehler(true);
  }, [projektId]);

  useEffect(() => {
    setDaten(null);
    void laden();
  }, [laden]);

  const audit = daten?.audit ?? null;
  const laeuft = !!audit && ["queued", "running"].includes(audit.status);
  useEffect(() => {
    if (!laeuft) return;
    const t = window.setInterval(() => void laden(), 8000);
    return () => window.clearInterval(t);
  }, [laeuft, laden]);

  const pruefe = async () => {
    setBusy(true);
    setMeldung(null);
    const r = await api(`/api/blog/projects/${projektId}/audit`, "POST", { trigger: "manuell" });
    setBusy(false);
    if (!r.ok || !r.json?.ok) {
      setMeldung(
        r.json?.error || "Die Prüfung liess sich nicht starten. Bitte nochmals versuchen.",
      );
      return;
    }
    await laden();
  };

  const alle: any[] = (daten?.opportunities ?? []).filter((o: any) => KATEGORIE[o.category]);
  const sichtbar = filter ? alle.filter((o) => o.category === filter) : alle;
  const anzahl = (k: string) => alle.filter((o) => o.category === k).length;
  const zuletzt = daten?.ergebnisAudit?.finished_at ?? null;

  return (
    <>
      <Block
        titel="Optimierung"
        rechts={
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, color: P.muted }}>
              {laeuft
                ? `Prüfung läuft… ${Math.round(audit.percent ?? 0)} %`
                : zuletzt
                  ? `Zuletzt geprüft: ${zeitText(zuletzt)}`
                  : "Noch nicht geprüft"}
            </span>
            {agentur && (
              <Knopf art="sekundaer" onClick={() => void pruefe()} disabled={busy || laeuft}>
                {busy ? "Wird gestartet…" : "Jetzt prüfen"}
              </Knopf>
            )}
          </div>
        }
      >
        <div style={{ fontSize: 14, color: P.muted, maxWidth: 720 }}>
          Themen, bei denen deine Website schon gefunden wird. Eine Überarbeitung bringt hier oft
          schneller Besucher als ein neuer Artikel.
        </div>

        {meldung && <Hinweis ton="fehler">{meldung}</Hinweis>}
        {agentur && audit?.status === "failed" && (
          <Hinweis ton="fehler">
            Die letzte Prüfung ist fehlgeschlagen{audit.error ? `: ${audit.error}` : "."}
          </Hinweis>
        )}

        {fehler ? (
          <Hinweis ton="fehler">Die Daten liessen sich nicht laden. Bitte Seite neu laden.</Hinweis>
        ) : !daten ? (
          <div style={{ fontSize: 14, color: P.muted }}>Wird geladen…</div>
        ) : alle.length === 0 ? (
          <div style={{ fontSize: 14, color: P.muted }}>
            {laeuft
              ? "Die Prüfung läuft. Die Ergebnisse erscheinen hier von selbst."
              : "Im Moment gibt es nichts zu optimieren."}
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <FilterChip an={!filter} onClick={() => setFilter(null)} anzahl={alle.length}>
                Alle
              </FilterChip>
              {Object.entries(KATEGORIE).map(([id, text]) => (
                <FilterChip
                  key={id}
                  an={filter === id}
                  onClick={() => setFilter(id)}
                  anzahl={anzahl(id)}
                >
                  {text}
                </FilterChip>
              ))}
            </div>
            {sichtbar.length === 0 ? (
              <div style={{ fontSize: 14, color: P.muted }}>Nichts in dieser Auswahl.</div>
            ) : (
              <div style={{ overflowX: "auto", margin: "0 -8px" }}>
                <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th scope="col" style={kopf}>
                        Thema
                      </th>
                      <th scope="col" style={kopf}>
                        Einordnung
                      </th>
                      <th scope="col" style={{ ...kopf, textAlign: "right" }}>
                        Position
                      </th>
                      <th scope="col" style={{ ...kopf, textAlign: "right" }}>
                        Impressionen
                      </th>
                      <th scope="col" style={{ ...kopf, textAlign: "right" }}>
                        Suchvolumen
                      </th>
                      <th scope="col" style={kopf}>
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sichtbar.map((o) => {
                      const e = ENTSCHEID[o.decision] ?? ENTSCHEID.offen;
                      return (
                        <tr key={o.id}>
                          <td style={{ ...zelle, minWidth: 260 }}>
                            <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>
                              {o.keyword}
                            </div>
                            {o.covered_by_url && (
                              <a
                                href={o.covered_by_url}
                                target="_blank"
                                rel="noreferrer"
                                style={{
                                  fontSize: 12.5,
                                  color: P.muted,
                                  overflowWrap: "anywhere",
                                }}
                              >
                                {String(o.covered_by_url).replace(/^https?:\/\/(www\.)?/, "")}
                              </a>
                            )}
                            {o.reason && (
                              <div style={{ fontSize: 12.5, color: P.dim, marginTop: 2 }}>
                                {o.reason}
                              </div>
                            )}
                          </td>
                          <td style={{ ...zelle, whiteSpace: "nowrap", color: P.muted }}>
                            {KATEGORIE[o.category]}
                          </td>
                          <td style={{ ...zelle, ...rechts }}>{zahl(o.avg_position, 1)}</td>
                          <td style={{ ...zelle, ...rechts }}>{zahl(o.impressions)}</td>
                          <td style={{ ...zelle, ...rechts }}>{zahl(o.volume)}</td>
                          <td style={zelle}>
                            <span
                              style={{
                                display: "inline-block",
                                fontSize: 12.5,
                                fontWeight: 700,
                                color: e.farbe,
                                background: e.grund,
                                borderRadius: 99,
                                padding: "4px 10px",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {e.text}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <a href={`/ezyrank/blog/einrichtung/7?client=${clientId}`} style={verweisStil}>
              Im Themenplan einplanen oder verwerfen
            </a>
          </>
        )}
      </Block>
      {refreshRadar}
    </>
  );
}
