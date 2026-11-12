import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ahrefsKpisFromResult,
  aiVisibilityScoreFromResult,
  useEzyLatestRun,
} from "@/ezy/data/useEzyLatestRun";
import {
  ARTIKELTYP_TEXT,
  Block,
  HAARLINIE,
  P,
  Schwierigkeit,
  Segmente,
  api,
  datumText,
  eingabe,
  verweisStil,
  zahl,
  zeitText,
  type Eintrag,
} from "@/ezy/BlogUi";
import type { BlogTab } from "@/ezy/BlogBereich";

// Blog-Dashboard: Kennzahlen, Suchverkehr, die nächsten Artikel, letzte
// Aktivität und die ersten Schritte.

const BLAU = "#2563eb";
const GUT = "#00704a";
const SCHLECHT = "#c01623";
const KI_TEXT: Record<string, string> = { Low: "Tief", Medium: "Mittel", High: "Hoch" };

type Gruppe = "artikel" | "pruefung" | "einstellung";
const EREIGNIS: Record<string, { text: string; gruppe: Gruppe; farbe: string }> = {
  "article.queued": { text: "Artikel eingeplant", gruppe: "artikel", farbe: P.accent },
  "article.draft_ready": { text: "Entwurf bereit", gruppe: "artikel", farbe: P.accent },
  "article.reviewed": { text: "Von Ezy One geprüft", gruppe: "pruefung", farbe: P.green },
  "article.approved": { text: "Freigegeben", gruppe: "artikel", farbe: P.green },
  "article.published": { text: "Veröffentlicht", gruppe: "artikel", farbe: P.green },
  "article.index_requested": {
    text: "Bei Suchmaschinen gemeldet",
    gruppe: "artikel",
    farbe: P.accent,
  },
  "article.wp_synced": {
    text: "Änderungen an WordPress gesendet",
    gruppe: "artikel",
    farbe: P.accent,
  },
  "article.factcheck_open": { text: "Faktencheck offen", gruppe: "pruefung", farbe: P.orange },
  "article.failed": { text: "Artikel fehlgeschlagen", gruppe: "artikel", farbe: P.red },
  "article.edited": { text: "Artikel bearbeitet", gruppe: "artikel", farbe: P.accent },
  "audit.done": { text: "Chancen-Prüfung abgeschlossen", gruppe: "pruefung", farbe: P.green },
  "audit.failed": { text: "Chancen-Prüfung fehlgeschlagen", gruppe: "pruefung", farbe: P.red },
  "onboarding.completed": {
    text: "Einrichtung abgeschlossen",
    gruppe: "einstellung",
    farbe: P.green,
  },
  "onboarding.topics_approved": {
    text: "Themenplan freigegeben",
    gruppe: "einstellung",
    farbe: P.green,
  },
  "wp.connected": { text: "WordPress verbunden", gruppe: "einstellung", farbe: P.green },
  "wp.test_failed": { text: "WordPress-Test fehlgeschlagen", gruppe: "einstellung", farbe: P.red },
  "project.updated": { text: "Einstellungen geändert", gruppe: "einstellung", farbe: P.dim },
  "rule.created": { text: "Schreibregel hinzugefügt", gruppe: "einstellung", farbe: P.dim },
  "rule.enabled": { text: "Schreibregel aktiviert", gruppe: "einstellung", farbe: P.dim },
  "rule.disabled": { text: "Schreibregel deaktiviert", gruppe: "einstellung", farbe: P.dim },
  "competitors.updated": { text: "Wettbewerber aktualisiert", gruppe: "einstellung", farbe: P.dim },
  "opportunity.decision": { text: "Chance entschieden", gruppe: "pruefung", farbe: P.dim },
};

const prozent = (jetzt: number, vorher: number): number | null =>
  vorher > 0 ? ((jetzt - vorher) / vorher) * 100 : null;

