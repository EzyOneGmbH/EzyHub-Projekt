// KI-Crawler-Referenz (First-Party GEO, 22.09.2026, Volkan): vollstaendige
// Liste der relevanten KI-Bots mit Betreiber, Zweck und Empfehlung sowie ein
// robots.txt-Bewerter nach RFC 9309 (User-agent-Gruppen, `*` als Fallback).
// Isomorph, rein. admin.site-health.ts (botDetailsFor) hat eine aeltere,
// kleinere Liste — diese Datei ist die Referenz und darf dort spaeter
// eingesetzt werden (Status-Namen dort: blockiert/unspezifiziert, hier:
// gesperrt/unbestimmt gemaess API-Vertrag der GEO-Kacheln).
//
// Wichtige Nuancen:
//  - Google-Extended ist KEIN Crawler, sondern ein Steuer-Token: die Sperre
//    nimmt Inhalte nur aus dem Gemini-Training, sie hat keine Auswirkung auf
//    Google-Suche, AI Overviews oder AI Mode.
//  - Bytespider (ByteDance) ignoriert robots.txt — eine Regel dort ist
//    wirkungslos; sperren geht nur per WAF/Firewall.
//  - Perplexity-User holt Seiten auf Nutzeranfrage und ignoriert robots.txt
//    laut Perplexity-Dokumentation in der Regel.

export type CrawlerZweck = "training" | "suche" | "nutzer-abruf";

export type KiCrawler = {
  name: string;
  betreiber: string;
  zweck: CrawlerZweck;
  haeltSichAnRobots: boolean;
  empfehlung: string;
};

const SUCHE_ERLAUBEN = (engine: string) =>
  `Erlauben — sonst kann ${engine} die Seiten nicht als Quelle zitieren.`;
const ABRUF_ERLAUBEN = (engine: string) =>
  `Erlauben — holt Seiten auf Nutzeranfrage in ${engine}; eine Sperre unterbindet Live-Antworten mit Link auf die Site.`;
const TRAINING_OPTIONAL =
  "Optional — Sperre nimmt Inhalte aus dem Modell-Training, kostet aber keine Sichtbarkeit in KI-Antworten.";

