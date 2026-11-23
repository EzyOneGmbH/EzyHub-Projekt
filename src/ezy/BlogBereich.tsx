import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import BlogAutopilotKarte from "@/ezy/BlogAutopilotKarte";
import BlogTour, { TOUR_SCHRITTE, merkeTourGesehen, tourGesehen } from "@/ezy/BlogTour";
import {
  Knopf,
  P,
  Segmente,
  api,
  eintraegeAus,
  merkeBlogHerkunft,
  verweisStil,
  type BlogHerkunft,
} from "@/ezy/BlogUi";
import { blogEingerichtet } from "@/ezy/data/blogAutopilot";

// Blog-Tab in EzyRank und Bereich «Blog» in EzyAI: Kopfzeile und Unter-Tabs. Solange der Blog noch
// nicht eingerichtet ist, steht hier nur die Einrichtungskarte. Eingerichtet heisst «active» oder
// «paused» (Automatik aus): der Bereich ist sichtbar, geschrieben wird dann nur von Hand.

const BlogDashboard = lazy(() => import("@/ezy/BlogDashboard"));
const BlogKalender = lazy(() => import("@/ezy/BlogKalender"));
const BlogOptimierung = lazy(() => import("@/ezy/BlogOptimierung"));
const BlogEinstellungen = lazy(() => import("@/ezy/BlogEinstellungen"));
const BlogIntegrationen = lazy(() => import("@/ezy/BlogIntegrationen"));

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "kalender", label: "Kalender" },
  { id: "optimierung", label: "Optimierung" },
  { id: "einstellungen", label: "Einstellungen" },
  { id: "integrationen", label: "Integrationen" },
] as const;
export type BlogTab = (typeof TABS)[number]["id"];

const MERKER = "ezyBlogTab.v1";

function gemerkterTab(): BlogTab {
  try {
    const v = window.localStorage.getItem(MERKER);
    if (TABS.some((t) => t.id === v)) return v as BlogTab;
  } catch {
    // ohne Speicher: Standard
  }
  return "dashboard";
}

