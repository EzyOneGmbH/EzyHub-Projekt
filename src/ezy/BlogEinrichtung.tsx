// Blog-Autopilot: Onboarding «Autopilot einrichten» (Bauanleitung Kap. 6A).
// Vollbild ohne Sidebar, 8 Schritte, schmale Spalte (max. 640 px). Jeder
// Schritt speichert beim «Weiter» serverseitig (blog_projects.onboarding_step);
// wer abbricht, landet beim nächsten Öffnen im letzten offenen Schritt.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { authedJson } from "@/lib/authed-fetch";
import {
  ANALYSE_PHASEN,
  ANALYSE_STUFEN,
  BILDSTILE,
  SPRACHEN,
  TONALITAETEN,
} from "@/ezy/data/blogAutopilot";
import { BlogSchrittVerbindungen } from "@/ezy/BlogSchrittVerbindungen";
import { BlogSchrittThemenplan, BlogSchrittStart } from "@/ezy/BlogSchrittThemen";
import {
  Chip,
  type Ctx,
  Favicon,
  Feld,
  Fuss,
  Hinweis,
  Karte,
  Knopf,
  type Kunde,
  P,
  Titel,
  api,
  blogHeim,
  domainVon,
  eingabe,
} from "@/ezy/BlogUi";

const SCHRITTE = 8;

// ── Hauptkomponente ────────────────────────────────────────────────────────

export default function BlogEinrichtung({
  step,
  clientParam,
}: {
  step: number;
  clientParam?: string;
}) {
  const navigate = useNavigate();
  const [kunden, setKunden] = useState<Kunde[] | null>(null);
  const [clientId, setClientId] = useState<string | null>(clientParam ?? null);
  const [project, setProject] = useState<any | null | undefined>(undefined);
  const [ergebnis, setErgebnis] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [ladeFehler, setLadeFehler] = useState<string | null>(null);
  const seit = useRef(Date.now());

  const gehe = useCallback(
    (n: number) => {
      setFehler(null);
      void navigate({
        to: "/ezyrank/blog/einrichtung/$step",
        params: { step: String(n) },
        search: clientId ? { client: clientId } : {},
      });
    },
    [navigate, clientId],
  );

  // Kunden laden und wählen
  useEffect(() => {
    void (async () => {
      const r = await api("/api/blog/clients");
      if (r.status === 401) {
        window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      const liste: Kunde[] = r.json?.kunden ?? [];
      setKunden(liste);
      if (!liste.length) return;
      if (clientParam && liste.some((k) => k.id === clientParam)) return;
      const offen =
        liste.find((k) => k.projekt?.status === "onboarding") ?? liste.find((k) => !k.projekt);
      setClientId((offen ?? liste[0]).id);
    })();
  }, [clientParam]);

  const kunde = useMemo(() => kunden?.find((k) => k.id === clientId) ?? null, [kunden, clientId]);

  const ladeProjekt = useCallback(async () => {
    if (!clientId) return;
    const r = await api(`/api/blog/projects?clientId=${clientId}`);
    if (!r.ok) {
      setLadeFehler(r.json?.error || "Laden fehlgeschlagen");
      return;
    }
    setProject(r.json?.project ?? null);
  }, [clientId]);

  useEffect(() => {
    setProject(undefined);
    void ladeProjekt();
  }, [ladeProjekt]);

  // Analyse-Ergebnis für die Vorbefüllung der Schritte 3–5
  useEffect(() => {
    const a = project?.analysis;
    if (!a?.id || a.status !== "done") return;
    void api(`/api/blog/analysis/${a.id}`).then((r) => setErgebnis(r.json?.run?.result ?? null));
  }, [project?.analysis?.id, project?.analysis?.status]);

  // Wiedereinstieg: nie weiter als der letzte offene Schritt
  useEffect(() => {
    if (project === undefined) return;
    const erlaubt = project ? project.onboarding_step : 1;
    if (project?.status === "active" && step < 8) return; // Einstellungen wieder öffnen erlaubt
    if (step > erlaubt) gehe(erlaubt);
  }, [project, step, gehe]);

  // Ereignis «Schritt angesehen»
  useEffect(() => {
    seit.current = Date.now();
    if (project?.id)
      void api(`/api/blog/projects/${project.id}/events`, "POST", {
        type: "onboarding.step_viewed",
        payload: { step },
      });
  }, [step, project?.id]);

  const weiter = useCallback(
    async (s: number, patch: Record<string, unknown> = {}) => {
      if (!project?.id) return false;
      setBusy(true);
      setFehler(null);
      const ziel = Math.min(SCHRITTE, s + 1);
      const r = await api(`/api/blog/projects/${project.id}`, "PATCH", {
        ...patch,
        onboarding_step: Math.max(project.onboarding_step || 1, ziel),
      });
      setBusy(false);
      if (!r.ok) {
        setFehler(r.json?.error || "Speichern fehlgeschlagen");
        return false;
      }
      setProject(r.json.project);
      void api(`/api/blog/projects/${project.id}/events`, "POST", {
        type: "onboarding.step_completed",
        payload: { step: s, dauer_ms: Date.now() - seit.current },
      });
      gehe(ziel);
      return true;
    },
    [project, gehe],
  );

  const ctx: Ctx | null =
    kunde && project !== undefined
      ? {
          kunde,
          project,
          ergebnis,
          setProject,
          gehe,
          weiter,
          busy,
          fehler,
          setFehler,
          neuLaden: ladeProjekt,
        }
      : null;

  return (
    <div style={{ minHeight: "100vh", background: P.bg, color: P.text }}>
      <Kopf step={step} />
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "36px 16px 80px" }}>
        {kunden && kunden.length === 0 ? (
          <Leer />
        ) : ladeFehler ? (
          <Hinweis ton="fehler">{ladeFehler}</Hinweis>
        ) : !ctx ? (
          <div style={{ color: P.dim, fontSize: 14 }}>Lädt…</div>
        ) : (
          <>
            {kunden && kunden.length > 1 && step === 1 && (
              <KundenWahl kunden={kunden} wert={clientId!} onWahl={setClientId} />
            )}
            {step === 1 && <Schritt1 c={ctx} />}
            {step === 2 && <Schritt2 c={ctx} />}
            {step === 3 && <Schritt3 c={ctx} />}
            {step === 4 && <Schritt4 c={ctx} />}
            {step === 5 && <Schritt5 c={ctx} />}
            {step === 6 && <BlogSchrittVerbindungen c={ctx} />}
            {step === 7 && <BlogSchrittThemenplan c={ctx} />}
            {step === 8 && <BlogSchrittStart c={ctx} />}
          </>
        )}
      </main>
    </div>
  );
}

