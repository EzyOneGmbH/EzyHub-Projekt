// KI-Referrer-Klassifikation (First-Party GEO, 22.09.2026, Volkan): ordnet
// GA4 sessionSource/sessionMedium einer KI-Engine zu. Isomorph, rein, ohne
// Abhaengigkeiten. Die SQL-Funktion kpi_ki_referrals filtert nur grob vor
// (ILIKE-Liste in der Migration 20260922120000_first_party_geo.sql) — die
// feine Zuordnung passiert hier. Beide Listen muessen deckungsgleich bleiben.
//
// Einschraenkung (bewusst im UI-Hinweis): ein Grossteil der KI-Klicks kommt
// ohne Referrer als «Direct» an, AI-Overview-Klicks zaehlen in GA4 als
// «Organic Search». Die Zahlen hier sind also eine Untergrenze.

export type KiEngine =
  | "ChatGPT"
  | "Perplexity"
  | "Gemini"
  | "Copilot"
  | "Claude"
  | "You.com"
  | "Poe"
  | "Meta AI"
  | "DeepSeek"
  | "Grok"
  | "Phind";

/** Label fuer KI-Traffic, der nur ueber das Medium erkennbar ist. */
export const KI_KANAL_LABEL = "KI-Assistent (Kanal)";

/** Host-Muster je Engine (Substring, case-insensitiv, an Host-Grenze). */
export const KI_HOSTS: ReadonlyArray<{ engine: KiEngine; muster: readonly string[] }> = [
  { engine: "ChatGPT", muster: ["chatgpt.com", "chat.openai.com", "openai.com"] },
  { engine: "Perplexity", muster: ["perplexity.ai"] },
  { engine: "Gemini", muster: ["gemini.google.com", "bard.google.com"] },
  { engine: "Copilot", muster: ["copilot.microsoft.com", "bing.com/chat"] },
  { engine: "Claude", muster: ["claude.ai"] },
  { engine: "You.com", muster: ["you.com"] },
  { engine: "Poe", muster: ["poe.com"] },
  { engine: "Meta AI", muster: ["meta.ai"] },
  { engine: "DeepSeek", muster: ["deepseek.com"] },
  { engine: "Grok", muster: ["grok.com", "x.ai"] },
  { engine: "Phind", muster: ["phind.com"] },
];

/** Medien, die GA4-Setups fuer KI-Traffic vergeben (z. B. per UTM). */
export const KI_MEDIEN: readonly string[] = ["ai-assistant", "ai_assistant", "ai-chat"];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

// Muster muss an einer Host-Grenze beginnen: Anfang, nach "." oder "/".
// Damit trifft «x.ai» nicht «box.ai» und «meta.ai» nicht «zometa.ai».
const HOST_RE = KI_HOSTS.map((h) => ({
  engine: h.engine,
  re: new RegExp(`(^|[./])${h.muster.map(escapeRe).join("|(^|[./])")}`, "i"),
}));

/** Engine aus der Quelle (sessionSource) — null, wenn keine KI-Quelle. */
export function engineAusQuelle(source: string | null | undefined): KiEngine | null {
  const s = String(source ?? "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  for (const h of HOST_RE) if (h.re.test(s)) return h.engine;
  return null;
}

/** Ist das Medium ein KI-Kanal-Medium (ai-assistant, ai_assistant, ai-chat)? */
export function istKiMedium(medium: string | null | undefined): boolean {
  const m = String(medium ?? "")
    .trim()
    .toLowerCase();
  return KI_MEDIEN.includes(m);
}

/**
 * Klassifiziert eine GA4-Quelle/Medium-Kombination:
 *  - Host der Quelle bekannt → Engine-Label
 *  - sonst Medium ai-assistant|ai_assistant|ai-chat → «KI-Assistent (Kanal)»
 *  - sonst null (kein KI-Referral)
 */
export function klassifiziereKiQuelle(
  source: string | null | undefined,
  medium: string | null | undefined,
): string | null {
  const engine = engineAusQuelle(source);
  if (engine) return engine;
  return istKiMedium(medium) ? KI_KANAL_LABEL : null;
}
