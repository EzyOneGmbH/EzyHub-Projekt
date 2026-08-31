// KI-Quellen-Erkennung auf GA4 sessionSource (31.08.2026, aus
// AIVisibilityDashboard extrahiert — Single Source fuer EzyAI-Attribution
// UND die Conversions-Tab-Detailliste; identisch zur Server-Seite ENGINES
// in aivis-sync).
export const ATTR_SOURCE_RE: Record<string, RegExp> = {
  ChatGPT: /chatgpt|openai/i,
  Perplexity: /perplexity/i,
  Gemini: /gemini|bard/i,
  Claude: /claude|anthropic/i,
  Copilot: /copilot|bing/i,
  Grok: /grok|x\.ai/i,
  DeepSeek: /deepseek/i,
};

/** Stammt die GA4-Quelle (sessionSource) von einer KI-Engine? */
export function isAiConvSource(source: unknown): boolean {
  const s = String(source || "");
  if (!s) return false;
  return Object.values(ATTR_SOURCE_RE).some((re) => re.test(s));
}