function Kopf({ step }: { step: number }) {
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        background: "rgba(252,252,252,.9)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <a
          href={blogHeim()}
          style={{ fontWeight: 800, color: P.text, textDecoration: "none", fontSize: 15 }}
        >
          Ezy One <span style={{ color: P.dim, fontWeight: 600 }}>· Blog-Autopilot</span>
        </a>
        <span style={{ fontSize: 13, color: P.muted, fontVariantNumeric: "tabular-nums" }}>
          Schritt {step} von {SCHRITTE}
        </span>
        <a
          href="mailto:support@ezyone.ch?subject=Hilfe%20Blog-Autopilot"
          style={{
            fontSize: 13,
            color: P.accent,
            fontWeight: 700,
            textDecoration: "none",
            minHeight: 44,
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          Hilfe
        </a>
      </div>
      <div style={{ height: 3, background: "rgba(43,0,51,.06)" }}>
        <div
          style={{
            height: 3,
            width: `${(step / SCHRITTE) * 100}%`,
            background: P.grad,
            transition: "width .4s ease",
          }}
        />
      </div>
    </header>
  );
}

function Leer() {
  return (
    <Karte>
      <h2 style={{ margin: 0, fontSize: 20 }}>Kein Kunde freigeschaltet</h2>
      <p style={{ margin: 0, color: P.muted }}>
        Der Blog-Autopilot ist für dein Konto noch nicht eingerichtet. Ezy One schaltet ihn mit der
        Einladung frei. Melde dich bei <a href="mailto:support@ezyone.ch">support@ezyone.ch</a>.
      </p>
    </Karte>
  );
}

function KundenWahl({
  kunden,
  wert,
  onWahl,
}: {
  kunden: Kunde[];
  wert: string;
  onWahl: (id: string) => void;
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <Feld label="Für welchen Kunden?" id="kunde">
        <select id="kunde" value={wert} onChange={(e) => onWahl(e.target.value)} style={eingabe}>
          {kunden.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
              {k.projekt?.status === "active"
                ? " (aktiv)"
                : k.projekt
                  ? ` (Schritt ${k.projekt.onboarding_step})`
                  : ""}
            </option>
          ))}
        </select>
      </Feld>
    </div>
  );
}

// ── Schritt 1 · Website ────────────────────────────────────────────────────

