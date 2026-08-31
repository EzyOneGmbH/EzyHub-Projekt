// Regression: geteilte KI-Quellen-Erkennung (EzyAI-Attribution +
// Conversions-Tab-Detailliste muessen dieselben Quellen als KI werten).
import { describe, it, expect } from "vitest";
import { ATTR_SOURCE_RE, isAiConvSource } from "./aiSources";

describe("aiSources", () => {
  it("erkennt die KI-Engines auf sessionSource", () => {
    expect(isAiConvSource("chatgpt.com")).toBe(true);
    expect(isAiConvSource("perplexity.ai")).toBe(true);
    expect(isAiConvSource("gemini.google.com")).toBe(true);
    expect(isAiConvSource("copilot.microsoft.com")).toBe(true);
  });

  it("wertet klassische Quellen NICHT als KI", () => {
    expect(isAiConvSource("google")).toBe(false);
    expect(isAiConvSource("(direct)")).toBe(false);
    expect(isAiConvSource("")).toBe(false);
    expect(isAiConvSource(null)).toBe(false);
  });

  it("deckt alle 7 Engines ab (Sync-Wächter zur aivis-Attribution)", () => {
    expect(Object.keys(ATTR_SOURCE_RE).sort()).toEqual([
      "ChatGPT",
      "Claude",
      "Copilot",
      "DeepSeek",
      "Gemini",
      "Grok",
      "Perplexity",
    ]);
  });
});
