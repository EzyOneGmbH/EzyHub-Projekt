// Bezahlter KI-Traffic (02.10.2026): ChatGPT Ads (chatgpt / cpc) und andere
// bezahlte Kanaele zaehlen nicht als organische KI-Besucher.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("@/server/google-tokens.server", () => ({ getGoogleAccessToken: async () => ({}) }));
vi.mock("@/server/google-oauth.server", () => ({ redactSecrets: (e: unknown) => String(e) }));

describe("istBezahlt", () => {
  it("erkennt bezahlte GA4-Standardkanaele", async () => {
    const { istBezahlt } = await import("./aivis-attribution.server");
    for (const k of [
      "Paid Search",
      "Paid Other",
      "Paid Social",
      "Paid Shopping",
      "Paid Video",
      "Cross-network",
    ])
      expect(istBezahlt(k)).toBe(true);
  });
  it("laesst organische und KI-Kanaele durch", async () => {
    const { istBezahlt } = await import("./aivis-attribution.server");
    for (const k of [
      "Referral",
      "Organic Search",
      "Direct",
      "AI Assistant",
      "Unassigned",
      "",
      "(other)",
    ])
      expect(istBezahlt(k)).toBe(false);
  });
  it("erkennt bezahltes Medium, falls kein Kanal da ist", async () => {
    const { istBezahlt } = await import("./aivis-attribution.server");
    expect(istBezahlt("", "cpc")).toBe(true);
    expect(istBezahlt("", "paid_social")).toBe(true);
    expect(istBezahlt("", "referral")).toBe(false);
    expect(istBezahlt("", "ai-assistant")).toBe(false);
  });
});
