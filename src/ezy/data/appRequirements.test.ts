import { describe, it, expect } from "vitest";
import {
  evaluateReadiness, warneBeimAppAktivieren, warneBeimServiceDeaktivieren,
  warneBeimLocalGrid, type ReadinessSnapshot,
} from "./appRequirements";

const NOW = Date.parse("2026-08-17T12:00:00Z");

function snap(over: Partial<ReadinessSnapshot> = {}): ReadinessSnapshot {
  return {
    appEnabled: {},
    services: {},
    oauth: { google: false, wordpress: false },
    felder: {},
    lastRuns: {},
    portalUsers: 0,
    localGridOn: false,
    standortVorhanden: false,
    now: NOW,
    ...over,
  };
}

describe("evaluateReadiness", () => {
  it("geo ohne GEO-Service ist Fehler, mit Service nur unvollstaendig", () => {
    const ohne = evaluateReadiness(snap()).find((r) => r.app === "geo")!;
    expect(ohne.status).toBe("fehler");
    const mit = evaluateReadiness(snap({ services: { perplexity: true } })).find((r) => r.app === "geo")!;
    expect(mit.status).toBe("unvollstaendig"); // Lauf + Portal fehlen (empfohlen)
  });

  it("ads braucht Service UND Kundennummer (beides kritisch)", () => {
    const r1 = evaluateReadiness(snap({ services: { "google-ads": true } })).find((r) => r.app === "ads")!;
    expect(r1.status).toBe("fehler"); // Kundennummer fehlt
    const r2 = evaluateReadiness(
      snap({ services: { "google-ads": true }, felder: { google_ads_customer: "123-456-7890" } }),
    ).find((r) => r.app === "ads")!;
    expect(r2.status).toBe("unvollstaendig");
  });

  it("deaktivierte App ist deaktiviert, nicht Fehler", () => {
    const r = evaluateReadiness(snap({ appEnabled: { geo: false } })).find((x) => x.app === "geo")!;
    expect(r.status).toBe("deaktiviert");
  });

  it("bereit, wenn alles erfuellt (seo)", () => {
    const r = evaluateReadiness(
      snap({
        oauth: { google: true, wordpress: false },
        felder: { gsc_property: "https://x.ch/", ga4_property: "123" },
        lastRuns: { populate_meta: "2026-08-16T03:00:00Z" },
        portalUsers: 1,
      }),
    ).find((x) => x.app === "seo")!;
    expect(r.status).toBe("bereit");
  });

  it("Datenlauf aelter als das Limit gilt als fehlend", () => {
    const r = evaluateReadiness(
      snap({ services: { perplexity: true }, lastRuns: { canonry_ai_visibility: "2026-07-01T00:00:00Z" }, portalUsers: 1 }),
    ).find((x) => x.app === "geo")!;
    const lauf = r.checks.find((c) => c.id === "run")!;
    expect(lauf.ok).toBe(false);
    expect(lauf.aktion?.id).toBe("datenlauf_starten");
  });
});

describe("Konfigurationsvalidierung", () => {
  it("warnt beim Aktivieren von EzyPerformance ohne Ads-Service", () => {
    const w = warneBeimAppAktivieren("ads", snap());
    expect(w.length).toBeGreaterThanOrEqual(2); // Service + Kundennummer
    expect(w.every((x) => x.kritisch)).toBe(true);
  });

  it("warnt beim Deaktivieren des letzten GEO-Services bei aktivem EzyAI", () => {
    const s = snap({ services: { perplexity: true } });
    expect(warneBeimServiceDeaktivieren("perplexity", s).length).toBe(1);
    // Zweiter GEO-Service vorhanden -> keine Warnung
    const s2 = snap({ services: { perplexity: true, canonry: true } });
    expect(warneBeimServiceDeaktivieren("perplexity", s2).length).toBe(0);
  });

  it("warnt bei Local Grid ohne Standort, nicht mit Standort", () => {
    expect(warneBeimLocalGrid(snap()).length).toBe(1);
    expect(warneBeimLocalGrid(snap({ standortVorhanden: true })).length).toBe(0);
  });

  it("Service-Deaktivierung ohne betroffene App warnt nicht", () => {
    expect(warneBeimServiceDeaktivieren("bing", snap({ services: { bing: true } })).length).toBe(0);
  });
});
