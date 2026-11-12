import { useCallback, useEffect, useMemo, useState } from "react";
import { Hinweis, MODUS_TEXT, P, StatusMarke, api, datumText, tagLokal } from "@/ezy/BlogUi";

// Blog-Autopilot: Kalender (Kap. 9). Wochen als Zeilen, Artikel und geplante
// Themen als Karten. Erscheint erst, wenn der Autopilot läuft.

type Eintrag = {
  schluessel: string;
  artikelId: string | null;
  topicId: string | null;
  titel: string;
  modus: string;
  status: string;
  tag: Date | null;
  geprueft: boolean;
  ungesendet: boolean;
  fehler: string | null;
};

const TAG_MS = 86_400_000;

function montag(d: Date): Date {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}

const wochentag = (d: Date) => new Intl.DateTimeFormat("de-CH", { weekday: "short" }).format(d);

function wochenTitel(start: Date, heute: Date): string {
  const diff = Math.round((start.getTime() - montag(heute).getTime()) / (7 * TAG_MS));
  if (diff === 0) return "Diese Woche";
  if (diff === 1) return "Nächste Woche";
  if (diff === -1) return "Letzte Woche";
  return `Woche vom ${datumText(start)}`;
}

export default function BlogKalender({ client }: { client: { id: string } | null }) {
  const [projekt, setProjekt] = useState<any>(null);
  const [daten, setDaten] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<{ ton: "fehler" | "ok"; text: string } | null>(null);
  const [alleWochen, setAlleWochen] = useState(false);

  const clientId = client?.id ?? null;

  useEffect(() => {
    let aktiv = true;
    setProjekt(null);
    setDaten(null);
    setMeldung(null);
    if (!clientId) return;
    void api(`/api/blog/projects?clientId=${clientId}`).then((r) => {
      if (aktiv && r.ok && r.json?.project?.status === "active") setProjekt(r.json.project);
    });
    return () => {
      aktiv = false;
    };
  }, [clientId]);

  const projektId: string | null = projekt?.id ?? null;

  const lade = useCallback(async () => {
    if (!projektId) return;
    const r = await api(`/api/blog/projects/${projektId}/articles`);
    if (r.ok && r.json?.ok) setDaten(r.json);
  }, [projektId]);

  useEffect(() => {
    void lade();
  }, [lade]);

  const agentur = !!daten?.agentur;
  const nurHub = projekt?.publish_mode === "hub_only";

  const eintraege = useMemo<Eintrag[]>(() => {
    if (!daten) return [];
    const artikel: Eintrag[] = (daten.articles ?? []).map((a: any) => ({
      schluessel: `a-${a.id}`,
      artikelId: a.id,
      topicId: a.topic_id ?? null,
      titel: a.title || a.focus_keyword || "Ohne Titel",
      modus: a.modus || "neu",
      status: a.status,
      tag: tagLokal(a.scheduled_for) ?? tagLokal(a.created_at),
      geprueft: !!a.review,
      ungesendet:
        !nurHub &&
        !!a.wp_post_id &&
        !!a.bearbeitet?.at &&
        (!a.wordpress?.at || a.wordpress.at < a.bearbeitet.at),
      fehler: a.error ?? null,
    }));
    const themen: Eintrag[] = (daten.geplant ?? []).map((t: any) => ({
      schluessel: `t-${t.id}`,
      artikelId: null,
      topicId: t.id,
      titel: t.keyword,
      modus: t.kind === "refresh" ? "refresh" : "neu",
      status: "geplant",
      tag: tagLokal(t.scheduled_for),
      geprueft: false,
      ungesendet: false,
      fehler: null,
    }));
    return [...artikel, ...themen];
  }, [daten, nurHub]);

  // Solange geschrieben wird, von selbst nachladen.
  const laeuft = eintraege.some((e) => e.status === "freigegeben" || e.status === "schreibt");
  useEffect(() => {
    if (!laeuft) return;
    const t = window.setInterval(() => void lade(), 20_000);
    return () => window.clearInterval(t);
  }, [laeuft, lade]);

  const heute = useMemo(() => new Date(), []);

  const wochen = useMemo(() => {
    const map = new Map<number, Eintrag[]>();
    for (const e of eintraege) {
      const k = e.tag ? montag(e.tag).getTime() : Number.MAX_SAFE_INTEGER;
      map.set(k, [...(map.get(k) ?? []), e]);
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([k, liste]) => ({
        k,
        start: k === Number.MAX_SAFE_INTEGER ? null : new Date(k),
        liste: liste.sort((a, b) => (a.tag?.getTime() ?? 0) - (b.tag?.getTime() ?? 0)),
      }));
  }, [eintraege]);

  if (!projekt || !daten) return null;

  const grenze = montag(heute).getTime() - 14 * TAG_MS;
  const fruehere = wochen.filter((w) => w.k < grenze);
  const sichtbar = alleWochen ? wochen : wochen.filter((w) => w.k >= grenze);

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
    await lade();
  };

  const verweis = (e: Eintrag): { text: string; stark: boolean } | null => {
    if (!e.artikelId) return null;
    if (e.status === "entwurf_wp") {
      if (agentur)
        return { text: e.geprueft ? "Ansehen" : "Prüfen und freigeben", stark: !e.geprueft };
      return e.geprueft ? { text: "Prüfen und freigeben", stark: true } : null;
    }
    if (e.status === "faktencheck")
      return agentur ? { text: "Faktencheck öffnen", stark: true } : null;
    if (e.status === "kunde_freigegeben" || e.status === "live")
      return { text: "Ansehen", stark: false };
    return null;
  };

  return (
    <section
      aria-label="Blog-Kalender"
      style={{
        background: P.card,
        boxShadow: P.shadow,
        borderRadius: 16,
        padding: "18px 18px 20px",
        marginBottom: 16,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        color: P.text,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "4px 16px",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Kalender</h2>
        <div style={{ fontSize: 13.5, color: P.muted }}>
          {kontingent
            ? `Diesen Monat: ${monatArtikel} von ${kontingent} Artikeln`
            : `Diesen Monat: ${monatArtikel} Artikel`}
          {monatGeplant > 0 ? `, ${monatGeplant} geplant` : ""}
        </div>
      </div>

      {meldung && <Hinweis ton={meldung.ton}>{meldung.text}</Hinweis>}

      {eintraege.length === 0 && (
        <div style={{ fontSize: 14, color: P.muted }}>
          Noch keine Artikel geplant. Sobald Themen freigegeben sind, erscheinen sie hier.
        </div>
      )}

      {!alleWochen && fruehere.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setAlleWochen(true)}
            style={{
              minHeight: 44,
              padding: "0 4px",
              border: "none",
              background: "transparent",
              color: P.accent,
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Frühere Wochen anzeigen ({fruehere.length})
          </button>
        </div>
      )}

      {sichtbar.map((w) => (
        <div key={w.k} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>
              {w.start ? wochenTitel(w.start, heute) : "Ohne Termin"}
            </h3>
            {w.start && (
              <span style={{ fontSize: 12.5, color: P.dim }}>
                {datumText(w.start)} bis {datumText(new Date(w.start.getTime() + 6 * TAG_MS))}
              </span>
            )}
          </div>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
              gap: 10,
            }}
          >
            {w.liste.map((e) => {
              const v = verweis(e);
              return (
                <li
                  key={e.schluessel}
                  style={{
                    border: `1px solid ${P.border}`,
                    borderRadius: 14,
                    padding: "12px 14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    background: e.status === "geplant" ? "transparent" : P.bg,
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span style={{ fontSize: 12.5, color: P.dim }}>
                      {e.tag ? `${wochentag(e.tag)} ${datumText(e.tag)}` : "Kein Termin"}
                    </span>
                    <StatusMarke status={e.status} agentur={agentur} geprueft={e.geprueft} />
                  </div>
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      lineHeight: 1.3,
                      overflowWrap: "anywhere",
                    }}
                  >
                    {e.titel}
                  </div>
                  <div style={{ fontSize: 12.5, color: P.muted }}>
                    {MODUS_TEXT[e.modus] ?? e.modus}
                    {agentur && e.ungesendet ? " · Änderungen nicht gesendet" : ""}
                  </div>
                  {agentur && e.status === "fehler" && e.fehler && (
                    <div style={{ fontSize: 12.5, color: P.red, overflowWrap: "anywhere" }}>
                      {e.fehler}
                    </div>
                  )}
                  {v && (
                    <a
                      href={`/ezyrank/blog/artikel/${e.artikelId}`}
                      style={{
                        alignSelf: "flex-start",
                        display: "inline-flex",
                        alignItems: "center",
                        minHeight: 44,
                        padding: v.stark ? "0 18px" : "0 2px",
                        borderRadius: 99,
                        fontSize: 14,
                        fontWeight: 700,
                        textDecoration: "none",
                        background: v.stark ? P.grad : "transparent",
                        color: v.stark ? "#fff" : P.accent,
                      }}
                    >
                      {v.text}
                    </a>
                  )}
                  {agentur && !e.artikelId && e.topicId && (
                    <button
                      type="button"
                      onClick={() => void schreibe(e.topicId as string)}
                      disabled={busy !== null}
                      style={{
                        alignSelf: "flex-start",
                        minHeight: 44,
                        padding: "0 2px",
                        border: "none",
                        background: "transparent",
                        color: P.accent,
                        fontSize: 14,
                        fontWeight: 700,
                        cursor: busy !== null ? "not-allowed" : "pointer",
                        opacity: busy !== null ? 0.55 : 1,
                        fontFamily: "inherit",
                      }}
                    >
                      {busy === e.topicId ? "Wird gestartet…" : "Jetzt schreiben"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
