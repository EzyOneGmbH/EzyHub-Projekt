import { describe, it, expect } from "vitest";
import {
  normDomain,
  retryPatch,
  fehlerPatch,
  uebernahmeErlaubt,
  gleicheDomain,
  OFFENE_STATUS,
} from "./prospect-audit.server";

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
    // Async-Umbau 21.08.: manueller Retry stellt zurueck in die Queue.
    expect(p.status).toBe("queued");
    expect(p.error).toBeNull();
    expect(p.attempts).toBe(0);
    expect(p.next_retry_at).toBeNull();
    expect(p.failed_at).toBeNull();
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

describe("Begrenztes exponentielles Retry (Async-Umbau 21.08.)", () => {
  const T0 = Date.parse("2026-08-21T12:00:00Z");

  it("1./2. Fehlversuch -> retry mit 1min/2min Wartezeit", () => {
    const p1 = fehlerPatch({ stage: "seo", attempts: 0, max_attempts: 3 }, "Timeout", T0);
    expect(p1.status).toBe("retry");
    expect(p1.attempts).toBe(1);
    expect(Date.parse(p1.next_retry_at) - T0).toBe(60_000);
    const p2 = fehlerPatch({ stage: "seo", attempts: 1, max_attempts: 3 }, "Timeout", T0);
    expect(p2.status).toBe("retry");
    expect(Date.parse(p2.next_retry_at) - T0).toBe(120_000);
  });

  it("ab max_attempts endgueltig fehlgeschlagen (failed_at gesetzt, kein Retry)", () => {
    const p = fehlerPatch({ stage: "ai1", attempts: 2, max_attempts: 3 }, "HTTP 500", T0);
    expect(p.status).toBe("fehler");
    expect(p.attempts).toBe(3);
    expect(p.failed_at).toBe(new Date(T0).toISOString());
    expect(p.next_retry_at).toBeNull();
    expect(p.last_error).toContain("ai1 (Versuch 3/3)");
  });

  it("Wartezeit ist auf 30 Minuten gekappt", () => {
    const p = fehlerPatch({ stage: "score", attempts: 9, max_attempts: 99 }, "x", T0);
    expect(Date.parse(p.next_retry_at) - T0).toBe(30 * 60_000);
  });

  it("Fehlermeldung wird begrenzt und traegt Etappe + Versuchszahl", () => {
    const p = fehlerPatch({ stage: "volumen", attempts: 0, max_attempts: 3 }, "y".repeat(900), T0);
    expect(p.last_error.length).toBeLessThanOrEqual(400);
    expect(p.last_error.startsWith("volumen (Versuch 1/3):")).toBe(true);
  });
});

describe("Offene Status (Worker-Aufnahme & Doppelstart-Schluessel)", () => {
  it("queued/laufend/retry sind offen — fehler/abgebrochen/fertig NIE", () => {
    expect([...OFFENE_STATUS]).toEqual(["queued", "laufend", "retry"]);
    for (const st of ["fehler", "abgebrochen", "fertig"]) {
      expect((OFFENE_STATUS as readonly string[]).includes(st)).toBe(false);
    }
  });
});