function Schritt1({ c }: { c: Ctx }) {
  const [url, setUrl] = useState<string>(c.project?.domain || c.kunde.domain || "");
  const [busy, setBusy] = useState(false);
  const domain = domainVon(url);

  const los = async () => {
    if (!domain) return;
    setBusy(true);
    c.setFehler(null);
    let project = c.project;
    if (!project) {
      const r = await api("/api/blog/projects", "POST", { clientId: c.kunde.id, domain });
      if (!r.ok) {
        setBusy(false);
        c.setFehler(r.json?.error || "Projekt konnte nicht angelegt werden");
        return;
      }
      project = r.json.project;
    }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Zurich";
    const p = await api(`/api/blog/projects/${project.id}`, "PATCH", {
      ...(project.domain !== domain ? { domain } : {}),
      ...(project.status === "onboarding" ? { timezone: tz } : {}),
    });
    if (!p.ok) {
      setBusy(false);
      c.setFehler(p.json?.error || "Speichern fehlgeschlagen");
      return;
    }
    c.setProject(p.json.project);
    const a = await api(`/api/blog/projects/${project.id}/analysis`, "POST");
    if (!a.ok) {
      setBusy(false);
      c.setFehler(a.json?.error || "Analyse konnte nicht gestartet werden");
      return;
    }
    setBusy(false);
    await c.weiter(1);
  };

  return (
    <>
      <Titel a="Starte mit deiner Website." b="Den Rest füllen wir vor." />
      <Karte>
        <Feld
          label="Website"
          id="url"
          hilfe={
            url && !domain ? "Bitte eine gültige Adresse eingeben, z. B. beispiel.ch" : undefined
          }
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Favicon domain={domain} size={22} />
            <input
              id="url"
              inputMode="url"
              autoComplete="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void los()}
              placeholder="https://beispiel.ch"
              style={eingabe}
            />
          </div>
        </Feld>
        {domain && <div style={{ fontSize: 13, color: P.muted }}>Wir lesen https://{domain}</div>}
        <Hinweis>
          Nichts geht ohne dich live. Jeder Artikel landet zuerst als Entwurf in WordPress.
        </Hinweis>
        {c.fehler && <Hinweis ton="fehler">{c.fehler}</Hinweis>}
      </Karte>
      <Fuss
        weiter={() => void los()}
        weiterText="Website analysieren"
        weiterAus={!domain}
        busy={busy || c.busy}
      />
    </>
  );
}

// ── Schritt 2 · Analyse ────────────────────────────────────────────────────

const uhr = (iso: string) =>
  new Date(iso).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });

function Schritt2({ c }: { c: Ctx }) {
  const [run, setRun] = useState<any | null>(null);
  const [runId, setRunId] = useState<string | null>(c.project?.analysis?.id ?? null);
  const [neuBusy, setNeuBusy] = useState(false);
  const weiterGemacht = useRef(false);

  const starte = useCallback(async () => {
    setNeuBusy(true);
    c.setFehler(null);
    const a = await api(`/api/blog/projects/${c.project.id}/analysis`, "POST");
    setNeuBusy(false);
    if (!a.ok) {
      c.setFehler(a.json?.error || "Analyse konnte nicht gestartet werden");
      return;
    }
    setRun(null);
    setRunId(a.json.run.id);
  }, [c]);

  useEffect(() => {
    if (!runId && c.project?.id) void starte();
  }, [runId, c.project?.id, starte]);

  useEffect(() => {
    if (!runId) return;
    let aktiv = true;
    const hole = async () => {
      const r = await api(`/api/blog/analysis/${runId}`);
      if (!aktiv) return;
      if (r.ok) setRun(r.json.run);
    };
    void hole();
    const t = setInterval(() => void hole(), 2000);
    return () => {
      aktiv = false;
      clearInterval(t);
    };
  }, [runId]);

  useEffect(() => {
    if (run?.status === "done" && !weiterGemacht.current) {
      weiterGemacht.current = true;
      void c.neuLaden().then(() => c.weiter(2));
    }
  }, [run?.status, c]);

  const fertigeKeys = new Set<string>((run?.events ?? []).map((e: any) => e.key));
  const laufend = new Set<string>(
    run?.status === "running" ? (ANALYSE_PHASEN[run.stage] ?? []) : [],
  );

  return (
    <>
      <Titel a="Wir lesen deine Website." b="Das dauert rund 4 Minuten." />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 12px",
            borderRadius: 99,
            background: "#fff",
            boxShadow: P.shadow,
            fontSize: 13.5,
          }}
        >
          <Favicon domain={c.project?.domain} /> {c.project?.domain}
        </span>
      </div>
      <Karte>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>Agent-Aktivität</h2>
          <span style={{ fontSize: 13, color: P.muted, fontVariantNumeric: "tabular-nums" }}>
            {run?.percent ?? 0}%
          </span>
        </div>
        <div style={{ height: 6, borderRadius: 99, background: "rgba(43,0,51,.06)" }} aria-hidden>
          <div
            style={{
              height: 6,
              borderRadius: 99,
              width: `${run?.percent ?? 2}%`,
              background: P.grad,
              transition: "width .6s ease",
            }}
          />
        </div>
        <ol
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
          aria-live="polite"
        >
          {ANALYSE_STUFEN.map((s) => {
            const ev = (run?.events ?? []).find((e: any) => e.key === s.key);
            const status = fertigeKeys.has(s.key)
              ? "fertig"
              : laufend.has(s.key)
                ? "laeuft"
                : "wartet";
            return (
              <li
                key={s.key}
                style={{
                  display: "grid",
                  gridTemplateColumns: "22px 1fr auto",
                  gap: 10,
                  alignItems: "start",
                }}
              >
                <span
                  aria-label={
                    status === "fertig" ? "fertig" : status === "laeuft" ? "läuft" : "wartet"
                  }
                  style={{
                    width: 18,
                    height: 18,
                    marginTop: 2,
                    borderRadius: 99,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    color: "#fff",
                    background:
                      status === "fertig"
                        ? P.green
                        : status === "laeuft"
                          ? P.accent
                          : "rgba(43,0,51,.12)",
                    animation:
                      status === "laeuft" ? "blogpuls 1.2s ease-in-out infinite" : undefined,
                  }}
                >
                  {status === "fertig" ? "✓" : ""}
                </span>
                <span>
                  <span
                    style={{
                      fontSize: 14.5,
                      fontWeight: status === "wartet" ? 500 : 700,
                      color: status === "wartet" ? P.dim : P.text,
                    }}
                  >
                    {s.label}
                  </span>
                  {ev?.detail && (
                    <span style={{ display: "block", fontSize: 12.5, color: P.muted }}>
                      {ev.detail}
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 12, color: P.dim, fontVariantNumeric: "tabular-nums" }}>
                  {ev?.at ? uhr(ev.at) : status === "laeuft" ? "läuft" : ""}
                </span>
              </li>
            );
          })}
        </ol>
        {run?.status === "queued" && (
          <div style={{ fontSize: 13, color: P.muted }}>Startet in Kürze…</div>
        )}
        {run?.status === "running" && run?.attempts > 0 && (
          <div style={{ fontSize: 13, color: P.orange }}>
            Ein Schritt wird wiederholt ({run.error || "kurzer Fehler"}).
          </div>
        )}
        <Hinweis>
          Nichts geht ohne dich live. Du kannst das Fenster schliessen: Wenn du zurückkommst, geht
          es hier weiter.
        </Hinweis>
      </Karte>
      {run?.status === "failed" && (
        <Karte style={{ marginTop: 16 }}>
          <Hinweis ton="fehler">
            Die Analyse ist fehlgeschlagen: {run.error || "unbekannter Grund"}
          </Hinweis>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Knopf onClick={() => void starte()} disabled={neuBusy}>
              Erneut versuchen
            </Knopf>
            <Knopf art="sekundaer" onClick={() => void c.weiter(2)}>
              Ohne Analyse weiter
            </Knopf>
          </div>
        </Karte>
      )}
      {c.fehler && (
        <div style={{ marginTop: 12 }}>
          <Hinweis ton="fehler">{c.fehler}</Hinweis>
        </div>
      )}
      <style>{`@keyframes blogpuls{0%,100%{opacity:1}50%{opacity:.45}} @media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}`}</style>
    </>
  );
}

