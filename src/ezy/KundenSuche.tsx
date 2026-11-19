import { Search } from "lucide-react";

// Suchfeld der Agentur-Übersichten («Alle Kunden»). Farben kommen von der
// jeweiligen App, damit das Feld in EzyRank, EzyPerformance und EzyAI passt.
export function KundenSuche({
  wert,
  onChange,
  farben,
  platzhalter = "Kunde suchen …",
}: {
  wert: string;
  onChange: (v: string) => void;
  farben: { rand: string; icon: string; grund: string; text: string };
  platzhalter?: string;
}) {
  return (
    <span style={{ position: "relative", display: "block", width: 220, maxWidth: "100%" }}>
      <Search
        size={14}
        color={farben.icon}
        style={{ position: "absolute", left: 10, top: 10, pointerEvents: "none" }}
      />
      <input
        type="search"
        value={wert}
        onChange={(e) => onChange(e.target.value)}
        placeholder={platzhalter}
        aria-label="Kunde suchen"
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "8px 10px 8px 30px",
          border: `1px solid ${farben.rand}`,
          borderRadius: 9,
          fontSize: 12.5,
          fontFamily: "inherit",
          background: farben.grund,
          color: farben.text,
        }}
      />
    </span>
  );
}

/** Hinweis, wenn die Suche keinen Kunden trifft. */
export function KeineTreffer({ farbe }: { farbe: string }) {
  return (
    <div style={{ color: farbe, fontSize: 13, padding: "40px 12px", textAlign: "center" }}>
      Kein Kunde passt zu dieser Suche.
    </div>
  );
}
