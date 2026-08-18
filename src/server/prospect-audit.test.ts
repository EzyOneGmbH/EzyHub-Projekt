import { describe, it, expect } from "vitest";
import { normDomain, retryPatch, uebernahmeErlaubt, gleicheDomain } from "./prospect-audit.server";

describe("Job-Idempotenz & Dubletten (Haertung 18.08.)", () => {
  it("normDomain normalisiert Schreibweisen auf denselben Schluessel", () => {
    expect(normDomain("https://www.Ezyone.ch/pfad?x=1")).toBe("ezyone.ch");
    expect(normDomain("EZYONE.CH")).toBe("ezyone.ch");
  });

  it("gleicheDomain erkennt Kunden-Dubletten unabhaengig von www/https", () => {
    expect(gleicheDomain("https://www.faithinhumanity.ch/", "faithinhumanity.ch")).toBe(true);
    expect(gleicheDomain("faithinhumanity.ch", "faithinhumanity.info")).toBe(false);
    expect(gleicheDomain("", "")).toBe(false); // leer darf NIE matchen
  });
});

describe("Retry-Uebergaenge", () => {
  it("setzt fehlgeschlagene Laeufe zurueck und leert nur den Zaehler der Etappe", () => {
    const p = retryPatch({
      status: "fehler",
      stage: "ai2",
      data: { stageFails: { ai2: 3, technik: 1 }, kostenUsd: 1 },
    });
    expect(p).not.toBeNull();
    expect(p.status).toBe("laufend");
    expect(p.error).toBeNull();
    expect(p.data.stageFails).toEqual({ technik: 1 });
    expect(p.data.kostenUsd).toBe(1); // uebrige Daten bleiben erhalten
  });

  it("greift nur bei Status fehler (laufend/fertig unveraendert)", () => {
    expect(retryPatch({ status: "laufend", stage: "ai1", data: {} })).toBeNull();
    expect(retryPatch({ status: "fertig", stage: "score", data: {} })).toBeNull();
    expect(retryPatch({ status: "abgebrochen", stage: "seo", data: {} })).toBeNull();
  });
});

describe("Zugriff Lead-Uebernahme", () => {
  it("erlaubt nur owner/admin", () => {
    expect(uebernahmeErlaubt("owner")).toBe(true);
    expect(uebernahmeErlaubt("admin")).toBe(true);
    expect(uebernahmeErlaubt("member")).toBe(false);
    expect(uebernahmeErlaubt("viewer")).toBe(false);
    expect(uebernahmeErlaubt("")).toBe(false);
  });
});
