// Zeitraum-Vereinheitlichung (13.09.2026): Google-Ads-Fenster, Rankings-
// Methodenwechsel-Guard + Messkontext, Admin-Readiness Google-Verbindung.
import { describe, it, expect } from "vitest";
import { adsFenster } from "./google-ads.server";
import { guardMethodenwechsel, baueSnapshotResult } from "@/routes/api/admin.rank-snapshot";
import { googleVerbunden } from "@/routes/api/admin.client-readiness";
import { tageInklusiv } from "@/lib/date-range";

describe("Google Ads: aktuelles Fenster und Vergleichsfenster", () => {
  it("«letzte N Tage» = genau N Tage, Vergleich gleich lang und nahtlos (1/7/28/30)", () => {
    for (const days of [1, 7, 28, 30]) {
      const { aktuell, vorher } = adsFenster(days);
      expect(aktuell.days).toBe(days);
      expect(tageInklusiv(aktuell.startDate, aktuell.endDate)).toBe(days);
      expect(vorher.days).toBe(days);
      expect(tageInklusiv(vorher.startDate, vorher.endDate)).toBe(days);
      expect(Date.parse(vorher.endDate)).toBe(Date.parse(aktuell.startDate) - 864e5);
    }
  });

  it("exakter historischer Range wird 1:1 uebernommen; Vergleich exakt, wenn angegeben", () => {
    const { aktuell, vorher } = adsFenster(
      { startDate: "2025-02-01", endDate: "2025-02-28" },
      { start: "2024-02-01", end: "2024-02-29" },
    );
    expect(aktuell).toMatchObject({ startDate: "2025-02-01", endDate: "2025-02-28", days: 28 });
    expect(vorher).toMatchObject({ startDate: "2024-02-01", endDate: "2024-02-29", days: 29 });
  });

  it("ohne Vergleichsangabe: Vorperiode ueber die Monatsgrenze", () => {
    const { vorher } = adsFenster({ startDate: "2026-03-01", endDate: "2026-03-31" });
    // 31 Tage rueckwaerts ab 28.02. (Februar 2026 hat 28 Tage) → 29.01.
    expect(vorher).toMatchObject({ startDate: "2026-01-29", endDate: "2026-02-28", days: 31 });
  });
});

describe("Rankings-Snapshot: Methodenwechsel-Guard und Messkontext", () => {
  const basis = {
    client: "test",
    date: "2026-09-13",
    crawlLocation: "Lucerne,Lucerne,Switzerland",
    aggregate: {
      tracked: 3,
      top3: 1,
      top10: 2,
      pos11to20: 0,
      notRanking: 1,
      improved7: 99,
      declined7: 99,
      avgPos: 5,
    },
    keywords: [
      // Crawl heute, Vergleich aus GSC-Ø → Delta verworfen
      {
        kw: "hotel luzern",
        pos: 3,
        posSrc: "crawl" as const,
        posPrev7: 8,
        posPrev7Src: "gsc" as const,
        posPrev28: 2,
        posPrev28Src: "crawl" as const,
      },
      // gleiche Methode → Delta bleibt (verbessert)
      {
        kw: "seminar luzern",
        pos: 5,
        posSrc: "gsc" as const,
        posPrev7: 9,
        posPrev7Src: "gsc" as const,
        posPrev28: null,
      },
      // aeltere Pusher ohne Methode des Vergleichswerts → unveraendert (verschlechtert)
      { kw: "spa luzern", pos: 12, posSrc: "crawl" as const, posPrev7: 10 },
      { kw: "nicht rankend", pos: null, posPrev7: 4, posPrev7Src: "gsc" as const },
    ],
  };

  it("verwirft Deltas ueber Methodengrenzen, behaelt gleiche Methode, zaehlt improved/declined neu", () => {
    const g = guardMethodenwechsel(basis);
    expect(g.keywords[0].posPrev7).toBeNull();
    expect(g.keywords[0].posPrev28).toBe(2);
    expect(g.keywords[1].posPrev7).toBe(9);
    expect(g.keywords[2].posPrev7).toBe(10);
    expect(g.keywords[3].posPrev7).toBe(4); // ohne heutige Position kein Vergleich, Wert bleibt informativ
    expect(g.aggregate.improved7).toBe(1);
    expect(g.aggregate.declined7).toBe(1);
    expect(g.aggregate.tracked).toBe(3);
  });

  it("bewahrt crawlLocation, Methode (hybrid), Land, Sprache, Geraet und Messdatum", () => {
    const r: any = baueSnapshotResult({
      ...guardMethodenwechsel(basis),
      measuredAt: "2026-09-13T04:05:00.000Z",
      device: "mobile",
    });
    expect(r.crawlLocation).toBe("Lucerne,Lucerne,Switzerland");
    expect(r.measurement).toEqual({
      method: "hybrid",
      crawlLocation: "Lucerne,Lucerne,Switzerland",
      country: "CH",
      language: "de",
      device: "mobile",
      measuredAt: "2026-09-13T04:05:00.000Z",
    });
    const nurGsc: any = baueSnapshotResult({
      ...basis,
      keywords: basis.keywords.map((k) => ({ ...k, posSrc: "gsc" as const })),
    });
    expect(nurGsc.measurement.method).toBe("gsc");
    expect(nurGsc.measurement.measuredAt).toBeNull();
  });
});

describe("Admin-Readiness: Google-Verbindung nur je client_id", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";
  it("Verbindung eines anderen Kunden markiert diesen Kunden NICHT als verbunden", () => {
    const rows = [{ provider: "google", client_id: B }];
    expect(googleVerbunden(rows, A)).toBe(false);
    expect(googleVerbunden(rows, B)).toBe(true);
  });
  it("Zeile ohne client_id (org-weit) zaehlt nicht — Datenabrufe laden Tokens nur ueber client_id", () => {
    expect(googleVerbunden([{ provider: "google", client_id: null }], A)).toBe(false);
  });
  it("WordPress-Verbindung desselben Kunden ist keine Google-Verbindung", () => {
    expect(googleVerbunden([{ provider: "wordpress", client_id: A }], A)).toBe(false);
    expect(googleVerbunden(null, A)).toBe(false);
  });
});