export default function BlogBereich({
  client,
  refreshRadar,
  herkunft = "ezyrank",
}: {
  client: { id: string } | null;
  refreshRadar?: ReactNode;
  herkunft?: BlogHerkunft;
}) {
  const clientId = client?.id ?? null;
  // undefined = lädt, null = Blog noch nicht eingerichtet
  const [projekt, setProjekt] = useState<any>(undefined);
  // Automatik ein/aus: null = Ruhe, "frage" = Bestätigung offen, "busy" = läuft
  const [schalter, setSchalter] = useState<null | "frage" | "busy">(null);
  const [schalterFehler, setSchalterFehler] = useState<string | null>(null);
  const [verfuegbar, setVerfuegbar] = useState(true);
  const [daten, setDaten] = useState<any>(null);
  const [tab, setTab] = useState<BlogTab>("dashboard");

  useEffect(() => setTab(gemerkterTab()), []);
  useEffect(() => merkeBlogHerkunft(herkunft), [herkunft]);

  const gehe = useCallback((t: BlogTab) => {
    setTab(t);
    try {
      window.localStorage.setItem(MERKER, t);
    } catch {
      // nicht merken
    }
  }, []);

  // Führung: null = aus, sonst der Schritt. Beim ersten Besuch von selbst.
  const [tour, setTour] = useState<number | null>(null);
  const zeigeSchritt = useCallback((n: number) => {
    setTour(n);
    setTab(TOUR_SCHRITTE[n].tab);
  }, []);
  const beendeTour = useCallback(() => {
    merkeTourGesehen();
    setTour(null);
    setTab(gemerkterTab());
  }, []);
  const laeuftAktiv = !!projekt;
  useEffect(() => {
    if (laeuftAktiv && !tourGesehen()) zeigeSchritt(0);
  }, [laeuftAktiv, zeigeSchritt]);

  useEffect(() => {
    let aktiv = true;
    setProjekt(undefined);
    setDaten(null);
    setVerfuegbar(true);
    setSchalter(null);
    setSchalterFehler(null);
    if (!clientId) return;
    void api(`/api/blog/projects?clientId=${clientId}`).then((r) => {
      if (!aktiv) return;
      setVerfuegbar(r.ok);
      setProjekt(r.ok && blogEingerichtet(r.json?.project?.status) ? r.json.project : null);
    });
    return () => {
      aktiv = false;
    };
  }, [clientId]);

  const projektId: string | null = projekt?.id ?? null;

  const neuLaden = useCallback(async () => {
    if (!projektId) return;
    const r = await api(`/api/blog/projects/${projektId}/articles`);
    if (r.ok && r.json?.ok) setDaten(r.json);
  }, [projektId]);

  useEffect(() => {
    void neuLaden();
  }, [neuLaden]);

  const nurHub = projekt?.publish_mode === "hub_only";
  const eintraege = useMemo(() => eintraegeAus(daten, nurHub), [daten, nurHub]);

  // Solange geschrieben wird, von selbst nachladen.
  const schreibt = eintraege.some((e) => e.status === "freigegeben" || e.status === "schreibt");
  useEffect(() => {
    if (!schreibt) return;
    const t = window.setInterval(() => void neuLaden(), 20_000);
    return () => window.clearInterval(t);
  }, [schreibt, neuLaden]);

  const onProjekt = useCallback(
    (neu: any) => setProjekt((alt: any) => (alt ? { ...alt, ...neu } : alt)),
    [],
  );

  // In EzyAI steht der Bereich für sich: ohne Hinweis bliebe die Seite leer.
  if (clientId && !verfuegbar && herkunft === "ezyai")
    return (
      <div style={{ color: P.muted, fontSize: 14, padding: "48px 16px", textAlign: "center" }}>
        Für diesen Kunden ist der Blog-Autopilot nicht verfügbar.
      </div>
    );
  if (!clientId || !verfuegbar) return <>{refreshRadar}</>;
  if (projekt === undefined) return null;
  if (!projekt)
    return (
      <>
        <BlogAutopilotKarte client={client} />
        {refreshRadar}
      </>
    );

  const agentur = !!daten?.agentur;
  const pausiert = projekt.status === "paused";

  // Automatik ein- oder ausschalten (nur Agentur). Einschalten prüft der Server
  // wie den ersten Start: WordPress (ausser «nur Hub») und mindestens ein Thema.
  const schalte = async () => {
    setSchalter("busy");
    setSchalterFehler(null);
    const r = await api(
      `/api/blog/projects/${projekt.id}/start`,
      "POST",
      pausiert ? {} : { pause: true },
    );
    if (r.ok && r.json?.project) {
      onProjekt(r.json.project);
      setSchalter(null);
      void neuLaden();
      return;
    }
    setSchalterFehler(r.json?.error || "Das hat nicht geklappt. Bitte noch einmal versuchen.");
    setSchalter("frage");
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        marginBottom: 16,
        color: P.text,
        minWidth: 0,
      }}
    >
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px 20px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontSize: 13,
              fontWeight: 700,
              color: pausiert ? P.muted : "#00704a",
              background: pausiert ? "rgba(43,0,51,.06)" : P.greenDim,
              borderRadius: 99,
              padding: "5px 11px",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 7,
                height: 7,
                borderRadius: 99,
                background: pausiert ? P.dim : P.green,
              }}
            />
            {pausiert ? "Automatik aus" : "Autopilot aktiv"}
          </span>
          {agentur && schalter === null && (
            <button
              type="button"
              onClick={() => {
                setSchalterFehler(null);
                setSchalter("frage");
              }}
              style={{
                ...verweisStil,
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {pausiert ? "Automatik einschalten" : "Automatik ausschalten"}
            </button>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          {tour === null && (
            <button
              type="button"
              onClick={() => zeigeSchritt(0)}
              style={{
                ...verweisStil,
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Kurze Führung
            </button>
          )}
          <a href={`/ezyrank/blog/einrichtung/7?client=${clientId}`} style={verweisStil}>
            Themenplan öffnen
          </a>
        </div>
      </header>

      {agentur && schalter !== null && (
        <div
          role="group"
          aria-label={pausiert ? "Automatik einschalten" : "Automatik ausschalten"}
          style={{
            background: P.card,
            border: `1px solid ${P.border}`,
            borderRadius: 16,
            padding: "16px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 15 }}>
            {pausiert ? "Automatik einschalten?" : "Automatik ausschalten?"}
          </div>
          <div style={{ fontSize: 14, color: P.muted, lineHeight: 1.5, maxWidth: 720 }}>
            {pausiert
              ? "Freigegebene Themen mit Termin in den letzten 14 Tagen bis morgen werden sofort geschrieben. Danach schreibt der Autopilot jedes Thema an seinem Termin, und die Wochenprüfung läuft wieder."
              : "Es wird nichts mehr von selbst geschrieben oder geprüft. Der Blog bleibt sichtbar; Artikel lassen sich weiterhin von Hand starten. Bereits gestartete Artikel werden fertig geschrieben."}
          </div>
          {schalterFehler && (
            <div role="alert" style={{ fontSize: 14, color: P.red }}>
              {schalterFehler}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Knopf onClick={() => void schalte()} disabled={schalter === "busy"}>
              {schalter === "busy"
                ? "Einen Moment…"
                : pausiert
                  ? "Automatik einschalten"
                  : "Automatik ausschalten"}
            </Knopf>
            <Knopf
              art="text"
              onClick={() => {
                setSchalter(null);
                setSchalterFehler(null);
              }}
              disabled={schalter === "busy"}
            >
              Abbrechen
            </Knopf>
          </div>
        </div>
      )}

      {tour !== null && <BlogTour schritt={tour} onSchritt={zeigeSchritt} onEnde={beendeTour} />}

      <Segmente
        label="Bereiche im Blog"
        wert={tab}
        optionen={[...TABS]}
        onChange={(t) => {
          // Wer selbst klickt, verlässt die Führung.
          if (tour !== null) {
            merkeTourGesehen();
            setTour(null);
          }
          gehe(t);
        }}
      />

      <Suspense fallback={<div style={{ minHeight: 240 }} />}>
        {tab === "dashboard" && (
          <BlogDashboard
            clientId={clientId}
            projekt={projekt}
            daten={daten}
            eintraege={eintraege}
            agentur={agentur}
            gehe={gehe}
          />
        )}
        {tab === "kalender" && (
          <BlogKalender
            projekt={projekt}
            daten={daten}
            eintraege={eintraege}
            agentur={agentur}
            neuLaden={neuLaden}
          />
        )}
        {tab === "optimierung" && (
          <BlogOptimierung
            projekt={projekt}
            agentur={agentur}
            clientId={clientId}
            refreshRadar={refreshRadar}
          />
        )}
        {tab === "einstellungen" && (
          <BlogEinstellungen projekt={projekt} agentur={agentur} onProjekt={onProjekt} />
        )}
        {tab === "integrationen" && (
          <BlogIntegrationen
            projekt={projekt}
            agentur={agentur}
            clientId={clientId}
            onProjekt={onProjekt}
          />
        )}
      </Suspense>
    </div>
  );
}
