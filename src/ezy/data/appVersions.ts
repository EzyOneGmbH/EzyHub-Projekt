// Versionierung je Web-App (Volkan 13.08.): unten rechts in jeder App eine
// dezente Versionsnummer, damit Kunden & Team sehen, dass laufend Updates
// kommen. Vorgehen bei jedem Release: NEUEN Eintrag oben in changelog[] der
// betroffenen App einfügen (date = ISO, note = kurzer deutscher Satz) und
// version auf den neuen Wert setzen. Die Nummer der App = version.
//
// Semver light: MAJOR = großer Umbau, MINOR = neues Feature/Redesign,
// PATCH = Fix/Detailschliff.

export type AppVersionInfo = {
  version: string;
  changelog: Array<{ version: string; date: string; note: string }>;
};

// Schlüssel = EzyAppId (appRegistry). EzyAI läuft als eigene Route (geo).
export const APP_VERSIONS: Record<string, AppVersionInfo> = {
  // EzyRank (SEO)
  seo: {
    version: "1.2.0",
    changelog: [
      { version: "1.2.0", date: "2026-08-13", note: "Kundenreihenfolge überall alphabetisch" },
      {
        version: "1.1.0",
        date: "2026-08-12",
        note: "Datumsfilter wirkt auf KPIs, geteilter Zeitraum + Cache",
      },
      {
        version: "1.0.0",
        date: "2026-08-10",
        note: "Ezy One Corporate Design + Waben-Hintergrund",
      },
    ],
  },
  // EzyAI (KI-Sichtbarkeit)
  geo: {
    version: "1.7.0",
    changelog: [
      {
        version: "1.7.0",
        date: "2026-08-26",
        note: "ChatGPT Ads: Organic/Ads-Schalter in der Seitenleiste, Conversion-Tracking über die OpenAI Conversions API (Dashboard, Conversions, Event-Log)",
      },
      {
        version: "1.6.3",
        date: "2026-08-25",
        note: "Verlauf im Prompt-Detail entfernt, Marken-Prompts stehen in Liste und Anfragen-Matrix immer am Ende",
      },
      {
        version: "1.6.2",
        date: "2026-08-24",
        note: "Antworten-Filter vereinfacht (Erfolgreichste Prompts inkl. Marken-Prompts als Standard, nur noch 2 Filter), Google-KI-Messung wieder im 2-Tage-Takt",
      },
      {
        version: "1.6.1",
        date: "2026-08-24",
        note: "Echte KI-Suche in die Anfragen-Matrix integriert (Marken + Folgefragen im Antwort-Dialog), separate Karte entfernt",
      },
      {
        version: "1.6.0",
        date: "2026-08-23",
        note: "Bereich KI-Konkurrenz entfernt, Kopfzeile kompakter (Zeitraum als Dropdown)",
      },
      {
        version: "1.5.0",
        date: "2026-08-21",
        note: "Chancen: Team-Verantwortliche, Fällig-Filter + Benachrichtigung, robuste Fingerprints, Fehler je Quelle sichtbar",
      },
      {
        version: "1.4.0",
        date: "2026-08-18",
        note: "Chancen-Workflow (Status/Verantwortliche/Wiedervorlage), Your Prompts als Bereich, eigene Zeiträume + Vergleich, Brief-Detailansicht",
      },
      {
        version: "1.3.0",
        date: "2026-08-13",
        note: "Kundenreihenfolge alphabetisch, Layout wie EzyRank",
      },
      {
        version: "1.2.0",
        date: "2026-08-13",
        note: "aivis: Prompt-Verlauf, Sentiment, Chancen-Queue",
      },
      {
        version: "1.1.0",
        date: "2026-08-11",
        note: "Datumsfilter in den Header, geteilter Zeitraum",
      },
      {
        version: "1.0.0",
        date: "2026-08-10",
        note: "Ezy One Corporate Design + Waben-Hintergrund",
      },
    ],
  },
  // EzyPerformance (Ads)
  ads: {
    version: "1.2.0",
    changelog: [
      { version: "1.2.0", date: "2026-08-13", note: "Kundenreihenfolge alphabetisch" },
      { version: "1.1.0", date: "2026-08-11", note: "Datumsfilter + Widget-Deckkraft korrigiert" },
      {
        version: "1.0.0",
        date: "2026-08-10",
        note: "Ezy One Corporate Design + Waben-Hintergrund",
      },
    ],
  },
  // EzyAI – Analyse (Lead-Pre-Check, intern)
  analyse: {
    version: "1.4.0",
    changelog: [
      {
        version: "1.4.0",
        date: "2026-08-18",
        note: "Läuft im Hintergrund weiter (Server-Worker), Lead→Kunde-Übernahme, Methodik & Datenquellen",
      },
      {
        version: "1.3.0",
        date: "2026-08-17",
        note: "6 Engines (neu Grok & DeepSeek), Themen-Nischen-Prompts aus der Website",
      },
      {
        version: "1.2.0",
        date: "2026-08-14",
        note: "15 Prompts je Lauf, max. 3 Brand — Rest neutrale Alternativen-Suchen",
      },
      {
        version: "1.1.0",
        date: "2026-08-14",
        note: "AI-Crawler-Zugriff je Bot (15 Bots, robots.txt-Detail-Panel)",
      },
      {
        version: "1.0.0",
        date: "2026-08-14",
        note: "Erstversion: Wizard, Prompt-Runner, SiteHealth, Benchmark, PDF",
      },
    ],
  },
  // Reaktivierung (intern)
  reakt: {
    version: "1.0.0",
    changelog: [{ version: "1.0.0", date: "2026-08-10", note: "Ezy One Corporate Design" }],
  },
  // Admin
  admin: {
    version: "1.2.0",
    changelog: [
      {
        version: "1.2.0",
        date: "2026-08-17",
        note: "Einsatzbereitschaft je Kunde, geführte Aktionen, Konfigurations-Warnungen, Änderungsprotokoll",
      },
      { version: "1.1.0", date: "2026-08-13", note: "Kundenliste alphabetisch" },
      { version: "1.0.0", date: "2026-08-10", note: "Ezy One Corporate Design" },
    ],
  },
};

/** Versionsinfo je App-Scope; Fallback auf ein Plattform-Minimum. */
export function versionFor(appId: string | null | undefined): AppVersionInfo {
  return (appId && APP_VERSIONS[appId]) || { version: "1.0.0", changelog: [] };
}
