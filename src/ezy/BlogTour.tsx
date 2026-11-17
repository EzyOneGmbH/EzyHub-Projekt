import { useEffect, useRef } from "react";
import { Knopf, P } from "@/ezy/BlogUi";

// Kurze Führung durch den Blog-Tab für neue Nutzer: je Unter-Tab ein Schritt.
// Die Karte steht über den Unter-Tabs und schaltet den passenden Tab ein. Ob
// die Führung schon gesehen wurde, merkt sich der Browser.

export const TOUR_SCHRITTE = [
  {
    tab: "dashboard",
    titel: "Dashboard: dein Überblick",
    text: "Hier siehst du, was als Nächstes ansteht, welche Artikel live sind und wie sich Klicks, Sichtbarkeit bei Google und in KI-Antworten entwickeln.",
  },
  {
    tab: "kalender",
    titel: "Kalender: der Plan",
    text: "Jede Woche auf einen Blick: geplante Themen, Artikel in Arbeit und fertige Artikel. Ein Klick auf einen Artikel öffnet den Text samt Quellen. Live geht nichts ohne Freigabe.",
  },
  {
    tab: "optimierung",
    titel: "Optimierung: neue Chancen",
    text: "Der Autopilot prüft regelmässig, für welche Suchbegriffe ein neuer Artikel oder eine Überarbeitung am meisten bringt. Aus diesen Vorschlägen entstehen die nächsten Themen.",
  },
  {
    tab: "einstellungen",
    titel: "Einstellungen: so schreibt der Autopilot",
    text: "Unternehmen, Sprache, Ton, Wettbewerber und Schreibregeln. Was hier steht, gilt für jeden künftigen Artikel.",
  },
  {
    tab: "integrationen",
    titel: "Integrationen: die Verbindungen",
    text: "WordPress, Search Console und Analytics. Hier siehst du, ob alles verbunden ist und wann die Verbindung zuletzt geprüft wurde.",
  },
] as const;

const MERKER = "ezyBlogTour.v1";

export function tourGesehen(): boolean {
  try {
    return window.localStorage.getItem(MERKER) === "1";
  } catch {
    // ohne Speicher nicht bei jedem Besuch von selbst zeigen
    return true;
  }
}

export function merkeTourGesehen(): void {
  try {
    window.localStorage.setItem(MERKER, "1");
  } catch {
    // nicht merken
  }
}

export default function BlogTour({
  schritt,
  onSchritt,
  onEnde,
}: {
  schritt: number;
  onSchritt: (n: number) => void;
  onEnde: () => void;
}) {
  const s = TOUR_SCHRITTE[schritt];
  const titelRef = useRef<HTMLHeadingElement>(null);
  const letzter = schritt === TOUR_SCHRITTE.length - 1;

  // Nach jedem Schritt den Titel fokussieren, damit Screenreader ihn ansagen.
  useEffect(() => {
    titelRef.current?.focus();
  }, [schritt]);

  if (!s) return null;
  return (
    <section
      aria-label="Führung durch den Blog"
      onKeyDown={(e) => {
        if (e.key === "Escape") onEnde();
      }}
      style={{
        background: P.card,
        border: `1px solid ${P.accent}`,
        borderRadius: 16,
        boxShadow: P.shadow,
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 700, color: P.accent }}>
        Kurze Führung · Schritt {schritt + 1} von {TOUR_SCHRITTE.length}
      </div>
      <h2
        ref={titelRef}
        tabIndex={-1}
        style={{ margin: 0, fontSize: 18, fontWeight: 800, color: P.text, outline: "none" }}
      >
        {s.titel}
      </h2>
      <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: P.muted, maxWidth: 680 }}>
        {s.text}
      </p>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          marginTop: 4,
        }}
      >
        <Knopf art="text" onClick={onEnde}>
          {letzter ? "Schliessen" : "Überspringen"}
        </Knopf>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {schritt > 0 && (
            <Knopf art="sekundaer" onClick={() => onSchritt(schritt - 1)}>
              Zurück
            </Knopf>
          )}
          <Knopf onClick={() => (letzter ? onEnde() : onSchritt(schritt + 1))}>
            {letzter ? "Fertig" : "Weiter"}
          </Knopf>
        </div>
      </div>
    </section>
  );
}
