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

  it("erkennt Hotel-Buchungsmaschinen (Mews) und Buchungs-Pfade als crossdomain", () => {
    const html = `
      <a href="https://app.mews.com/distributor/abc123">Jetzt buchen</a>
      <a href="https://booking-engine.example.com/buchen?hotel=ava">Zimmer reservieren</a>
      <a href="https://www.tripadvisor.com/Hotel_Ava">Bewertungen</a>
    `;
    const { candidates } = extractFromHtml(html, "https://hotel-ava.ch/zimmer/", "hotel-ava.ch");
    const cross = candidates.filter((c) => c.candidate_type === "crossdomain");
    expect(cross.map((c) => c.raw_value).sort()).toEqual([
      "app.mews.com",
      "booking-engine.example.com",
    ]);
    // Tripadvisor (Bewertungsportal, kein Checkout) bleibt aussen vor.
    expect(candidates.some((c) => c.raw_value.includes("tripadvisor"))).toBe(false);
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

  it("erkennt interne CTAs (Aktions-Label oder Button-Klasse) als 'cta'-Kandidaten", () => {
    const html = `
      <a href="/kontakt/">Kontakt aufnehmen</a>
      <a class="elementor-button" href="/zimmer/">Zu den Zimmern</a>
      <a href="/ueber-uns/">Über uns</a>
      <a href="/impressum/">Impressum</a>
      <a href="/">Jetzt buchen</a>
      <a class="elementor-button" href="/blog/artikel-1/">Weiter lesen</a>
      <a class="btn" href="/blog/artikel-2/">Continue reading</a>
    `;
    const { candidates } = extractFromHtml(html, PAGE, SITE);
    const ctas = candidates.filter((c) => c.candidate_type === "cta");
    expect(ctas.map((c) => c.raw_value).sort()).toEqual([
      "https://faithinhumanity.ch/kontakt/",
      "https://faithinhumanity.ch/zimmer/",
    ]);
    // «Über uns» (kein Aktionswort), Impressum und Startseite bleiben draussen.
  });

  it("externer CTA-Link zaehlt als crossdomain, Social-Follows nicht", () => {
    const html = `
      <a href="https://partnershop.example.com/produkt">Jetzt kaufen</a>
      <a href="https://www.instagram.com/fih">Jetzt folgen</a>
    `;
    const { candidates } = extractFromHtml(html, PAGE, SITE);
    const cross = candidates.filter((c) => c.candidate_type === "crossdomain");
    expect(cross.map((c) => c.raw_value)).toEqual(["partnershop.example.com"]);
  });

  it("bildet conv_page_-Eventnamen fuer cta-Kandidaten", () => {
    expect(buildDestinationEvent("cta", "https://faithinhumanity.ch/kontakt/")).toBe(
      "conv_page_kontakt",
    );
    expect(buildDestinationEvent("cta", "https://x.ch/")).toBe("conv_page_seite");
  });

  it("Wunschname wird slugifiziert zum GA4-Eventnamen (Umlaute, Laenge, Reserved-Guard)", () => {
    expect(buildDestinationEvent("mailto", "info@x.ch", "Mitglied werden")).toBe("mitglied_werden");
    expect(buildDestinationEvent("crossdomain", "donate.raisenow.io", "Spende für Kinder")).toBe(
      "spende_fuer_kinder",
    );
    // Kollision mit GA4-Systemevents wird entschaerft.
    expect(buildDestinationEvent("crossdomain", "x.ch", "Purchase")).toBe("conv_purchase");
    // Zahl am Anfang bekommt Buchstaben-Praefix; Laenge bleibt <= 40.
    const long = buildDestinationEvent("tel", "+41413698181", "1 sehr langer Name ".repeat(5));
    expect(/^[a-z]/.test(long)).toBe(true);
    expect(long.length).toBeLessThanOrEqual(40);
    // Leerer/unbrauchbarer Wunschname faellt auf den Auto-Namen zurueck.
    expect(buildDestinationEvent("tel", "+41413698181", "  ")).toBe("conv_tel_nr_8181");
  });
});
