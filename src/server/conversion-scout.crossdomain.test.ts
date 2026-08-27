// Regression: Cross-Domain-Checkout-Erkennung (RaiseNow & Co.) im Scout.
// Sichert, dass externe Zahlungs-/Spenden-Ziele als eigener Kandidatentyp
// 'crossdomain' (raw_value = Host) erkannt werden, eigene Domain-Familie und
// gewoehnliche externe Links aber NICHT.
import { describe, it, expect } from "vitest";
import { extractFromHtml } from "./conversion-scout.server";
import { buildDestinationEvent } from "./ga4-conversion-deploy.server";

const SITE = "faithinhumanity.ch";
const PAGE = "https://faithinhumanity.ch/mitglied-werden/";

describe("Conversion-Scout Cross-Domain-Erkennung", () => {
  it("erkennt den RaiseNow-Spendenlink als crossdomain-Kandidat (raw_value = Host)", () => {
    const html = `
      <a href="https://donate.raisenow.io/wrqqr">Als Mitglied beitreten</a>
      <a href="https://www.linkedin.com/company/fih">LinkedIn</a>
      <a href="https://faithinhumanity.ch/ueber-uns/">Über uns</a>
      <a href="https://faithinhumanity.ch/flyer.pdf">Flyer</a>
    `;
    const { candidates } = extractFromHtml(html, PAGE, SITE);
    const cross = candidates.filter((c) => c.candidate_type === "crossdomain");
    expect(cross).toHaveLength(1);
    expect(cross[0].raw_value).toBe("donate.raisenow.io");

    // Social-Link ist KEIN Kandidat; interner PDF-Download schon (anderer Typ).
    expect(candidates.some((c) => c.raw_value.includes("linkedin"))).toBe(false);
    expect(candidates.some((c) => c.candidate_type === "download")).toBe(true);
  });

  it("flaggt weder eigene Domain-Familie noch generische externe Links", () => {
    const html = `
      <a href="https://shop.faithinhumanity.ch/x">eigener Shop-Subdomain</a>
      <a href="https://www.stadtgossau.ch">Partner</a>
      <a href="https://x.com/fih">X</a>
    `;
    const { candidates } = extractFromHtml(html, PAGE, SITE);
    expect(candidates.filter((c) => c.candidate_type === "crossdomain")).toHaveLength(0);
  });

  it("bildet einen GA4-konformen Eventnamen fuer crossdomain (conv_ext_-Praefix)", () => {
    const name = buildDestinationEvent("crossdomain", "donate.raisenow.io");
    expect(name).toBe("conv_ext_donate_raisenow_io");
    expect(name.length).toBeLessThanOrEqual(40);
    expect(/^[a-z]/.test(name)).toBe(true);
  });
});
