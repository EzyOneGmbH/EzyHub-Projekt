import { describe, expect, it } from "vitest";
import { adsPaketLabel, adsPaketVon, istAdsPaket, mitAdsPaket } from "./adsPakete";

describe("adsPakete", () => {
  it("liest das Paket aus metadata, unbekannte Werte = kein Paket", () => {
    expect(adsPaketVon({ ads_package: "medium" })).toBe("medium");
    expect(adsPaketVon({ ads_package: "Premium" })).toBe("premium");
    expect(adsPaketVon({ ads_package: "performance" })).toBe("premium");
    expect(adsPaketVon({ ads_package: "gold" })).toBeNull();
    expect(adsPaketVon(null)).toBeNull();
    expect(adsPaketVon({})).toBeNull();
  });
  it("setzt und entfernt das Paket, ohne andere metadata-Felder zu verlieren", () => {
    const meta = { first_party_kpi: true, tags: ["a"] };
    const gesetzt = mitAdsPaket(meta, "starter");
    expect(gesetzt).toEqual({ first_party_kpi: true, tags: ["a"], ads_package: "starter" });
    expect(meta).toEqual({ first_party_kpi: true, tags: ["a"] });
    expect(mitAdsPaket(gesetzt, null)).toEqual({ first_party_kpi: true, tags: ["a"] });
  });
  it("Labels und Validierung", () => {
    expect(adsPaketLabel("premium")).toBe("Premium");
    expect(adsPaketLabel(null)).toBe("Kein Paket");
    expect(istAdsPaket("medium")).toBe(true);
    expect(istAdsPaket("")).toBe(false);
  });
});
