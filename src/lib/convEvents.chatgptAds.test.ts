import { describe, expect, it } from "vitest";
import { chatgptAdsInKiKanal } from "./convEvents";

describe("chatgptAdsInKiKanal (Kunden-Option ezyai_ads_in_organic)", () => {
  const kanaele = [
    { channel: "Direct", sessions: 2336, conversions: 11, revenue: 6109 },
    { channel: "Paid Other", sessions: 182, conversions: 0, revenue: 0 },
    { channel: "Paid Search", sessions: 1016, conversions: 2, revenue: 1223 },
    { channel: "AI Assistant", sessions: 29, conversions: 0, revenue: 0 },
  ];
  it("verschiebt ChatGPT Ads aus Paid nach AI Assistant, Summe bleibt", () => {
    const out = chatgptAdsInKiKanal(kanaele, {
      "Paid Other": { sessions: 170, conversions: 0, revenue: 0 },
      "Paid Search": { sessions: 32, conversions: 1, revenue: 100 },
    });
    const by = Object.fromEntries(out.map((c) => [c.channel, c]));
    expect(by["AI Assistant"].sessions).toBe(231);
    expect(by["AI Assistant"].conversions).toBe(1);
    expect(by["Paid Other"].sessions).toBe(12);
    expect(by["Paid Search"].sessions).toBe(984);
    const sum = (l: typeof kanaele) => l.reduce((a, c) => a + c.sessions, 0);
    expect(sum(out)).toBe(sum(kanaele));
  });
  it("legt AI Assistant an, wenn es fehlt; ohne Daten unverändert", () => {
    const ohne = kanaele.filter((c) => c.channel !== "AI Assistant");
    const out = chatgptAdsInKiKanal(ohne, {
      "Paid Other": { sessions: 5, conversions: 0, revenue: 0 },
    });
    expect(out.find((c) => c.channel === "AI Assistant")?.sessions).toBe(5);
    expect(chatgptAdsInKiKanal(kanaele, null)).toBe(kanaele);
    expect(
      chatgptAdsInKiKanal(kanaele, { Referral: { sessions: 9, conversions: 0, revenue: 0 } }),
    ).toBe(kanaele);
  });
});
