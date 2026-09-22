// KI-Referrer-Klassifikation (22.09.2026): Host-Muster je Engine, Medium-
// Fallback, Host-Grenzen (kein Treffer in Fremd-Hosts), Leerwerte.
import { describe, it, expect } from "vitest";
import { KI_KANAL_LABEL, engineAusQuelle, istKiMedium, klassifiziereKiQuelle } from "./ai-referrer";

describe("klassifiziereKiQuelle — Hosts", () => {
  it.each([
    ["chatgpt.com", "ChatGPT"],
    ["chat.openai.com", "ChatGPT"],
    ["openai.com", "ChatGPT"],
    ["www.perplexity.ai", "Perplexity"],
    ["gemini.google.com", "Gemini"],
    ["bard.google.com", "Gemini"],
    ["copilot.microsoft.com", "Copilot"],
    ["bing.com/chat", "Copilot"],
    ["claude.ai", "Claude"],
    ["you.com", "You.com"],
    ["poe.com", "Poe"],
    ["meta.ai", "Meta AI"],
    ["chat.deepseek.com", "DeepSeek"],
    ["grok.com", "Grok"],
    ["x.ai", "Grok"],
    ["phind.com", "Phind"],
  ])("%s → %s", (source, engine) => {
    expect(klassifiziereKiQuelle(source, "referral")).toBe(engine);
  });

  it("case-insensitiv und mit Whitespace", () => {
    expect(klassifiziereKiQuelle("  ChatGPT.com ", "Referral")).toBe("ChatGPT");
    expect(engineAusQuelle("PERPLEXITY.AI")).toBe("Perplexity");
  });

  it("trifft nur an Host-Grenzen: box.ai, zometa.ai, bing.com ohne /chat sind keine KI", () => {
    expect(klassifiziereKiQuelle("box.ai", "referral")).toBeNull();
    expect(klassifiziereKiQuelle("zometa.ai", "referral")).toBeNull();
    expect(klassifiziereKiQuelle("bing.com", "organic")).toBeNull();
    expect(klassifiziereKiQuelle("google", "organic")).toBeNull();
  });

  it("klassische Quellen bleiben null", () => {
    expect(klassifiziereKiQuelle("google", "organic")).toBeNull();
    expect(klassifiziereKiQuelle("(direct)", "(none)")).toBeNull();
    expect(klassifiziereKiQuelle("facebook.com", "social")).toBeNull();
    expect(klassifiziereKiQuelle("", "")).toBeNull();
    expect(klassifiziereKiQuelle(null, undefined)).toBeNull();
  });
});

describe("klassifiziereKiQuelle — Medium", () => {
  it.each(["ai-assistant", "ai_assistant", "ai-chat", "AI-Assistant"])(
    "Medium %s ohne bekannten Host → KI-Assistent (Kanal)",
    (medium) => {
      expect(klassifiziereKiQuelle("newsletter-tool", medium)).toBe(KI_KANAL_LABEL);
      expect(istKiMedium(medium)).toBe(true);
    },
  );

  it("Medium mit bekanntem Host → Engine aus der Quelle", () => {
    expect(klassifiziereKiQuelle("chatgpt.com", "ai-assistant")).toBe("ChatGPT");
    expect(klassifiziereKiQuelle("perplexity.ai", "ai_assistant")).toBe("Perplexity");
  });

  it("andere Medien sind kein KI-Kanal", () => {
    expect(istKiMedium("referral")).toBe(false);
    expect(istKiMedium("ai")).toBe(false);
    expect(istKiMedium(null)).toBe(false);
  });
});