// Vorbefüllung: solange ein Schritt nicht abgeschlossen ist, gewinnt die Analyse.
function vorbelegt<T>(
  c: Ctx,
  schritt: number,
  projektWert: T,
  analyseWert: T | undefined,
  leer: (v: T) => boolean,
): T {
  const offen = (c.project?.onboarding_step ?? 1) <= schritt;
  if (offen && analyseWert !== undefined && analyseWert !== null && !leer(analyseWert))
    return analyseWert;
  return projektWert;
}
const leerText = (v: any) => !String(v ?? "").trim();
const leerListe = (v: any) => !Array.isArray(v) || v.length === 0;

// ── Schritt 3 · Angaben prüfen ─────────────────────────────────────────────

const MAERKTE = [
  ["CH", "Schweiz"],
  ["DE", "Deutschland"],
  ["AT", "Österreich"],
  ["LI", "Liechtenstein"],
  ["FR", "Frankreich"],
  ["IT", "Italien"],
  ["GB", "Grossbritannien"],
  ["US", "USA"],
] as const;
const SPRACH_LABEL: Record<string, string> = {
  "de-CH": "Deutsch (Schweiz)",
  "de-DE": "Deutsch (Deutschland)",
  "fr-CH": "Französisch (Schweiz)",
  "it-CH": "Italienisch (Schweiz)",
  en: "Englisch",
};

