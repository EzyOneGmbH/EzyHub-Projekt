import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Block, Chip, Feld, HAARLINIE, Hinweis, Knopf, P, api, eingabe } from "@/ezy/BlogUi";
import { BILDSTILE, SPRACHEN, TONALITAETEN } from "@/ezy/data/blogAutopilot";

// Blog-Tab «Einstellungen»: was der Autopilot über das Unternehmen weiss und
// wie er schreibt. Jeder Abschnitt speichert für sich.

const MAERKTE: [string, string][] = [
  ["CH", "Schweiz"],
  ["DE", "Deutschland"],
  ["AT", "Österreich"],
  ["LI", "Liechtenstein"],
  ["FR", "Frankreich"],
  ["IT", "Italien"],
  ["GB", "Grossbritannien"],
  ["US", "USA"],
];
const SPRACH_LABEL: Record<string, string> = {
  "de-CH": "Deutsch (Schweiz)",
  "de-DE": "Deutsch (Deutschland)",
  "fr-CH": "Französisch (Schweiz)",
  "it-CH": "Italienisch (Schweiz)",
  en: "Englisch",
};
const REGEL_QUELLE: Record<string, string> = {
  standard: "Standard",
  onboarding: "Einrichtung",
  agentur: "Ezy One",
  feedback: "Aus Rückmeldung",
};

type Meldung = { ton: "fehler" | "ok"; text: string } | null;

function fehlerText(r: { json: any }, ersatz: string): string {
  const felder = Array.isArray(r.json?.felder) ? ` (${r.json.felder.join(", ")})` : "";
  return (r.json?.error || ersatz) + felder;
}

/** Nur was sich geändert hat, geht an den Server. */
function geaendert(alt: Record<string, any>, neu: Record<string, any>): Record<string, any> {
  const aus: Record<string, any> = {};
  for (const k of Object.keys(neu))
    if (JSON.stringify(neu[k]) !== JSON.stringify(alt[k] ?? null)) aus[k] = neu[k];
  return aus;
}

function Fusszeile({
  meldung,
  busy,
  onSpeichern,
  aktiv = true,
}: {
  meldung: Meldung;
  busy: boolean;
  onSpeichern: () => void;
  aktiv?: boolean;
}) {
  return (
    <>
      {meldung && <Hinweis ton={meldung.ton}>{meldung.text}</Hinweis>}
      <div>
        <Knopf onClick={onSpeichern} disabled={busy || !aktiv}>
          {busy ? "Wird gespeichert…" : "Speichern"}
        </Knopf>
      </div>
    </>
  );
}

function Raster({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        gap: 14,
      }}
    >
      {children}
    </div>
  );
}

function Kachel({
  an,
  onClick,
  titel,
  text,
}: {
  an: boolean;
  onClick: () => void;
  titel: string;
  text: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={an}
      onClick={onClick}
      style={{
        textAlign: "left",
        padding: "12px 14px",
        minHeight: 44,
        borderRadius: 12,
        border: `1px solid ${an ? P.accent : P.input}`,
        background: an ? P.accentDim : "#fff",
        cursor: "pointer",
        fontFamily: "inherit",
        color: P.text,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 800, color: an ? P.accent : P.text }}>{titel}</div>
      <div style={{ fontSize: 13, color: P.muted, marginTop: 3 }}>{text}</div>
    </button>
  );
}

/** Speichert geänderte Projektfelder und meldet das Ergebnis. */
function useProjektSpeichern(projekt: any, onProjekt: (neu: any) => void) {
  const [busy, setBusy] = useState(false);
  const [meldung, setMeldung] = useState<Meldung>(null);
  const speichern = async (neu: Record<string, any>) => {
    const felder = geaendert(projekt, neu);
    if (Object.keys(felder).length === 0) {
      setMeldung({ ton: "ok", text: "Es gibt nichts Neues zu speichern." });
      return;
    }
    setBusy(true);
    setMeldung(null);
    const r = await api(`/api/blog/projects/${projekt.id}`, "PATCH", felder);
    setBusy(false);
    if (r.ok && r.json?.ok) {
      onProjekt(r.json.project);
      setMeldung({ ton: "ok", text: "Gespeichert." });
    } else setMeldung({ ton: "fehler", text: fehlerText(r, "Speichern fehlgeschlagen") });
  };
  return { busy, meldung, setMeldung, speichern };
}

