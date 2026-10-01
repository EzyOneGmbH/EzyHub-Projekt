import { describe, expect, it } from "vitest";
import { generatedUmsatz, isFunnelEvent } from "./convEvents";

describe("isFunnelEvent", () => {
  it("Funnel-Schritte sind keine Conversions", () => {
    expect(isFunnelEvent("begin_checkout")).toBe(true);
    expect(isFunnelEvent("add_to_cart")).toBe(true);
    expect(isFunnelEvent("view_item_list")).toBe(true);
  });
  it("Abschluesse und Leads bleiben", () => {
    expect(isFunnelEvent("purchase")).toBe(false);
    expect(isFunnelEvent("checkout_complete")).toBe(false);
    expect(isFunnelEvent("phone_click")).toBe(false);
    expect(isFunnelEvent(null)).toBe(false);
  });
});

describe("generatedUmsatz", () => {
  // Morosani 04.09.–01.10.2026 (gekuerzt)
  const kanaele = [
    { channel: "Direct", revenue: 4772 },
    { channel: "Paid Search", revenue: 21573 },
    { channel: "Organic Search", revenue: 10149.9 },
    { channel: "AI Assistant", revenue: 120 },
  ];
  it("EzyRank: nur Organic Search statt Gesamtumsatz", () => {
    expect(generatedUmsatz(kanaele, false, 45731)).toEqual({ umsatz: 10149.9, organisch: true });
  });
  it("EzyAI: Organic Search plus AI Assistant", () => {
    expect(generatedUmsatz(kanaele, true, 45731)).toEqual({ umsatz: 10269.9, organisch: true });
  });
  it("ohne Kanal-Split oder Kanal-Umsatz: Gesamtumsatz, als nicht organisch markiert", () => {
    expect(generatedUmsatz(null, false, 500)).toEqual({ umsatz: 500, organisch: false });
    expect(generatedUmsatz([{ channel: "Organic Search" }], false, 500)).toEqual({
      umsatz: 500,
      organisch: false,
    });
  });
  it("organischer Kanal ohne Umsatz = 0, nicht Gesamtumsatz", () => {
    expect(generatedUmsatz([{ channel: "Organic Search", revenue: 0 }], false, 900)).toEqual({
      umsatz: 0,
      organisch: true,
    });
  });
});