function Schritt3({ c }: { c: Ctx }) {
  const e = c.ergebnis ?? {};
  const [name, setName] = useState(vorbelegt(c, 3, c.project.name ?? "", e.name, leerText));
  const [desc, setDesc] = useState(
    vorbelegt(c, 3, c.project.description ?? "", e.description, leerText),
  );
  const [market, setMarket] = useState(vorbelegt(c, 3, c.project.market, e.market, leerText));
  const [language, setLanguage] = useState(
    vorbelegt(c, 3, c.project.language, e.language, leerText),
  );
  const [lokal, setLokal] = useState<boolean>(
    vorbelegt(c, 3, !!c.project.local_business, e.local_business, () => false),
  );
  const ok = name.trim() && desc.trim();
  return (
    <>
      <Titel a="Deine Angaben." b="Prüfe, was wir gefunden haben." />
      <Karte>
        <Feld label="Name" id="name">
          <input
            id="name"
            value={name}
            onChange={(x) => setName(x.target.value)}
            maxLength={200}
            style={eingabe}
          />
        </Feld>
        <Feld label="Was ihr macht" id="desc" hilfe={`${desc.length} / 4'000 Zeichen`}>
          <textarea
            id="desc"
            value={desc}
            onChange={(x) => setDesc(x.target.value.slice(0, 4000))}
            rows={7}
            style={{ ...eingabe, resize: "vertical", lineHeight: 1.5 }}
          />
        </Feld>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 14,
          }}
        >
          <Feld label="Markt" id="markt">
            <select
              id="markt"
              value={market}
              onChange={(x) => setMarket(x.target.value)}
              style={eingabe}
            >
              {!MAERKTE.some(([k]) => k === market) && <option value={market}>{market}</option>}
              {MAERKTE.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Feld>
          <Feld label="Sprache" id="sprache">
            <select
              id="sprache"
              value={language}
              onChange={(x) => setLanguage(x.target.value)}
              style={eingabe}
            >
              {SPRACHEN.map((s) => (
                <option key={s} value={s}>
                  {SPRACH_LABEL[s]}
                </option>
              ))}
            </select>
          </Feld>
        </div>
        <Schalter
          label="Lokales Unternehmen"
          hilfe="Kundschaft vor allem aus einer Region oder einem Ort"
          wert={lokal}
          onWert={setLokal}
        />
        {c.fehler && <Hinweis ton="fehler">{c.fehler}</Hinweis>}
      </Karte>
      <Fuss
        zurueck={() => c.gehe(1)}
        weiter={() =>
          void c.weiter(3, {
            name: name.trim(),
            description: desc.trim(),
            market,
            language,
            local_business: lokal,
          })
        }
        weiterAus={!ok}
        busy={c.busy}
      />
    </>
  );
}

export function Schalter({
  label,
  hilfe,
  wert,
  onWert,
}: {
  label: string;
  hilfe?: string;
  wert: boolean;
  onWert: (v: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 14,
        cursor: "pointer",
        minHeight: 44,
      }}
    >
      <span>
        <span style={{ fontSize: 14, fontWeight: 700 }}>{label}</span>
        {hilfe && <span style={{ display: "block", fontSize: 12.5, color: P.dim }}>{hilfe}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={wert}
        onChange={(x) => onWert(x.target.checked)}
        style={{ width: 22, height: 22, accentColor: P.accent }}
      />
    </label>
  );
}

// ── Schritt 4 · Zielgruppe und Mitbewerber ─────────────────────────────────