export const KI_CRAWLER: readonly KiCrawler[] = [
  // OpenAI
  {
    name: "GPTBot",
    betreiber: "OpenAI",
    zweck: "training",
    haeltSichAnRobots: true,
    empfehlung: TRAINING_OPTIONAL,
  },
  {
    name: "OAI-SearchBot",
    betreiber: "OpenAI",
    zweck: "suche",
    haeltSichAnRobots: true,
    empfehlung: SUCHE_ERLAUBEN("ChatGPT Search"),
  },
  {
    name: "ChatGPT-User",
    betreiber: "OpenAI",
    zweck: "nutzer-abruf",
    haeltSichAnRobots: true,
    empfehlung: ABRUF_ERLAUBEN("ChatGPT"),
  },
  // Anthropic
  {
    name: "ClaudeBot",
    betreiber: "Anthropic",
    zweck: "training",
    haeltSichAnRobots: true,
    empfehlung: TRAINING_OPTIONAL,
  },
  {
    name: "Claude-SearchBot",
    betreiber: "Anthropic",
    zweck: "suche",
    haeltSichAnRobots: true,
    empfehlung: SUCHE_ERLAUBEN("Claude"),
  },
  {
    name: "Claude-User",
    betreiber: "Anthropic",
    zweck: "nutzer-abruf",
    haeltSichAnRobots: true,
    empfehlung: ABRUF_ERLAUBEN("Claude"),
  },
  // Perplexity
  {
    name: "PerplexityBot",
    betreiber: "Perplexity",
    zweck: "suche",
    haeltSichAnRobots: true,
    empfehlung: SUCHE_ERLAUBEN("Perplexity"),
  },
  {
    name: "Perplexity-User",
    betreiber: "Perplexity",
    zweck: "nutzer-abruf",
    haeltSichAnRobots: false,
    empfehlung:
      "Erlauben — Abruf auf Nutzeranfrage; laut Perplexity wird robots.txt dabei in der Regel ohnehin ignoriert.",
  },
  // Google
  {
    name: "Google-Extended",
    betreiber: "Google",
    zweck: "training",
    haeltSichAnRobots: true,
    empfehlung:
      "Nur Training-Opt-out für Gemini — KEINE Auswirkung auf Google-Suche, AI Overviews oder AI Mode. Sperre optional.",
  },
  {
    name: "GoogleOther",
    betreiber: "Google",
    zweck: "training",
    haeltSichAnRobots: true,
    empfehlung:
      "Optional — generischer Google-Crawler für Forschung/Entwicklung, nicht für die Suche; Sperre kostet keine Sichtbarkeit.",
  },
  // Apple
  {
    name: "Applebot",
    betreiber: "Apple",
    zweck: "suche",
    haeltSichAnRobots: true,
    empfehlung: SUCHE_ERLAUBEN("Siri/Spotlight und Apple Intelligence"),
  },
  {
    name: "Applebot-Extended",
    betreiber: "Apple",
    zweck: "training",
    haeltSichAnRobots: true,
    empfehlung:
      "Nur Training-Opt-out für Apple-Modelle — Applebot (Suche) bleibt davon unberührt. Sperre optional.",
  },
  // Amazon
  {
    name: "Amazonbot",
    betreiber: "Amazon",
    zweck: "training",
    haeltSichAnRobots: true,
    empfehlung:
      "Optional — speist Alexa-Antworten und Amazon-Modelle; für die Schweizer Sichtbarkeit meist ohne Bedeutung.",
  },
  // Meta
  {
    name: "Meta-ExternalAgent",
    betreiber: "Meta",
    zweck: "training",
    haeltSichAnRobots: true,
    empfehlung: TRAINING_OPTIONAL,
  },
  {
    name: "Meta-ExternalFetcher",
    betreiber: "Meta",
    zweck: "nutzer-abruf",
    haeltSichAnRobots: true,
    empfehlung: ABRUF_ERLAUBEN("Meta AI"),
  },
  // ByteDance
  {
    name: "Bytespider",
    betreiber: "ByteDance",
    zweck: "training",
    haeltSichAnRobots: false,
    empfehlung:
      "Ignoriert robots.txt — eine Regel dort ist wirkungslos. Falls sperren gewünscht: per WAF/Firewall (User-Agent oder IP-Bereiche).",
  },
  // Sonstige Trainings-/Datenkorpora
  {
    name: "CCBot",
    betreiber: "Common Crawl",
    zweck: "training",
    haeltSichAnRobots: true,
    empfehlung:
      "Optional — der Common-Crawl-Korpus fliesst in viele Modelle ein; Sperre reduziert Trainingsnutzung, nicht die Zitierbarkeit.",
  },
  {
    name: "cohere-ai",
    betreiber: "Cohere",
    zweck: "training",
    haeltSichAnRobots: true,
    empfehlung: TRAINING_OPTIONAL,
  },
  {
    name: "DuckAssistBot",
    betreiber: "DuckDuckGo",
    zweck: "suche",
    haeltSichAnRobots: true,
    empfehlung: SUCHE_ERLAUBEN("DuckAssist (DuckDuckGo)"),
  },
  {
    name: "Diffbot",
    betreiber: "Diffbot",
    zweck: "training",
    haeltSichAnRobots: true,
    empfehlung:
      "Optional — extrahiert strukturierte Daten für Dritt-Datensätze; Sperre kostet keine Sichtbarkeit.",
  },
];

export type RobotsStatus = "erlaubt" | "gesperrt" | "unbestimmt";

export type RobotsRegel = { typ: "allow" | "disallow"; pfad: string };
export type RobotsGruppe = { agents: string[]; regeln: RobotsRegel[] };

export type RobotsBewertung = {
  status: RobotsStatus;
  /** Massgebliche Regelzeile(n) im Klartext, null ohne Regel. */
  regel: string | null;
  /** Welche Gruppe entschieden hat: eigene, `*`-Fallback oder keine. */
  quelle: "eigen" | "stern" | "keine";
};

/**
 * robots.txt in User-agent-Gruppen zerlegen (RFC 9309): aufeinanderfolgende
 * User-agent-Zeilen bilden EINE Gruppe; Kommentare (#) und unbekannte
 * Direktiven werden ignoriert; Sitemap-Zeilen trennen keine Gruppe.
 */