function Unternehmen({ projekt, onProjekt }: { projekt: any; onProjekt: (neu: any) => void }) {
  const [name, setName] = useState<string>(projekt.name ?? "");
  const [beschreibung, setBeschreibung] = useState<string>(projekt.description ?? "");
  const [gruppen, setGruppen] = useState<string[]>(projekt.audiences ?? []);
  const [neueGruppe, setNeueGruppe] = useState("");
  const [markt, setMarkt] = useState<string>(projekt.market ?? "CH");
  const [lokal, setLokal] = useState<boolean>(!!projekt.local_business);
  const s = useProjektSpeichern(projekt, onProjekt);

  const fuegeHinzu = () => {
    const g = neueGruppe.trim().slice(0, 300);
    if (!g || gruppen.includes(g) || gruppen.length >= 4) return;
    setGruppen([...gruppen, g]);
    setNeueGruppe("");
  };

  return (
    <Block titel="Unternehmen">
      <Raster>
        <Feld label="Name" id="blog-e-name">
          <input
            id="blog-e-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={eingabe}
          />
        </Feld>
        <Feld label="Markt" id="blog-e-markt">
          <select
            id="blog-e-markt"
            value={markt}
            onChange={(e) => setMarkt(e.target.value)}
            style={eingabe}
          >
            {MAERKTE.map(([id, text]) => (
              <option key={id} value={id}>
                {text}
              </option>
            ))}
          </select>
        </Feld>
      </Raster>
      <Feld
        label="Beschreibung"
        hilfe="Was ihr anbietet und was euch ausmacht. Daraus leitet der Autopilot Themen und Beispiele ab."
        id="blog-e-beschreibung"
      >
        <textarea
          id="blog-e-beschreibung"
          value={beschreibung}
          maxLength={4000}
          rows={5}
          onChange={(e) => setBeschreibung(e.target.value)}
          style={{ ...eingabe, resize: "vertical", fontFamily: "inherit" }}
        />
      </Feld>
      <Feld label="Zielgruppen" hilfe="Höchstens vier." id="blog-e-gruppe">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          {gruppen.map((g) => (
            <Chip key={g} onRemove={() => setGruppen(gruppen.filter((x) => x !== g))}>
              {g}
            </Chip>
          ))}
        </div>
        {gruppen.length < 4 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              id="blog-e-gruppe"
              value={neueGruppe}
              maxLength={300}
              placeholder="Zum Beispiel: Spenderinnen und Spender in der Schweiz"
              onChange={(e) => setNeueGruppe(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  fuegeHinzu();
                }
              }}
              style={{ ...eingabe, flex: "1 1 260px", width: "auto" }}
            />
            <Knopf art="sekundaer" onClick={fuegeHinzu} disabled={!neueGruppe.trim()}>
              Hinzufügen
            </Knopf>
          </div>
        )}
      </Feld>
      <label
        style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, fontSize: 14 }}
      >
        <input
          type="checkbox"
          checked={lokal}
          onChange={(e) => setLokal(e.target.checked)}
          style={{ width: 18, height: 18, accentColor: P.accent }}
        />
        Lokales Geschäft: Kundschaft kommt vor allem aus der Region
      </label>
      <Fusszeile
        meldung={s.meldung}
        busy={s.busy}
        aktiv={!!name.trim()}
        onSpeichern={() =>
          void s.speichern({
            name: name.trim(),
            description: beschreibung.trim(),
            audiences: gruppen,
            market: markt,
            local_business: lokal,
          })
        }
      />
    </Block>
  );
}