function Schritt4({ c }: { c: Ctx }) {
  const e = c.ergebnis ?? {};
  const start = vorbelegt<string[]>(c, 4, c.project.audiences ?? [], e.audiences, leerListe);
  const [audiences, setAudiences] = useState<string[]>(start.length ? start : [""]);
  const [comps, setComps] = useState<any[] | null>(null);
  const [behalten, setBehalten] = useState<string[]>([]);
  const [neuComp, setNeuComp] = useState("");
  const [ausschluss, setAusschluss] = useState<string[]>(c.project.excluded_domains ?? []);
  const [neuAus, setNeuAus] = useState("");
  const gruende = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of [...(e.competitors?.bestaetigt ?? []), ...(e.competitors?.unbestaetigt ?? [])])
      m.set(x.domain, x.grund);
    return m;
  }, [e]);

  useEffect(() => {
    void api(`/api/blog/projects/${c.project.id}/competitors`).then((r) => {
      const l = r.json?.competitors ?? [];
      setComps(l);
      setBehalten(l.filter((x: any) => x.validated).map((x: any) => x.domain));
    });
  }, [c.project.id]);

  const offen = (comps ?? []).filter((x) => !x.validated && !behalten.includes(x.domain));
  const addComp = () => {
    const d = domainVon(neuComp);
    if (!d) return c.setFehler("Ungültige Domain");
    c.setFehler(null);
    if (!behalten.includes(d)) setBehalten([...behalten, d]);
    setNeuComp("");
  };
  const addAus = () => {
    const d = domainVon(neuAus);
    if (!d) return c.setFehler("Ungültige Domain");
    c.setFehler(null);
    if (!ausschluss.includes(d)) setAusschluss([...ausschluss, d]);
    setNeuAus("");
  };
  const zg = audiences.map((a) => a.trim()).filter(Boolean);

  const speichern = async () => {
    const r = await api(`/api/blog/projects/${c.project.id}/competitors`, "PUT", {
      domains: behalten,
    });
    if (!r.ok) return c.setFehler(r.json?.error || "Mitbewerber konnten nicht gespeichert werden");
    await c.weiter(4, { audiences: zg, excluded_domains: ausschluss });
  };

  return (
    <>
      <Titel a="Zielgruppe und Mitbewerber." b="Für wen wir schreiben." />
      <Karte>
        <Feld label="Für wen wir schreiben" hilfe="1 bis 4 Zeilen, je eine Zielgruppe">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {audiences.map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 8 }}>
                <input
                  aria-label={`Zielgruppe ${i + 1}`}
                  value={a}
                  maxLength={300}
                  onChange={(x) =>
                    setAudiences(audiences.map((v, j) => (j === i ? x.target.value : v)))
                  }
                  style={eingabe}
                />
                {audiences.length > 1 && (
                  <Knopf
                    art="text"
                    onClick={() => setAudiences(audiences.filter((_, j) => j !== i))}
                  >
                    Entfernen
                  </Knopf>
                )}
              </div>
            ))}
            {audiences.length < 4 && (
              <div>
                <Knopf art="sekundaer" onClick={() => setAudiences([...audiences, ""])}>
                  + Zielgruppe
                </Knopf>
              </div>
            )}
          </div>
        </Feld>
      </Karte>
      <Karte style={{ marginTop: 16 }}>
        <Feld
          label="Mitbewerber"
          hilfe="Mitbewerber werden nie verlinkt. Wir nutzen sie nur, um Lücken zu finden."
        >
          {comps === null ? (
            <span style={{ color: P.dim, fontSize: 13 }}>Lädt…</span>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {behalten.length === 0 && (
                <span style={{ color: P.dim, fontSize: 13 }}>Noch keine Mitbewerber.</span>
              )}
              {behalten.map((d) => (
                <Chip
                  key={d}
                  title={gruende.get(d)}
                  onRemove={() => setBehalten(behalten.filter((x) => x !== d))}
                >
                  <Favicon domain={d} size={16} /> {d}
                </Chip>
              ))}
            </div>
          )}
        </Feld>
        {offen.length > 0 && (
          <Feld
            label="Nicht bestätigt"
            hilfe="Vorschläge, bei denen wir unsicher sind. Übernehmen oder ignorieren."
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {offen.map((x) => (
                <span
                  key={x.domain}
                  style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  <Chip ton="offen" title={gruende.get(x.domain)}>
                    <Favicon domain={x.domain} size={16} /> {x.domain}
                  </Chip>
                  <Knopf art="text" onClick={() => setBehalten([...behalten, x.domain])}>
                    Übernehmen
                  </Knopf>
                </span>
              ))}
            </div>
          </Feld>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            aria-label="Mitbewerber hinzufügen"
            placeholder="mitbewerber.ch"
            value={neuComp}
            onChange={(x) => setNeuComp(x.target.value)}
            onKeyDown={(x) => x.key === "Enter" && addComp()}
            style={eingabe}
          />
          <Knopf art="sekundaer" onClick={addComp}>
            Hinzufügen
          </Knopf>
        </div>
      </Karte>
      <Karte style={{ marginTop: 16 }}>
        <Feld
          label="Ausschlussliste"
          hilfe="Diese Domains werden nie verlinkt. Mitbewerber sind automatisch ausgeschlossen."
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {ausschluss.length === 0 && (
              <span style={{ color: P.dim, fontSize: 13 }}>Keine weiteren Domains.</span>
            )}
            {ausschluss.map((d) => (
              <Chip key={d} onRemove={() => setAusschluss(ausschluss.filter((x) => x !== d))}>
                {d}
              </Chip>
            ))}
          </div>
        </Feld>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            aria-label="Domain ausschliessen"
            placeholder="domain.ch"
            value={neuAus}
            onChange={(x) => setNeuAus(x.target.value)}
            onKeyDown={(x) => x.key === "Enter" && addAus()}
            style={eingabe}
          />
          <Knopf art="sekundaer" onClick={addAus}>
            Hinzufügen
          </Knopf>
        </div>
        {c.fehler && <Hinweis ton="fehler">{c.fehler}</Hinweis>}
      </Karte>
      <Fuss
        zurueck={() => c.gehe(3)}
        weiter={() => void speichern()}
        weiterAus={zg.length === 0}
        busy={c.busy}
      />
    </>
  );
}

// ── Schritt 5 · Stil und Call to Action ────────────────────────────────────