export function parseRobots(robotsTxt: string): RobotsGruppe[] {
  const gruppen: RobotsGruppe[] = [];
  let aktuell: RobotsGruppe | null = null;
  let sammleAgents = false;
  for (const roh of String(robotsTxt ?? "").split(/\r?\n/)) {
    const zeile = roh.replace(/#.*$/, "").trim();
    if (!zeile) continue;
    const m = zeile.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const feld = m[1].toLowerCase();
    const wert = m[2].trim();
    if (feld === "user-agent") {
      if (!aktuell || !sammleAgents) {
        aktuell = { agents: [], regeln: [] };
        gruppen.push(aktuell);
        sammleAgents = true;
      }
      aktuell.agents.push(wert.toLowerCase());
      continue;
    }
    if (feld === "allow" || feld === "disallow") {
      if (!aktuell) continue; // Regeln vor der ersten Gruppe sind ungueltig
      sammleAgents = false;
      aktuell.regeln.push({ typ: feld, pfad: wert });
      continue;
    }
    // sitemap, crawl-delay, host, … — Gruppe bleibt, aber neue User-agent-
    // Zeilen danach eroeffnen eine neue Gruppe.
    if (aktuell) sammleAgents = false;
  }
  return gruppen;
}

/** Gruppe fuer einen Bot: exakter Name (case-insensitiv), sonst null. */
function gruppeFuer(gruppen: RobotsGruppe[], agent: string): RobotsGruppe | null {
  const a = agent.toLowerCase();
  // Mehrere Gruppen fuer denselben Agent werden zusammengefuehrt (RFC 9309 §2.2.1).
  const treffer = gruppen.filter((g) => g.agents.includes(a));
  if (!treffer.length) return null;
  return { agents: [a], regeln: treffer.flatMap((g) => g.regeln) };
}

const regelText = (r: RobotsRegel) => `${r.typ === "allow" ? "Allow" : "Disallow"}: ${r.pfad}`;

/** Ist die Wurzel «/» in dieser Gruppe gesperrt? (Allow: / schlaegt Disallow: /) */
function bewerteGruppe(g: RobotsGruppe): { status: RobotsStatus; regel: string | null } {
  const disRoot = g.regeln.find((r) => r.typ === "disallow" && r.pfad === "/");
  const allowRoot = g.regeln.find((r) => r.typ === "allow" && r.pfad === "/");
  if (disRoot && !allowRoot) return { status: "gesperrt", regel: regelText(disRoot) };
  if (allowRoot) return { status: "erlaubt", regel: regelText(allowRoot) };
  // Wurzel frei: spezifische Disallows (Teilbereiche) als Text mitgeben.
  const teil = g.regeln.filter((r) => r.typ === "disallow" && r.pfad !== "" && r.pfad !== "/");
  if (teil.length) {
    const txt = teil.slice(0, 3).map(regelText).join("; ");
    return { status: "erlaubt", regel: teil.length > 3 ? `${txt}; …` : txt };
  }
  const leer = g.regeln.find((r) => r.typ === "disallow" && r.pfad === "");
  return { status: "erlaubt", regel: leer ? "Disallow: (leer)" : null };
}

/**
 * Bewertet robots.txt fuer EINEN Bot:
 *  - eigene Gruppe vorhanden → deren Regeln (Disallow: / = gesperrt, Allow: /
 *    hebt das auf, Teilpfade = erlaubt mit Regeltext)
 *  - sonst `*`-Gruppe als Fallback
 *  - keine passende Gruppe → unbestimmt (faktisch erlaubt, aber nicht geregelt)
 * Ein leeres/fehlendes robots.txt ergibt unbestimmt.
 */
export function bewerteRobots(robotsTxt: string, bot: string): RobotsBewertung {
  const gruppen = parseRobots(robotsTxt);
  const eigen = gruppeFuer(gruppen, bot);
  if (eigen) return { ...bewerteGruppe(eigen), quelle: "eigen" };
  const stern = gruppeFuer(gruppen, "*");
  if (stern) return { ...bewerteGruppe(stern), quelle: "stern" };
  return { status: "unbestimmt", regel: null, quelle: "keine" };
}

export type CrawlerBewertung = KiCrawler & RobotsBewertung;

/** Alle Bots der Referenzliste gegen ein robots.txt bewerten. */
export function bewerteAlleCrawler(robotsTxt: string): CrawlerBewertung[] {
  return KI_CRAWLER.map((c) => ({ ...c, ...bewerteRobots(robotsTxt, c.name) }));
}
