import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import BlogAutopilotKarte from "@/ezy/BlogAutopilotKarte";
import { P, Segmente, api, eintraegeAus, verweisStil } from "@/ezy/BlogUi";

// Blog-Tab in EzyRank: Kopfzeile und Unter-Tabs. Solange der Autopilot noch
// nicht läuft, steht hier nur die Einrichtungskarte.

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
}: {
  client: { id: string } | null;
  refreshRadar?: ReactNode;
}) {
  const clientId = client?.id ?? null;
  // undefined = lädt, null = kein laufender Autopilot
  const [projekt, setProjekt] = useState<any>(undefined);
  const [verfuegbar, setVerfuegbar] = useState(true);
  const [daten, setDaten] = useState<any>(null);
  const [tab, setTab] = useState<BlogTab>("dashboard");

  useEffect(() => setTab(gemerkterTab()), []);

  const gehe = useCallback((t: BlogTab) => {
    setTab(t);
    try {
      window.localStorage.setItem(MERKER, t);
    } catch {
      // nicht merken
    }
  }, []);

  useEffect(() => {
    let aktiv = true;
    setProjekt(undefined);
    setDaten(null);
    setVerfuegbar(true);
    if (!clientId) return;
    void api(`/api/blog/projects?clientId=${clientId}`).then((r) => {
      if (!aktiv) return;
      setVerfuegbar(r.ok);
      setProjekt(r.ok && r.json?.project?.status === "active" ? r.json.project : null);
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
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Blog</h2>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontSize: 13,
              fontWeight: 700,
              color: "#00704a",
              background: P.greenDim,
              borderRadius: 99,
              padding: "5px 11px",
            }}
          >
            <span
              aria-hidden
              style={{ width: 7, height: 7, borderRadius: 99, background: P.green }}
            />
            Autopilot aktiv
          </span>
        </div>
        <a href={`/ezyrank/blog/einrichtung/7?client=${clientId}`} style={verweisStil}>
          Themenplan öffnen
        </a>
      </header>

      <Segmente label="Bereiche im Blog" wert={tab} optionen={[...TABS]} onChange={gehe} />

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