function Delta({
  diff,
  text,
  gutWennTiefer,
}: {
  diff: number | null;
  text: string;
  gutWennTiefer?: boolean;
}) {
  if (diff === null || !Number.isFinite(diff)) return null;
  const stil = { fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap" } as const;
  if (Math.abs(diff) < 0.05) return <span style={{ ...stil, color: P.dim }}>unverändert</span>;
  const gut = gutWennTiefer ? diff < 0 : diff > 0;
  return (
    <span style={{ ...stil, color: gut ? GUT : SCHLECHT }}>
      {diff > 0 ? "▲" : "▼"} {text}
    </span>
  );
}

function Kachel({ titel, wert, zusatz }: { titel: string; wert: ReactNode; zusatz?: ReactNode }) {
  return (
    <div
      style={{
        background: P.card,
        borderRadius: 12,
        boxShadow: "0 1px 2px rgba(43,0,51,.04), 0 10px 28px -20px rgba(43,0,51,.16)",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minWidth: 0,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600, color: P.muted }}>{titel}</span>
      <span
        style={{
          fontSize: 26,
          fontWeight: 800,
          lineHeight: 1.15,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {wert}
      </span>
      <span style={{ fontSize: 12.5, color: P.dim, minHeight: 18 }}>{zusatz}</span>
    </div>
  );
}

function Kennzahl({ titel, wert, delta }: { titel: string; wert: string; delta: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: P.muted }}>{titel}</span>
      <span style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
        {wert}
      </span>
      {delta}
    </div>
  );
}

const zelle = {
  padding: "10px 12px",
  borderTop: `1px solid ${HAARLINIE}`,
  fontSize: 13.5,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
} as const;
const kopf = {
  padding: "8px 12px",
  fontSize: 12,
  fontWeight: 700,
  color: P.dim,
  textAlign: "right",
  whiteSpace: "nowrap",
} as const;

function Suchverkehr({
  clientId,
  tage,
  setTage,
  daten,
}: {
  clientId: string;
  tage: string;
  setTage: (t: string) => void;
  daten: any;
}) {
  const [offen, setOffen] = useState(false);
  const verlauf = useMemo(
    () =>
      (daten?.verlauf ?? []).map((z: any) => ({
        ...z,
        label: `${z.date.slice(8, 10)}.${z.date.slice(5, 7)}.`,
      })),
    [daten],
  );
  const s = daten?.summe;
  const v = daten?.vorher;
  const bereit = daten?.verbunden && !daten?.fehler && s;

  return (
    <Block
      titel="Suchverkehr"
      rechts={
        <Segmente
          klein
          label="Zeitraum"
          wert={tage}
          onChange={setTage}
          optionen={[
            { id: "7", label: "7 Tage" },
            { id: "28", label: "28 Tage" },
            { id: "90", label: "90 Tage" },
          ]}
        />
      }
    >
      {!daten && <p style={{ margin: 0, color: P.dim, fontSize: 14 }}>Daten werden geladen…</p>}
      {daten && !daten.verbunden && (
        <div style={{ fontSize: 14, color: P.muted, lineHeight: 1.5 }}>
          Die Google Search Console ist noch nicht verbunden. Sobald sie verbunden ist, siehst du
          hier, wie oft die Website in der Suche erscheint und angeklickt wird.
          <div>
            <a href={`/ezyrank/blog/einrichtung/6?client=${clientId}`} style={verweisStil}>
              Search Console verbinden
            </a>
          </div>
        </div>
      )}
      {daten?.verbunden && daten.fehler && (
        <p style={{ margin: 0, color: P.muted, fontSize: 14 }}>
          Die Daten von Google lassen sich gerade nicht laden. Bitte später nochmals versuchen.
        </p>
      )}
      {bereit && (
        <>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, color: P.muted }}>
            <span>
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: P.accent,
                  marginRight: 6,
                }}
              />
              Impressionen <b style={{ color: P.text }}>{zahl(s.impressions)}</b>
            </span>
            <span>
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: BLAU,
                  marginRight: 6,
                }}
              />
              Klicks <b style={{ color: P.text }}>{zahl(s.clicks)}</b>
            </span>
          </div>
          <div style={{ width: "100%", height: 250 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={verlauf} margin={{ top: 6, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="blogImpr" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={P.accent} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={P.accent} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={HAARLINIE} vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke={P.dim}
                  fontSize={11}
                  minTickGap={24}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="imp"
                  stroke={P.dim}
                  fontSize={11}
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                />
                <YAxis
                  yAxisId="kl"
                  orientation="right"
                  stroke={P.dim}
                  fontSize={11}
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                />
                <Tooltip
                  labelFormatter={(_: any, p: any) => {
                    const d = p?.[0]?.payload?.date;
                    return d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : "";
                  }}
                  formatter={(w: any, name: any) => [zahl(Number(w)), name]}
                  contentStyle={{
                    background: P.card,
                    border: `1px solid ${P.border}`,
                    borderRadius: 8,
                    color: P.muted,
                    fontSize: 13,
                  }}
                />
                <Area
                  yAxisId="imp"
                  type="monotone"
                  dataKey="impressions"
                  name="Impressionen"
                  stroke={P.accent}
                  strokeWidth={2}
                  fill="url(#blogImpr)"
                />
                <Bar
                  yAxisId="kl"
                  dataKey="clicks"
                  name="Klicks"
                  fill={BLAU}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={14}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div>
            <button
              type="button"
              aria-expanded={offen}
              onClick={() => setOffen((o) => !o)}
              style={verweisStil}
            >
              {offen ? "Details ausblenden" : "Details anzeigen"}
            </button>
          </div>
          {offen && (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: 16,
                }}
              >
                <Kennzahl
                  titel="Impressionen"
                  wert={zahl(s.impressions)}
                  delta={(() => {
                    const d = prozent(s.impressions, v?.impressions ?? 0);
                    return <Delta diff={d} text={`${zahl(Math.abs(d ?? 0), 1)} %`} />;
                  })()}
                />
                <Kennzahl
                  titel="Klicks"
                  wert={zahl(s.clicks)}
                  delta={(() => {
                    const d = prozent(s.clicks, v?.clicks ?? 0);
                    return <Delta diff={d} text={`${zahl(Math.abs(d ?? 0), 1)} %`} />;
                  })()}
                />
                <Kennzahl
                  titel="Klickrate"
                  wert={`${zahl(s.ctr * 100, 1)} %`}
                  delta={(() => {
                    const d = v?.impressions ? (s.ctr - v.ctr) * 100 : null;
                    return <Delta diff={d} text={`${zahl(Math.abs(d ?? 0), 1)} Punkte`} />;
                  })()}
                />
                <Kennzahl
                  titel="Ø Position"
                  wert={zahl(s.position, 1)}
                  delta={(() => {
                    const d = v?.impressions ? s.position - v.position : null;
                    return (
                      <Delta
                        diff={d}
                        gutWennTiefer
                        text={`${zahl(Math.abs(d ?? 0), 1)} ${(d ?? 0) < 0 ? "besser" : "schlechter"}`}
                      />
                    );
                  })()}
                />
              </div>
              <p style={{ margin: 0, fontSize: 12.5, color: P.dim }}>
                Vergleich mit den {tage} Tagen davor.
              </p>
              {(daten.anfragen ?? []).length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
                    <thead>
                      <tr>
                        <th style={{ ...kopf, textAlign: "left" }}>Suchanfrage</th>
                        <th style={kopf}>Klicks</th>
                        <th style={kopf}>Impressionen</th>
                        <th style={kopf}>Klickrate</th>
                        <th style={kopf}>Position</th>
                      </tr>
                    </thead>
                    <tbody>
                      {daten.anfragen.map((q: any) => (
                        <tr key={q.query}>
                          <td style={{ ...zelle, textAlign: "left", whiteSpace: "normal" }}>
                            {q.query}
                          </td>
                          <td style={zelle}>{zahl(q.clicks)}</td>
                          <td style={zelle}>{zahl(q.impressions)}</td>
                          <td style={zelle}>{zahl(q.ctr * 100, 1)} %</td>
                          <td style={zelle}>{zahl(q.position, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div>
                <a href={`/ezyrank?tab=seo&client=${clientId}`} style={verweisStil}>
                  Mehr im SEO-Tab
                </a>
              </div>
            </>
          )}
        </>
      )}
    </Block>
  );
}

function AktivitaetZeile({ e }: { e: any }) {
  const art = EREIGNIS[e.type] ?? { text: e.type, farbe: P.dim };
  const zusatz =
    e.type === "onboarding.topics_approved" && e.info?.anzahl
      ? `${e.info.anzahl} Themen`
      : e.type === "project.updated" && e.info?.felder?.length
        ? `${e.info.felder.length} ${e.info.felder.length === 1 ? "Feld" : "Felder"}`
        : null;
  return (
    <li
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        padding: "10px 0",
        borderTop: `1px solid ${HAARLINIE}`,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: 99,
          background: art.farbe,
          marginTop: 7,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{art.text}</div>
        {(e.titel || zusatz) && (
          <div style={{ fontSize: 13.5, color: P.muted, overflowWrap: "anywhere" }}>
            {e.article_id && e.titel ? (
              <a
                href={`/ezyrank/blog/artikel/${e.article_id}`}
                style={{ color: P.accent, fontWeight: 600, textDecoration: "none" }}
              >
                {e.titel}
              </a>
            ) : (
              e.titel || zusatz
            )}
          </div>
        )}
      </div>
      <span style={{ fontSize: 12.5, color: P.dim, whiteSpace: "nowrap", marginTop: 2 }}>
        {zeitText(e.at)}
      </span>
    </li>
  );
}

function AktivitaetDialog({ events, zu }: { events: any[]; zu: () => void }) {
  const [suche, setSuche] = useState("");
  const [gruppe, setGruppe] = useState<"alle" | Gruppe>("alle");
  useEffect(() => {
    const taste = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") zu();
    };
    window.addEventListener("keydown", taste);
    return () => window.removeEventListener("keydown", taste);
  }, [zu]);
  const q = suche.trim().toLowerCase();
  const liste = events.filter((e) => {
    const art = EREIGNIS[e.type];
    if (gruppe !== "alle" && art?.gruppe !== gruppe) return false;
    return !q || `${art?.text ?? ""} ${e.titel ?? ""}`.toLowerCase().includes(q);
  });
  return (
    <div
      onClick={zu}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(20,0,26,.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Alle Aktivitäten"
        onClick={(ev) => ev.stopPropagation()}
        style={{
          background: P.card,
          color: P.text,
          borderRadius: 16,
          width: "min(640px, 100%)",
          maxHeight: "min(720px, 90vh)",
          display: "flex",
          flexDirection: "column",
          padding: 20,
          gap: 14,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Alle Aktivitäten</h2>
          <button type="button" onClick={zu} style={verweisStil}>
            Schliessen
          </button>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            autoFocus
            type="search"
            aria-label="Aktivitäten durchsuchen"
            placeholder="Suchen"
            value={suche}
            onChange={(ev) => setSuche(ev.target.value)}
            style={{ ...eingabe, flex: "1 1 200px", width: "auto" }}
          />
          <select
            aria-label="Art der Aktivität"
            value={gruppe}
            onChange={(ev) => setGruppe(ev.target.value as "alle" | Gruppe)}
            style={{ ...eingabe, flex: "0 1 180px", width: "auto" }}
          >
            <option value="alle">Alle Arten</option>
            <option value="artikel">Artikel</option>
            <option value="pruefung">Prüfungen</option>
            <option value="einstellung">Einstellungen</option>
          </select>
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, overflowY: "auto" }}>
          {liste.map((e) => (
            <AktivitaetZeile key={e.id} e={e} />
          ))}
          {liste.length === 0 && (
            <li style={{ color: P.dim, fontSize: 14, padding: "10px 0" }}>
              Keine Aktivität gefunden.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

export default function BlogDashboard({
  clientId,
  projekt,
  daten,
  eintraege,
  agentur,
  gehe,
}: {
  clientId: string;
  projekt: any;
  daten: any;
  eintraege: Eintrag[];
  agentur: boolean;
  gehe: (t: BlogTab) => void;
}) {
  const projektId: string = projekt.id;
  const [tage, setTage] = useState("28");
  const [verkehr, setVerkehr] = useState<Record<string, any>>({});
  const [events, setEvents] = useState<any[] | null>(null);
  const [alle, setAlle] = useState(false);

  const { run: ahrefsRun } = useEzyLatestRun(clientId, "ahrefs");
  const { run: kiRun } = useEzyLatestRun(clientId, "canonry_ai_visibility");
  const ahrefs = ahrefsRun ? ahrefsKpisFromResult(ahrefsRun.result) : null;
  const ki = kiRun ? aiVisibilityScoreFromResult(kiRun.result) : null;

  useEffect(() => {
    setVerkehr({});
    setEvents(null);
  }, [projektId]);

  // Die Kachel braucht immer 28 Tage, die Karte den gewählten Zeitraum.
  useEffect(() => {
    let aktiv = true;
    for (const t of new Set(["28", tage])) {
      if (verkehr[t]) continue;
      void api(`/api/blog/projects/${projektId}/traffic?tage=${t}`).then((r) => {
        if (!aktiv) return;
        setVerkehr((alt) => ({
          ...alt,
          [t]: r.ok && r.json?.ok ? r.json : { verbunden: true, fehler: true },
        }));
      });
    }
    return () => {
      aktiv = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projektId, tage]);

  useEffect(() => {
    let aktiv = true;
    void api(`/api/blog/projects/${projektId}/activity`).then((r) => {
      if (aktiv) setEvents(r.ok && r.json?.ok ? (r.json.events ?? []) : []);
    });
    return () => {
      aktiv = false;
    };
  }, [projektId]);

  const v28 = verkehr["28"];
  const klicks = v28?.verbunden && !v28.fehler ? v28.summe : null;
  const klickDelta = klicks ? prozent(klicks.clicks, v28.vorher?.clicks ?? 0) : null;

  const live = eintraege.filter((e) => e.status === "live");
  const vor30 = Date.now() - 30 * 86_400_000;
  const neuLive = live.filter((e) => e.liveSeit && Date.parse(e.liveSeit) >= vor30).length;

  const heute = new Date();
  heute.setHours(0, 0, 0, 0);
  const kommend = eintraege
    .filter(
      (e) =>
        ["geplant", "freigegeben", "schreibt"].includes(e.status) &&
        e.tag &&
        e.tag.getTime() >= heute.getTime(),
    )
    .sort((a, b) => a.tag!.getTime() - b.tag!.getTime());
  const letzter = kommend[kommend.length - 1]?.tag ?? null;

  const nurHub = projekt.publish_mode === "hub_only";
  const schritte = [
    { text: "Einrichtung abgeschlossen", fertig: true },
    nurHub
      ? { text: "Artikel erscheinen nur im Hub", fertig: true }
      : {
          text: "WordPress verbunden",
          fertig: projekt.wordpress?.status === "verbunden",
          href: `/ezyrank/blog/einrichtung/6?client=${clientId}`,
        },
    {
      text: "Search Console verbunden",
      fertig: !!v28?.verbunden,
      href: `/ezyrank/blog/einrichtung/6?client=${clientId}`,
    },
    {
      text: "Themenplan freigegeben",
      fertig: eintraege.length > 0,
      href: `/ezyrank/blog/einrichtung/7?client=${clientId}`,
    },
    {
      text: "Erster Artikel geprüft",
      fertig: eintraege.some(
        (e) => e.geprueft || e.status === "kunde_freigegeben" || e.status === "live",
      ),
    },
    { text: "Erster Artikel live", fertig: live.length > 0 },
  ] as { text: string; fertig: boolean; href?: string }[];
  const erledigt = schritte.filter((s) => s.fertig).length;
  const schritteBereit = !!daten && !!v28;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(165px, 1fr))",
          gap: 12,
        }}
      >
        <Kachel
          titel="Artikel live"
          wert={daten ? zahl(live.length) : "—"}
          zusatz={neuLive > 0 ? `${neuLive} neu in 30 Tagen` : "Seit Start des Autopiloten"}
        />
        <Kachel
          titel="Klicks, 28 Tage"
          wert={klicks ? zahl(klicks.clicks) : "—"}
          zusatz={
            klicks ? (
              <Delta diff={klickDelta} text={`${zahl(Math.abs(klickDelta ?? 0), 1)} %`} />
            ) : v28 && !v28.verbunden ? (
              "Search Console nicht verbunden"
            ) : null
          }
        />
        <Kachel
          titel="Backlinks"
          wert={ahrefs?.backlinks ? zahl(ahrefs.backlinks) : "—"}
          zusatz="Links von anderen Websites"
        />
        <Kachel
          titel="Domain Rating"
          wert={ahrefs?.score ? zahl(ahrefs.score) : "—"}
          zusatz="Stärke der Website, 0 bis 100"
        />
        <Kachel
          titel="KI-Sichtbarkeit"
          wert={
            ki ? (
              <>
                {ki.score}
                <span style={{ fontSize: 14, fontWeight: 600, color: P.dim }}> / 100</span>
              </>
            ) : (
              "—"
            )
          }
          zusatz={ki ? KI_TEXT[ki.label] : "Noch nicht gemessen"}
        />
      </div>

      <Suchverkehr clientId={clientId} tage={tage} setTage={setTage} daten={verkehr[tage]} />

      <Block
        titel="Als Nächstes"
        rechts={
          <button type="button" onClick={() => gehe("kalender")} style={verweisStil}>
            Zum Kalender
          </button>
        }
      >
        <p style={{ margin: 0, fontSize: 14, color: P.muted }}>
          {kommend.length > 0 && letzter
            ? `${kommend.length} Artikel geplant bis ${datumText(letzter, true)}.`
            : "Im Moment ist kein Artikel geplant. Neue Themen gibst du im Themenplan frei."}
        </p>
        {kommend.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            {kommend.slice(0, 8).map((e) => (
              <div
                key={e.schluessel}
                style={{
                  border: `1px solid ${P.border}`,
                  borderRadius: 12,
                  padding: 14,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div
                  style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13 }}
                >
                  <b>{datumText(e.tag!)}</b>
                  <span style={{ color: P.dim }}>
                    {e.modus === "refresh"
                      ? "Überarbeitung"
                      : (ARTIKELTYP_TEXT[e.typ ?? ""] ?? "Artikel")}
                  </span>
                </div>
                <div style={{ fontSize: 14.5, fontWeight: 700, overflowWrap: "anywhere", flex: 1 }}>
                  {e.titel}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    fontSize: 12.5,
                    color: P.muted,
                  }}
                >
                  <span>{e.volume != null ? `${zahl(e.volume)} Suchen/Monat` : ""}</span>
                  {e.difficulty != null && <Schwierigkeit wert={e.difficulty} />}
                </div>
              </div>
            ))}
          </div>
        )}
      </Block>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: 16,
          alignItems: "start",
        }}
      >
        <Block
          titel="Letzte Aktivität"
          rechts={
            (events?.length ?? 0) > 5 ? (
              <button type="button" onClick={() => setAlle(true)} style={verweisStil}>
                Alle anzeigen
              </button>
            ) : undefined
          }
        >
          {events === null ? (
            <p style={{ margin: 0, color: P.dim, fontSize: 14 }}>Wird geladen…</p>
          ) : events.length === 0 ? (
            <p style={{ margin: 0, color: P.muted, fontSize: 14 }}>Noch keine Aktivität.</p>
          ) : (
            <ul style={{ listStyle: "none", margin: "-10px 0 0", padding: 0 }}>
              {events.slice(0, 5).map((e) => (
                <AktivitaetZeile key={e.id} e={e} />
              ))}
            </ul>
          )}
        </Block>

        {schritteBereit && erledigt < schritte.length && (
          <Block
            titel="Erste Schritte"
            rechts={
              <span style={{ fontSize: 13, fontWeight: 700, color: P.muted }}>
                {erledigt} von {schritte.length}
              </span>
            }
          >
            <div
              role="progressbar"
              aria-label="Erste Schritte"
              aria-valuemin={0}
              aria-valuemax={schritte.length}
              aria-valuenow={erledigt}
              style={{ height: 6, borderRadius: 99, background: "rgba(43,0,51,.07)" }}
            >
              <div
                style={{
                  width: `${(erledigt / schritte.length) * 100}%`,
                  height: "100%",
                  borderRadius: 99,
                  background: P.grad,
                }}
              />
            </div>
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexDirection: "column",
              }}
            >
              {schritte.map((s) => (
                <li
                  key={s.text}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    minHeight: 40,
                    fontSize: 14,
                    color: s.fertig ? P.muted : P.text,
                    fontWeight: s.fertig ? 500 : 700,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 99,
                      flexShrink: 0,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      fontWeight: 800,
                      color: "#fff",
                      background: s.fertig ? P.green : "transparent",
                      border: s.fertig ? "none" : `2px solid ${P.input}`,
                    }}
                  >
                    {s.fertig ? "✓" : ""}
                  </span>
                  <span style={{ flex: 1 }}>
                    {s.text}
                    <span style={{ position: "absolute", left: -9999 }}>
                      {s.fertig ? " (erledigt)" : " (offen)"}
                    </span>
                  </span>
                  {!s.fertig && s.href && (agentur || !s.href.includes("/6?")) && (
                    <a href={s.href} style={{ ...verweisStil, fontSize: 13.5 }}>
                      Öffnen
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </Block>
        )}
      </div>

      {alle && events && <AktivitaetDialog events={events} zu={() => setAlle(false)} />}
    </div>
  );
}
