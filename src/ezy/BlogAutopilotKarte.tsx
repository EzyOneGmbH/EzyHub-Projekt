// Blog-Autopilot: Einstieg im Blog-Tab von EzyRank (Kap. 6A «Einstiegspunkte»).
// Ohne Projekt → «Blog-Autopilot einrichten», im Onboarding → «Einrichtung
// fortsetzen», aktiv → Kurzstatus mit Link zum Themenplan. Ist der Autopilot
// für den Kunden nicht freigeschaltet (403), erscheint nichts.
import { useEffect, useState } from "react";
import { authedJson } from "@/lib/authed-fetch";

const P = {
  text: "#0D0D0D",
  muted: "#5d5563",
  grad: "linear-gradient(135deg,#71008B,#B9009C)",
  accentDim: "rgba(119,0,140,.06)",
  green: "#00915f",
  shadow: "0 1px 2px rgba(43,0,51,.04), 0 12px 32px -20px rgba(43,0,51,.22)",
};

export default function BlogAutopilotKarte({ client }: { client: { id: string } | null }) {
  const [stand, setStand] = useState<{ project: any; themen: number } | null>(null);
  useEffect(() => {
    setStand(null);
    if (!client?.id) return;
    let aktiv = true;
    void (async () => {
      const r = await authedJson<any>(`/api/blog/projects?clientId=${client.id}`);
      if (!aktiv || !r.ok) return;
      const project = r.json?.project ?? null;
      let themen = 0;
      if (project?.status === "active") {
        const t = await authedJson<any>(`/api/blog/projects/${project.id}/topics`);
        themen = t.json?.topics?.length ?? 0;
      }
      if (aktiv) setStand({ project, themen });
    })();
    return () => {
      aktiv = false;
    };
  }, [client?.id]);

  if (!client?.id || !stand) return null;
  const p = stand.project;
  const link = (step: number) => `/ezyrank/blog/einrichtung/${step}?client=${client.id}`;
  const aktiv = p?.status === "active";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
        background: aktiv ? "#fff" : P.accentDim,
        boxShadow: P.shadow,
        borderRadius: 16,
        padding: "16px 18px",
        marginBottom: 16,
      }}
    >
      <div>
        <div style={{ fontWeight: 800, fontSize: 15, color: P.text }}>
          {aktiv ? (
            <>
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: 99,
                  background: P.green,
                  marginRight: 8,
                }}
              />
              Blog-Autopilot aktiv
            </>
          ) : (
            "Blog-Autopilot"
          )}
        </div>
        <div style={{ fontSize: 13, color: P.muted, marginTop: 2 }}>
          {aktiv
            ? `${stand.themen} ${stand.themen === 1 ? "Thema" : "Themen"} geplant · jeden Montag neue Chancen`
            : p
              ? `Einrichtung bei Schritt ${p.onboarding_step} von 8`
              : "In rund 10 Minuten eingerichtet. Nichts geht ohne dich live."}
        </div>
      </div>
      <a
        href={aktiv ? link(7) : link(p ? p.onboarding_step : 1)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          minHeight: 44,
          padding: "0 20px",
          borderRadius: 99,
          background: aktiv ? "#fff" : P.grad,
          color: aktiv ? P.text : "#fff",
          border: aktiv ? "1px solid rgba(43,0,51,.14)" : "none",
          fontWeight: 700,
          fontSize: 14,
          textDecoration: "none",
        }}
      >
        {aktiv ? "Themenplan öffnen" : p ? "Einrichtung fortsetzen" : "Blog-Autopilot einrichten"}
      </a>
    </div>
  );
}
