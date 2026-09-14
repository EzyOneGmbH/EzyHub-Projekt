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
    version: "2.2.0",
    changelog: [
      {
        version: "2.2.0",
        date: "2026-09-13",
        note: "Conversion-Scout kennt jetzt den Google Tag Manager: bestehende GA4-Event-Tags des Kunden (z. B. purchase, mail_click) erscheinen als Kandidaten «GTM-Event» und werden bei Freigabe direkt als Key Event markiert — ohne zusätzliches Basisevent; Kontakt-Kandidaten zeigen an, wenn sie via GTM schon gemessen werden",
      },
      {
        version: "2.1.0",
        date: "2026-09-11",
        note: "Rankings mit Maps-Kasten: Kunden mit hinterlegtem Standort werden aus ihrer Stadt gecrawlt (so wie ihr Google seht) und die Spalte «Maps» zeigt den Platz im Google-Maps-Kasten; Vollcrawl aller Keywords alle 5 Tage, internationale Messung alle 10 Tage. Visibility Index neu echt aus Sistrix, Domain Rating aus Ahrefs; Kacheln Organic Keywords sowie die Widgets Ranking-Verteilung, Verweisende Domains und Entwicklung entfernt",
      },
      {
        version: "2.0.0",
        date: "2026-09-09",
        note: "Rankings neu als Hybrid: die Position kommt täglich aus der Google Search Console (Ø der letzten 7 Tage, Schweiz, in der Tabelle mit «Ø» markiert), der Crawl misst Money-Keywords alle 5 Tage und alle Keywords einmal im Monat — dadurch alle Keywords mit Sichtbarkeit abgedeckt, nicht nur die getrackten",
      },
      {
        version: "1.9.0",
        date: "2026-09-09",
        note: "Backlinks & Autorität und der Site-Audit kommen wieder aus Ahrefs (Domain Rating, Backlink-Verlauf, Issue-Liste) — der Tab «Local Grid» wurde entfernt",
      },
      {
        version: "1.8.0",
        date: "2026-08-31",
        note: "Conversion-Scout zeigt alle CTAs der Website: interne CTA-Buttons/Zielseiten (Kontakt, Buchen, Offerte …) und externe CTA-Links erscheinen als Kandidaten — ihr entscheidet selbst, welche als Conversion freigegeben werden",
      },
      {
        version: "1.7.0",
        date: "2026-08-31",
        note: "Rankings vereinheitlicht: das separate Widget «Top Non-Brand-Suchanfragen» ist in der Rankings-Tabelle aufgegangen (alles an einem Ort) — neu mit Suchfeld zum schnellen Finden von Keywords",
      },
      {
        version: "1.6.1",
        date: "2026-08-31",
        note: "Auch die Tabelle «Top-Suchbegriffe (Search Console)» zeigt jetzt die Δ-7-Tage-Bewegung je Suchbegriff (sortierbar, grün/orange)",
      },
      {
        version: "1.6.0",
        date: "2026-08-31",
        note: "Non-Brand-Suchanfragen mit Entwicklung: Δ-7-Tage-Spalte im Widget «Top Non-Brand-Suchanfragen» und echte Δ 7T/Δ 28T für GSC-Queries in der Rankings-Tabelle (grün = verbessert, orange = verschlechtert)",
      },
      {
        version: "1.5.4",
        date: "2026-08-31",
        note: "KI-Conversions separiert: die Detailliste in EzyRank zeigt rein organische Conversions — KI-Conversions erscheinen nur noch im EzyAI-Conversions-Tab",
      },
      {
        version: "1.5.3",
        date: "2026-08-31",
        note: "Detailliste im Conversions-Tab schliesst Direktzugriffe jetzt auch im Snapshot-Fallback sicher aus",
      },
      {
        version: "1.5.2",
        date: "2026-08-31",
        note: "Detailliste im Conversions-Tab zeigt neben organischen auch KI-Conversions (ChatGPT/Perplexity/… — Referrals, keine bezahlten KI-Klicks)",
      },
      {
        version: "1.5.1",
        date: "2026-08-31",
        note: "Conversions-Tab: die detaillierte Einzel-Auflistung zeigt nur noch organische Conversions (Kanal «Organic Search»); die Event-Übersicht bleibt vollständig",
      },
      {
        version: "1.5.0",
        date: "2026-08-31",
        note: "Conversion-Kandidaten sind benennbar: der vergebene Name wird zum GA4-Eventnamen und ausgelöste Conversions erscheinen im Conversions-Tab unter diesem Namen",
      },
      {
        version: "1.4.1",
        date: "2026-08-27",
        note: "Conversion-Scout erkennt zusätzlich Hotel-Buchungsmaschinen (Mews, re:guest, Seekda u. a.) und Buchungs-Pfade als Cross-Domain-Ziel",
      },
      {
        version: "1.4.0",
        date: "2026-08-27",
        note: "Conversion-Scout erkennt jetzt auch Cross-Domain-Checkout-Ziele (z. B. RaiseNow/Stripe): der Klick zum externen Kauf/zur Spende wird als GA4 Key Event messbar; Hinweis-Schritte für den echten Betrag (nur organische Messung)",
      },
      {
        version: "1.3.0",
        date: "2026-08-26",
        note: "Conversion-Scout im Conversions-Tab: erkannte Kontakt- und Download-Ziele einzeln prüfen, mit Wert freigeben und als GA4 Key Event scharfschalten (nur organische Messung)",
      },
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
    version: "1.13.1",
    changelog: [
      {
        version: "1.13.1",
        date: "2026-09-14",
        note: "Insights: Filterleiste (Stand-Datum, Themen- und Branded-Filter) ausgeblendet — sie gehörte zu den nicht mehr sichtbaren Analyse-Tabs",
      },
      {
        version: "1.13.0",
        date: "2026-09-14",
        note: "Traffic ist kein eigener Bereich mehr, sondern ein Tab «Traffic» neben Conversions im Insights-Dashboard (Vergleichsperiode direkt im Tab)",
      },
      {
        version: "1.12.1",
        date: "2026-09-14",
        note: "Ausgeblendet: die Matrix «SEO × KI-Sichtbarkeit» im Traffic-Bereich sowie die Karte «KI-Crawler auf der Website» samt Ingest-Token unter Insights",
      },
      {
        version: "1.12.0",
        date: "2026-09-14",
        note: "EzyAI fokussiert: die Bereiche LLM Analytics, Your Prompts, Content und Chancen sowie die Insights-Tabs Sichtbarkeit, Erwähnungen, Marke, Quellen und Themen sind ausgeblendet — sichtbar bleiben Insights (Conversions), Traffic, Site Health, Issues und der ChatGPT-Ads-Modus",
      },
      {
        version: "1.11.0",
        date: "2026-09-13",
        note: "ChatGPT Ads komplett aus EzyHub steuerbar: Kampagnen-Wizard (Kampagne, Anzeigengruppe und Anzeige mit Bild in einem Zug, Duplizieren), Anzeigengruppen und Anzeigen anlegen/bearbeiten/pausieren/archivieren, Kampagnen-Details (Laufzeitbudget, Start/Ende), Regionen ausschliessen, Aufschlüsselung nach Land/Gerät/Plattform, Konto-Review-Status und Not-Aus, Konto-Auswahl beim Verbinden, Zielgruppen ergänzen/entfernen — nur Konto/Zahlung, Pixel-Häkchen und Review-Einsprüche bleiben im Ads Manager",
      },
      {
        version: "1.10.1",
        date: "2026-09-13",
        note: "Kampagnen: Spend/Klicks/Conversions des echten OpenAI-Kontos werden jetzt geladen — der Insights-Abruf nutzte ein falsches Zeitraum-Format und fragte keine Metriken an (still 0); Sync-Fehler beim Reporting werden neu in der Konto-Karte angezeigt",
      },
      {
        version: "1.10.0",
        date: "2026-09-13",
        note: "ChatGPT Ads (Advertiser API v2.3): Conversions-Setup direkt in EzyHub — Pixel anlegen, Server-Key sicher erzeugen, Conversion-Events definieren und Kampagnen zuweisen; «Live-Events (OpenAI)» zeigt, ob Pixel-/Server-Events bei OpenAI wirklich ankommen (auch bei GTM-Einbau); Kampagnen mit Conversions, CPA und ROAS/Umsatz; Anzeigen je Kampagne mit Review-Status und Vorschau",
      },
      {
        version: "1.9.1",
        date: "2026-09-01",
        note: "Geo-Targeting: Ländernamen aus dem echten OpenAI-Konto werden direkt übernommen (statt nur der ID)",
      },
      {
        version: "1.9.0",
        date: "2026-09-01",
        note: "ChatGPT Ads ausgebaut (neue Advertiser-API-Funktionen): Geo-Targeting je Kampagne (Länder/Kantone/Regionen mit Suche), Bulk-Aktionen (mehrere Kampagnen auf einmal pausieren/aktivieren) und neuer Bereich «Zielgruppen» — Kundenlisten datenschutzkonform (im Browser gehasht) hochladen und Kampagnen zuweisen (ein-/ausschliessen)",
      },
      {
        version: "1.8.5",
        date: "2026-09-01",
        note: "Website-Snippet: Button «Installation prüfen» — EzyHub ruft die Kunden-Website ab und bestätigt SDK, Pixel-ID, Seitenaufruf-Messung und Formular-Hook; damit lässt sich die Pixel-Verifikation im OpenAI Ads Manager abhaken",
      },
      {
        version: "1.8.4",
        date: "2026-09-01",
        note: "Ads-Modus, Conversions: fertiges Website-Snippet (offizielles OpenAI-Pixel) je Kunde zum Kopieren — misst Seitenaufrufe und Formular-Leads, übernimmt die Klick-Attribution (oppref) automatisch und gibt event_id/oppref als Formular-Felder fürs Server-Tracking mit",
      },
      {
        version: "1.8.3",
        date: "2026-09-01",
        note: "Kampagnen: der «Verbinden»-Button war durch einen Farbfehler unsichtbar (weiss auf weiss) — jetzt sichtbar; Enter im Key-Feld verbindet ebenfalls, Fehler beim Verbinden werden deutlich rot angezeigt",
      },
      {
        version: "1.8.2",
        date: "2026-09-01",
        note: "Conversions wieder wie gewohnt: der Tab im Insights-Bereich (Besucher je KI-Engine, aufklappbare Einzel-Conversions, Regionen-Karte) ist zurück — er war verschwunden, weil die Daten am Mess-Report hingen; der separate Bereich im EzyRank-Stil ist wieder entfernt",
      },
      {
        version: "1.8.1",
        date: "2026-09-01",
        note: "Bereich «Conversions» in der EzyAI-Navigation: organische und KI-Conversions (ChatGPT/Perplexity/… Referrals) an einem Ort — schliesst die Lücke aus der KI-Separierung vom 31.08.",
      },
      {
        version: "1.8.0",
        date: "2026-08-31",
        note: "ChatGPT-Ads-Kampagnen-Management: Konto verbinden, Kampagnen pausieren/aktivieren, Tagesbudget ändern, Performance (Spend/Klicks/CTR) — inkl. Demo-Modus bis zur CH-Freischaltung",
      },
      {
        version: "1.7.1",
        date: "2026-08-28",
        note: "Citations zählen wieder korrekt (Google verpackt Quellen neu als Weiterleitungs-Links); Kachel «Referenzierte Seiten» entfernt, Erwähnungen und Citations laufen breiter",
      },
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