function Inhalt({
  projekt,
  agentur,
  onProjekt,
}: {
  projekt: any;
  agentur: boolean;
  onProjekt: (neu: any) => void;
}) {
  const cta0 = (projekt.cta_blocks ?? [])[0] ?? {};
  const [sprache, setSprache] = useState<string>(projekt.language ?? "de-CH");
  const [ton, setTon] = useState<string>(projekt.tone ?? "informativ");
  const [links, setLinks] = useState<number>(projekt.internal_links ?? 3);
  const [zeit, setZeit] = useState<string>(String(projekt.publish_time || "09:00").slice(0, 5));
  const [modus, setModus] = useState<string>(projekt.publish_mode ?? "wp_draft");
  const [bild, setBild] = useState<string>(projekt.image_style ?? "fotografisch");
  const [ctaLabel, setCtaLabel] = useState<string>(cta0.label ?? "");
  const [ctaUrl, setCtaUrl] = useState<string>(cta0.url ?? "");
  const [ctaText, setCtaText] = useState<string>(cta0.text ?? "");
  const [ctaPos, setCtaPos] = useState<string>(cta0.position ?? "end");
  const [minVolumen, setMinVolumen] = useState<string>(String(projekt.min_volume ?? 0));
  const [minImpr, setMinImpr] = useState<string>(String(projekt.min_impressions ?? 0));
  const [proMonat, setProMonat] = useState<string>(String(projekt.articles_per_month ?? ""));
  // Gespeicherte Zeit kann Sekunden tragen; verglichen wird nur HH:MM.
  const s = useProjektSpeichern(
    { ...projekt, publish_time: String(projekt.publish_time || "09:00").slice(0, 5) },
    onProjekt,
  );

  const label = ctaLabel.trim();
  const url = ctaUrl.trim();
  const ctaOk = !label && !url ? true : !!label && /^https:\/\/[^\s]+\.[^\s]+/i.test(url);
  const ganz = (v: string) => Math.max(0, Math.round(Number(v) || 0));

  const speichern = () => {
    if (!ctaOk) {
      s.setMeldung({ ton: "fehler", text: "Button-Text und ein https-Link gehören zusammen." });
      return;
    }
    const neu: Record<string, any> = {
      language: sprache,
      tone: ton,
      internal_links: links,
      publish_time: zeit,
      image_style: bild,
      cta_blocks: label && url ? [{ label, url, text: ctaText.trim(), position: ctaPos }] : [],
      min_volume: ganz(minVolumen),
      min_impressions: ganz(minImpr),
    };
    if (agentur) {
      neu.publish_mode = modus;
      if (proMonat.trim()) neu.articles_per_month = ganz(proMonat);
    }
    void s.speichern(neu);
  };

  return (
    <Block titel="Inhalt">
      <Raster>
        <Feld label="Sprache" id="blog-e-sprache">
          <select
            id="blog-e-sprache"
            value={sprache}
            onChange={(e) => setSprache(e.target.value)}
            style={eingabe}
          >
            {SPRACHEN.map((id) => (
              <option key={id} value={id}>
                {SPRACH_LABEL[id] ?? id}
              </option>
            ))}
          </select>
        </Feld>
        <Feld label="Interne Links pro Artikel" id="blog-e-links">
          <select
            id="blog-e-links"
            value={links}
            onChange={(e) => setLinks(Number(e.target.value))}
            style={eingabe}
          >
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Feld>
        <Feld
          label="Uhrzeit für neue Artikel"
          hilfe={projekt.timezone ? `Zeitzone: ${projekt.timezone}` : undefined}
          id="blog-e-zeit"
        >
          <input
            id="blog-e-zeit"
            type="time"
            value={zeit}
            onChange={(e) => setZeit(e.target.value)}
            style={eingabe}
          />
        </Feld>
        <Feld
          label="Wohin fertige Artikel gehen"
          hilfe={agentur ? undefined : "Das stellt Ezy One für dich ein."}
          id="blog-e-modus"
        >
          <select
            id="blog-e-modus"
            value={modus}
            disabled={!agentur}
            onChange={(e) => setModus(e.target.value)}
            style={eingabe}
          >
            <option value="wp_draft">Als Entwurf nach WordPress</option>
            <option value="hub_only">Nur im Hub</option>
          </select>
        </Feld>
      </Raster>

      <Feld label="Tonalität">
        <Raster>
          {TONALITAETEN.map((t) => (
            <Kachel
              key={t.id}
              an={ton === t.id}
              onClick={() => setTon(t.id)}
              titel={t.label}
              text={`«${t.beispiel}»`}
            />
          ))}
        </Raster>
      </Feld>

      <Feld label="Bildstil">
        <Raster>
          {BILDSTILE.map((b) => (
            <Kachel
              key={b.id}
              an={bild === b.id}
              onClick={() => setBild(b.id)}
              titel={b.label}
              text={b.beschreibung}
            />
          ))}
        </Raster>
      </Feld>

      <div style={{ borderTop: `1px solid ${HAARLINIE}`, paddingTop: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>Aufruf am Artikel</div>
        <div style={{ fontSize: 13, color: P.muted, marginBottom: 12 }}>
          Ein Button, der in jedem Artikel erscheint, zum Beispiel «Jetzt spenden». Leer lassen,
          wenn keiner erscheinen soll.
        </div>
        <Raster>
          <Feld label="Button-Text" id="blog-e-cta-label">
            <input
              id="blog-e-cta-label"
              value={ctaLabel}
              onChange={(e) => setCtaLabel(e.target.value)}
              style={eingabe}
            />
          </Feld>
          <Feld label="Link" id="blog-e-cta-url">
            <input
              id="blog-e-cta-url"
              type="url"
              inputMode="url"
              placeholder="https://"
              value={ctaUrl}
              onChange={(e) => setCtaUrl(e.target.value)}
              style={eingabe}
            />
          </Feld>
          <Feld label="Satz davor" id="blog-e-cta-text">
            <input
              id="blog-e-cta-text"
              value={ctaText}
              onChange={(e) => setCtaText(e.target.value)}
              style={eingabe}
            />
          </Feld>
          <Feld label="Position" id="blog-e-cta-pos">
            <select
              id="blog-e-cta-pos"
              value={ctaPos}
              onChange={(e) => setCtaPos(e.target.value)}
              style={eingabe}
            >
              <option value="end">Am Ende</option>
              <option value="after_first_third">Nach dem ersten Drittel</option>
            </select>
          </Feld>
        </Raster>
      </div>

      <div style={{ borderTop: `1px solid ${HAARLINIE}`, paddingTop: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>Themenauswahl</div>
        <Raster>
          <Feld
            label="Mindest-Suchvolumen"
            hilfe="Themen darunter schlägt der Autopilot nicht vor."
            id="blog-e-volumen"
          >
            <input
              id="blog-e-volumen"
              type="number"
              min={0}
              inputMode="numeric"
              value={minVolumen}
              onChange={(e) => setMinVolumen(e.target.value)}
              style={eingabe}
            />
          </Feld>
          <Feld
            label="Mindest-Impressionen"
            hilfe="Ab wann eine bestehende Seite als Optimierung gilt."
            id="blog-e-impr"
          >
            <input
              id="blog-e-impr"
              type="number"
              min={0}
              inputMode="numeric"
              value={minImpr}
              onChange={(e) => setMinImpr(e.target.value)}
              style={eingabe}
            />
          </Feld>
          {agentur && (
            <Feld label="Artikel pro Monat" hilfe="Nur für Ezy One sichtbar." id="blog-e-monat">
              <input
                id="blog-e-monat"
                type="number"
                min={0}
                inputMode="numeric"
                value={proMonat}
                onChange={(e) => setProMonat(e.target.value)}
                style={eingabe}
              />
            </Feld>
          )}
        </Raster>
      </div>

      <Fusszeile meldung={s.meldung} busy={s.busy} onSpeichern={speichern} />
    </Block>
  );
}

function Wettbewerber({ projektId }: { projektId: string }) {
  const [domains, setDomains] = useState<string[] | null>(null);
  const [neu, setNeu] = useState("");
  const [busy, setBusy] = useState(false);
  const [meldung, setMeldung] = useState<Meldung>(null);

  useEffect(() => {
    let aktiv = true;
    setDomains(null);
    void api(`/api/blog/projects/${projektId}/competitors`).then((r) => {
      if (aktiv) setDomains(r.ok && r.json?.ok ? r.json.competitors.map((c: any) => c.domain) : []);
    });
    return () => {
      aktiv = false;
    };
  }, [projektId]);

  const fuegeHinzu = () => {
    const d = neu
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "");
    if (!d || !domains || domains.includes(d) || domains.length >= 30) return;
    setDomains([...domains, d]);
    setNeu("");
  };

  const speichern = async () => {
    if (!domains) return;
    setBusy(true);
    setMeldung(null);
    const r = await api(`/api/blog/projects/${projektId}/competitors`, "PUT", { domains });
    setBusy(false);
    if (r.ok && r.json?.ok) {
      setDomains(r.json.competitors.map((c: any) => c.domain));
      setMeldung({ ton: "ok", text: "Gespeichert." });
    } else setMeldung({ ton: "fehler", text: fehlerText(r, "Speichern fehlgeschlagen") });
  };

  return (
    <Block titel="Wettbewerber">
      <div style={{ fontSize: 14, color: P.muted, maxWidth: 720 }}>
        Websites, mit denen ihr in der Suche um dieselben Themen konkurriert. Der Autopilot
        vergleicht, worüber sie schreiben und ihr noch nicht.
      </div>
      {!domains ? (
        <div style={{ fontSize: 14, color: P.muted }}>Wird geladen…</div>
      ) : (
        <>
          {domains.length === 0 ? (
            <div style={{ fontSize: 14, color: P.muted }}>Noch keine Wettbewerber erfasst.</div>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {domains.map((d) => (
                <Chip key={d} onRemove={() => setDomains(domains.filter((x) => x !== d))}>
                  {d}
                </Chip>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              aria-label="Website eines Wettbewerbers"
              value={neu}
              placeholder="beispiel.ch"
              onChange={(e) => setNeu(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  fuegeHinzu();
                }
              }}
              style={{ ...eingabe, flex: "1 1 260px", width: "auto" }}
            />
            <Knopf art="sekundaer" onClick={fuegeHinzu} disabled={!neu.trim()}>
              Hinzufügen
            </Knopf>
          </div>
          <Fusszeile meldung={meldung} busy={busy} onSpeichern={() => void speichern()} />
        </>
      )}
    </Block>
  );
}

function Schreibregeln({ projektId, agentur }: { projektId: string; agentur: boolean }) {
  const [regeln, setRegeln] = useState<any[] | null>(null);
  const [neu, setNeu] = useState("");
  const [busy, setBusy] = useState(false);
  const [meldung, setMeldung] = useState<Meldung>(null);

  const laden = useCallback(async () => {
    const r = await api(`/api/blog/projects/${projektId}/rules`);
    setRegeln(r.ok && r.json?.ok ? r.json.rules : []);
  }, [projektId]);

  useEffect(() => {
    setRegeln(null);
    void laden();
  }, [laden]);

  const schalte = async (regel: any) => {
    setMeldung(null);
    const r = await api(`/api/blog/rules/${regel.id}`, "PATCH", { active: !regel.active });
    if (r.ok && r.json?.ok)
      setRegeln((alt) =>
        (alt ?? []).map((x) => (x.id === regel.id ? { ...x, ...r.json.rule } : x)),
      );
    else setMeldung({ ton: "fehler", text: fehlerText(r, "Speichern fehlgeschlagen") });
  };

  const fuegeHinzu = async () => {
    const text = neu.trim();
    if (text.length < 3) return;
    setBusy(true);
    setMeldung(null);
    const r = await api(
      `/api/blog/projects/${projektId}/rules`,
      "POST",
      agentur ? { rule: text, source: "agentur" } : { rule: text },
    );
    setBusy(false);
    if (r.ok && r.json?.ok) {
      setNeu("");
      await laden();
    } else setMeldung({ ton: "fehler", text: fehlerText(r, "Speichern fehlgeschlagen") });
  };

  return (
    <Block titel="Schreibregeln">
      <div style={{ fontSize: 14, color: P.muted, maxWidth: 720 }}>
        Was in jedem Artikel gelten soll, zum Beispiel Begriffe, die ihr nie verwendet. Der
        Autopilot hält sich bei jedem neuen Artikel daran.
      </div>
      {!regeln ? (
        <div style={{ fontSize: 14, color: P.muted }}>Wird geladen…</div>
      ) : regeln.length === 0 ? (
        <div style={{ fontSize: 14, color: P.muted }}>Noch keine Regeln.</div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {regeln.map((regel, i) => {
            const fest = regel.source === "standard";
            return (
              <li
                key={regel.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "8px 0",
                  borderTop: i === 0 ? "none" : `1px solid ${HAARLINIE}`,
                }}
              >
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    minHeight: 44,
                    flex: 1,
                    minWidth: 0,
                    cursor: fest ? "default" : "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!!regel.active}
                    disabled={fest}
                    onChange={() => void schalte(regel)}
                    style={{ width: 18, height: 18, accentColor: P.accent, flex: "none" }}
                  />
                  <span
                    style={{
                      fontSize: 14,
                      color: regel.active ? P.text : P.dim,
                      overflowWrap: "anywhere",
                    }}
                  >
                    {regel.rule}
                  </span>
                </label>
                <span style={{ fontSize: 12.5, color: P.dim, whiteSpace: "nowrap" }}>
                  {fest ? "Standard, immer aktiv" : (REGEL_QUELLE[regel.source] ?? "")}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <Feld label="Neue Regel" id="blog-e-regel">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            id="blog-e-regel"
            value={neu}
            maxLength={1000}
            placeholder="Zum Beispiel: Schreibe «Spende» statt «Donation»"
            onChange={(e) => setNeu(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void fuegeHinzu();
              }
            }}
            style={{ ...eingabe, flex: "1 1 320px", width: "auto" }}
          />
          <Knopf
            art="sekundaer"
            onClick={() => void fuegeHinzu()}
            disabled={busy || neu.trim().length < 3}
          >
            {busy ? "Wird gespeichert…" : "Regel hinzufügen"}
          </Knopf>
        </div>
      </Feld>
      {meldung && <Hinweis ton={meldung.ton}>{meldung.text}</Hinweis>}
    </Block>
  );
}

export default function BlogEinstellungen({
  projekt,
  agentur,
  onProjekt,
}: {
  projekt: any;
  agentur: boolean;
  onProjekt: (neu: any) => void;
}) {
  return (
    <>
      <Unternehmen projekt={projekt} onProjekt={onProjekt} />
      <Inhalt projekt={projekt} agentur={agentur} onProjekt={onProjekt} />
      <Wettbewerber projektId={projekt.id} />
      <Schreibregeln projektId={projekt.id} agentur={agentur} />
    </>
  );
}
