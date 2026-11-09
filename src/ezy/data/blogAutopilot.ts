// Blog-Autopilot: gemeinsame Konstanten für Server und Oberfläche
// (Bauanleitung Kap. 6.1, 6A). Keine Server-Abhängigkeiten.

/** Stufen der Website-Analyse in der Reihenfolge der Agent-Aktivität. */
export const ANALYSE_STUFEN = [
  { key: "lesen", label: "Website lesen", percent: 5 },
  { key: "angebot", label: "Angebot erkennen", percent: 25 },
  { key: "zielgruppen", label: "Zielgruppen", percent: 40 },
  { key: "mitbewerber_suchen", label: "Mitbewerber suchen", percent: 55 },
  { key: "mitbewerber_pruefen", label: "Mitbewerber prüfen", percent: 70 },
  { key: "tonalitaet", label: "Tonalität", percent: 85 },
  { key: "cluster", label: "Themen-Cluster", percent: 95 },
  { key: "fertig", label: "Fertig", percent: 100 },
] as const;

export type AnalyseStufe = (typeof ANALYSE_STUFEN)[number]["key"];

/** Job-Phase (Spalte stage) → Stufen, die in dieser Phase laufen. */
export const ANALYSE_PHASEN: Record<string, AnalyseStufe[]> = {
  lesen: ["lesen"],
  profil: ["angebot", "zielgruppen"],
  mitbewerber: ["mitbewerber_suchen", "mitbewerber_pruefen"],
  abschluss: ["tonalitaet", "cluster", "fertig"],
};

export const TONALITAETEN = [
  {
    id: "informativ",
    label: "Informativ",
    beispiel: "Hier erfährst du Schritt für Schritt, worauf es wirklich ankommt.",
  },
  {
    id: "gespraechig",
    label: "Gesprächig",
    beispiel: "Kennst du das? Du suchst eine einfache Antwort und findest nur Fachchinesisch.",
  },
  {
    id: "ueberzeugend",
    label: "Überzeugend",
    beispiel:
      "Warte nicht länger: Mit dem richtigen Schritt heute sparst du dir morgen viel Aufwand.",
  },
] as const;

export const BILDSTILE = [
  { id: "fotografisch", label: "Fotografisch", beschreibung: "Natürliche Fotos, echtes Licht" },
  { id: "dokumentarisch", label: "Dokumentarisch", beschreibung: "Reportage, Menschen vor Ort" },
  { id: "illustration", label: "Illustration", beschreibung: "Gezeichnet, warm, flächig" },
  { id: "minimalistisch", label: "Minimalistisch", beschreibung: "Ruhig, viel Weissraum" },
  { id: "infografik", label: "Infografik", beschreibung: "Zahlen und Abläufe visualisiert" },
] as const;

export const SPRACHEN = ["de-CH", "de-DE", "fr-CH", "it-CH", "en"] as const;