function Schritt5({ c }: { c: Ctx }) {
  const e = c.ergebnis ?? {};
  const [tone, setTone] = useState<string>(vorbelegt(c, 5, c.project.tone, e.tone, leerText));
  const ctaStart =
    (c.project.cta_blocks ?? [])[0] ??
    ((c.project.onboarding_step ?? 1) <= 5 && e.cta ? e.cta : { label: "", url: "", text: "" });
  const [cta, setCta] = useState<{ label: string; url: string; text: string }>({
    label: ctaStart.label ?? "",
    url: ctaStart.url ?? "",
    text: ctaStart.text ?? "",
  });
  const [links, setLinks] = useState<number>(c.project.internal_links ?? 3);
  const [bild, setBild] = useState<string>(
    vorbelegt(c, 5, c.project.image_style ?? "fotografisch", e.image_style, leerText),
  );
  const [regeln, setRegeln] = useState<any[] | null>(null);
  const [eigene, setEigene] = useState("");

  const ladeRegeln = useCallback(async () => {
    const r = await api(`/api/blog/projects/${c.project.id}/rules`);
    setRegeln(r.json?.rules ?? []);
  }, [c.project.id]);
  useEffect(() => void ladeRegeln(), [ladeRegeln]);

  const regelDa = (t: string) =>
    (regeln ?? []).some((r) => r.rule.trim().toLowerCase() === t.trim().toLowerCase() && r.active);
  const neueRegel = async (rule: string) => {
    if (!rule.trim()) return;
    const r = await api(`/api/blog/projects/${c.project.id}/rules`, "POST", { rule: rule.trim() });
    if (!r.ok) return c.setFehler(r.json?.error || "Regel konnte nicht gespeichert werden");
    c.setFehler(null);
    await ladeRegeln();
  };
  const schalte = async (id: string, active: boolean) => {
    const r = await api(`/api/blog/rules/${id}`, "PATCH", { active });
    if (!r.ok) return c.setFehler(r.json?.error || "Ändern fehlgeschlagen");
    await ladeRegeln();
  };

  const ctaOk =
    !cta.label.trim() && !cta.url.trim()
      ? true
      : !!cta.label.trim() && /^https:\/\/[^\s]+\.[^\s]+/i.test(cta.url.trim());
  const speichern = () =>
    void c.weiter(5, {
      tone,
      internal_links: links,
      image_style: bild,
      cta_blocks:
        cta.label.trim() && cta.url.trim()
          ? [
              {
                label: cta.label.trim(),
                url: cta.url.trim(),
                text: cta.text.trim(),
                position: "end",
              },
            ]
          : [],
    });

  return (
    <>
      <Titel a="Stil und Call to Action." b="So klingen deine Artikel." />
      <Karte>
        <h2 style={{ margin: 0, fontSize: 16 }}>Tonalität</h2>
        {e.tone_reason && (c.project.onboarding_step ?? 1) <= 5 && (
          <div style={{ fontSize: 13, color: P.muted }}>
            Vorschlag aus der Analyse: {e.tone_reason}
          </div>
        )}
        <div role="radiogroup" aria-label="Tonalität" style={{ display: "grid", gap: 10 }}>
          {TONALITAETEN.map((t) => (
            <AuswahlKarte
              key={t.id}
              aktiv={tone === t.id}
              onClick={() => setTone(t.id)}
              titel={t.label}
              text={`«${t.beispiel}»`}
            />
          ))}
        </div>
      </Karte>

      <Karte style={{ marginTop: 16 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Call to Action</h2>
        {(e.cta_candidates ?? []).length > 0 && (
          <Feld label="Aus deiner Website übernehmen" id="ctawahl">
            <select
              id="ctawahl"
              value=""
              onChange={(x) => {
                const k = (e.cta_candidates ?? []).find((l: any) => l.url === x.target.value);
                if (k) setCta({ ...cta, url: k.url, label: cta.label || k.text || "" });
              }}
              style={eingabe}
            >
              <option value="">Link wählen…</option>
              {(e.cta_candidates ?? []).map((l: any) => (
                <option key={l.url} value={l.url}>
                  {(l.text || "Link") + " · " + l.url}
                </option>
              ))}
            </select>
          </Feld>
        )}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 14,
          }}
        >
          <Feld label="Button-Text" id="ctal">
            <input
              id="ctal"
              value={cta.label}
              maxLength={80}
              onChange={(x) => setCta({ ...cta, label: x.target.value })}
              style={eingabe}
            />
          </Feld>
          <Feld label="Link (https)" id="ctau">
            <input
              id="ctau"
              inputMode="url"
              value={cta.url}
              onChange={(x) => setCta({ ...cta, url: x.target.value })}
              style={eingabe}
            />
          </Feld>
        </div>
        <Feld label="Kurzer Text" id="ctat">
          <input
            id="ctat"
            value={cta.text}
            maxLength={300}
            onChange={(x) => setCta({ ...cta, text: x.target.value })}
            style={eingabe}
          />
        </Feld>
        {!ctaOk && <Hinweis ton="fehler">Button-Text und ein https-Link gehören zusammen.</Hinweis>}
        {cta.label.trim() && (
          <div
            aria-label="Vorschau Call to Action"
            style={{
              border: `1px solid ${P.border}`,
              borderRadius: 14,
              padding: 18,
              background: P.accentDim,
            }}
          >
            <div
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: ".08em",
                color: P.dim,
                marginBottom: 6,
              }}
            >
              Vorschau am Artikelende
            </div>
            {cta.text.trim() && <p style={{ margin: "0 0 12px", fontSize: 15 }}>{cta.text}</p>}
            <span
              style={{
                display: "inline-block",
                padding: "10px 20px",
                borderRadius: 99,
                background: P.grad,
                color: "#fff",
                fontWeight: 700,
              }}
            >
              {cta.label}
            </span>
          </div>
        )}
      </Karte>

      <Karte style={{ marginTop: 16 }}>
        <Feld
          label="Interne Links pro Artikel"
          id="links"
          hilfe="Verlinkungen auf deine eigenen Seiten"
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <input
              id="links"
              type="range"
              min={0}
              max={5}
              value={links}
              onChange={(x) => setLinks(Number(x.target.value))}
              style={{ flex: 1, accentColor: P.accent }}
            />
            <span
              style={{
                fontWeight: 700,
                width: 20,
                textAlign: "right",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {links}
            </span>
          </div>
        </Feld>
      </Karte>

      <Karte style={{ marginTop: 16 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Schreibregeln</h2>
        {regeln === null ? (
          <span style={{ color: P.dim, fontSize: 13 }}>Lädt…</span>
        ) : (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {regeln.map((r) => (
              <li
                key={r.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  alignItems: "center",
                  fontSize: 14,
                  opacity: r.active ? 1 : 0.55,
                }}
              >
                <span>{r.rule}</span>
                {r.source === "standard" ? (
                  <span style={{ fontSize: 12, color: P.dim, whiteSpace: "nowrap" }}>
                    immer aktiv
                  </span>
                ) : (
                  <Knopf art="text" onClick={() => void schalte(r.id, !r.active)}>
                    {r.active ? "Ausschalten" : "Einschalten"}
                  </Knopf>
                )}
              </li>
            ))}
          </ul>
        )}
        {(e.rule_suggestions ?? []).filter((s: string) => !regelDa(s)).length > 0 && (
          <Feld label="Vorschläge aus der Analyse" hilfe="Per Klick übernehmen">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {(e.rule_suggestions ?? [])
                .filter((s: string) => !regelDa(s))
                .map((s: string) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void neueRegel(s)}
                    style={{
                      border: `1px dashed ${P.accent}`,
                      background: "#fff",
                      color: P.text,
                      borderRadius: 99,
                      padding: "8px 14px",
                      fontSize: 13.5,
                      cursor: "pointer",
                      minHeight: 40,
                      fontFamily: "inherit",
                      textAlign: "left",
                    }}
                  >
                    + {s}
                  </button>
                ))}
            </div>
          </Feld>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            aria-label="Eigene Schreibregel"
            placeholder="Eigene Regel, z. B. «Immer du-Form»"
            value={eigene}
            maxLength={1000}
            onChange={(x) => setEigene(x.target.value)}
            onKeyDown={(x) => x.key === "Enter" && void neueRegel(eigene).then(() => setEigene(""))}
            style={eingabe}
          />
          <Knopf art="sekundaer" onClick={() => void neueRegel(eigene).then(() => setEigene(""))}>
            Hinzufügen
          </Knopf>
        </div>
      </Karte>

      <Karte style={{ marginTop: 16 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Bildstil</h2>
        <div
          role="radiogroup"
          aria-label="Bildstil"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 10,
          }}
        >
          {BILDSTILE.map((b) => (
            <AuswahlKarte
              key={b.id}
              aktiv={bild === b.id}
              onClick={() => setBild(b.id)}
              titel={b.label}
              text={b.beschreibung}
              vorschau={b.id}
            />
          ))}
        </div>
        {c.fehler && <Hinweis ton="fehler">{c.fehler}</Hinweis>}
      </Karte>
      <Fuss zurueck={() => c.gehe(4)} weiter={speichern} weiterAus={!ctaOk} busy={c.busy} />
    </>
  );
}

const VORSCHAU: Record<string, string> = {
  fotografisch: "linear-gradient(135deg,#d9c7a7,#7c8a6a 60%,#3d4a3a)",
  dokumentarisch: "linear-gradient(135deg,#bfb6ad,#6d625a 55%,#2f2925)",
  illustration: "linear-gradient(135deg,#ffd6a5,#fdffb6 40%,#caffbf 70%,#9bf6ff)",
  minimalistisch: "linear-gradient(135deg,#f4f2f5,#e7e2ea)",
  infografik: "repeating-linear-gradient(90deg,#77008C 0 18%,#B9009C 18% 30%,#f2e6f4 30% 100%)",
};

export function AuswahlKarte({
  aktiv,
  onClick,
  titel,
  text,
  vorschau,
}: {
  aktiv: boolean;
  onClick: () => void;
  titel: string;
  text: string;
  vorschau?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={aktiv}
      onClick={onClick}
      style={{
        textAlign: "left",
        border: `1.5px solid ${aktiv ? P.accent : P.border}`,
        background: aktiv ? P.accentDim : "#fff",
        borderRadius: 14,
        padding: 14,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        fontFamily: "inherit",
        minHeight: 44,
      }}
    >
      {vorschau && (
        <span
          aria-hidden
          style={{ height: 54, borderRadius: 10, background: VORSCHAU[vorschau] ?? P.accentDim }}
        />
      )}
      <span style={{ fontWeight: 700, fontSize: 14.5, color: P.text }}>{titel}</span>
      <span style={{ fontSize: 13, color: P.muted }}>{text}</span>
    </button>
  );
}
