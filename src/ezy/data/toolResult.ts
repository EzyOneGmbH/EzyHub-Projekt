// Zentrale Tool-Ergebnis-Normalisierung (EzyRank-Ausbau 2026-08-18).
// Tools liefern je nach Backend verschiedene Formen: Skill-Läufe { content },
// /api/ai/generate { content }, Provider-Antworten (OpenAI choices[],
// Anthropic content-Blöcke) oder verschachtelte { data: { result: ... } }.
// Diese eine Funktion findet den besten lesbaren Markdown-/Text-Inhalt —
// die UI zeigt ihn bevorzugt und legt Rohdaten nur in "Technische Details".

export type NormalizedToolResult = {
  /** Bester lesbarer Inhalt (Markdown/Text) oder null, wenn keiner existiert. */
  text: string | null;
  /** Originalpayload, unverändert — für "Technische Details". */
  raw: unknown;
  /** true, wenn raw ein Objekt/Array ist (Rohdaten-Ansicht lohnt sich). */
  hasStructured: boolean;
};

// Schlüssel in Prioritätsreihenfolge. "message" fehlt BEWUSST: das ist bei
// unseren Routen der Status-Text ("Live-Lauf abgeschlossen"), kein Inhalt.
const TEXT_KEYS = ["content", "markdown", "text", "output", "result", "data", "answer", "completion", "response"] as const;

const MAX_DEPTH = 5;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonEmpty(s: unknown): string | null {
  return typeof s === "string" && s.trim() ? s : null;
}

/** Anthropic-artige Block-Arrays: [{ type: "text", text: "..." }, ...]. */
function textFromBlocks(arr: unknown[]): string | null {
  const parts: string[] = [];
  for (const b of arr) {
    if (typeof b === "string") {
      if (b.trim()) parts.push(b);
    } else if (isPlainObject(b) && typeof b.text === "string" && b.text.trim()) {
      parts.push(b.text);
    }
  }
  return parts.length ? parts.join("\n\n") : null;
}

function extractText(v: unknown, depth: number, seen: Set<unknown>): string | null {
  if (depth > MAX_DEPTH) return null;
  const direct = nonEmpty(v);
  if (direct) return direct;
  if (Array.isArray(v)) return textFromBlocks(v);
  if (!isPlainObject(v)) return null;
  if (seen.has(v)) return null;
  seen.add(v);

  // OpenAI-artig: { choices: [{ message: { content } } | { text }] }
  const choices = v.choices;
  if (Array.isArray(choices) && choices.length) {
    const c0 = choices[0];
    if (isPlainObject(c0)) {
      const viaMessage = isPlainObject(c0.message) ? extractText(c0.message, depth + 1, seen) : null;
      const found = viaMessage ?? nonEmpty(c0.text);
      if (found) return found;
    }
  }

  for (const key of TEXT_KEYS) {
    if (!(key in v)) continue;
    const found = extractText(v[key], depth + 1, seen);
    if (found) return found;
  }
  return null;
}

export function normalizeToolResult(data: unknown): NormalizedToolResult {
  const text = extractText(data, 0, new Set());
  return {
    text,
    raw: data,
    hasStructured: typeof data === "object" && data !== null,
  };
}
