import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import {
  parseGa4Organisch,
  rankVergleichbar,
  rankVergleichGrund,
  sistrixLandDesLaufs,
  SISTRIX_VERALTET_TAGE,
  stichtagIso,
  waehleSistrixLauf,
} from "./seo-overview.server";

describe("waehleSistrixLauf (Sistrix-Ausfall verdeckt den Vorwert nicht)", () => {
  const l = (id: string, zeit: string, wert: any) => ({ id, created_at: zeit, wert });
  it("neuester Lauf mit Wert bleibt der neueste", () => {
    const r = waehleSistrixLauf([
      l("b", "2026-11-23T04:31:00Z", { visibility_index: 0.0185, country: "ch" }),
      l("a", "2026-11-22T17:16:00Z", { visibility_index: 0.018 }),
    ]);
    expect(r.lauf?.id).toBe("b");
    expect(r.alterTage).toBe(0);
  });
  it("neuester Lauf ohne Sistrix (23.11.2026): Wert vom Vorabend, kein Rueckstand", () => {
    const r = waehleSistrixLauf([
      l("b", "2026-11-23T04:40:00Z", null),
      l("a", "2026-11-22T17:16:00Z", { visibility_index: 0.015, country: "ch" }),
    ]);
    expect(r.lauf?.id).toBe("a");
    expect(r.alterTage).toBe(0);
  });
  it("mehrere Tage Ausfall (12.–15.11.2026): Wert bleibt, Rueckstand wird gemeldet", () => {
    const r = waehleSistrixLauf([
      l("e", "2026-11-15T17:16:00Z", null),
      l("d", "2026-11-15T04:30:00Z", { visibility_index: 0 }),
      l("c", "2026-11-14T04:30:00Z", null),
      l("b", "2026-11-13T04:30:00Z", null),
      l("a", "2026-11-12T04:30:00Z", { visibility_index: 1.2 }),
    ]);
    expect(r.lauf?.id).toBe("a");
    expect(r.alterTage).toBe(3);
    expect(r.alterTage).toBeGreaterThanOrEqual(SISTRIX_VERALTET_TAGE);
  });
  it("kein Lauf mit Wert: neuester Lauf (Hinweis «Kein Sistrix-Wert» bleibt)", () => {
    const r = waehleSistrixLauf([
      l("b", "2026-11-23T04:40:00Z", null),
      l("a", "2026-11-22T17:16:00Z", { visibility_index: 0 }),
    ]);
    expect(r.lauf?.id).toBe("b");
    expect(r.alterTage).toBe(0);
  });
  it("keine Laeufe", () => {
    expect(waehleSistrixLauf([])).toEqual({ lauf: null, alterTage: 0 });
  });
});

describe("sistrixLandDesLaufs", () => {
  it("liest das gespeicherte Land, Altlaeufe ohne Angabe gelten als CH", () => {
    expect(sistrixLandDesLaufs({ wert: { visibility_index: 0.05, country: "fr" } })).toBe("fr");
    expect(sistrixLandDesLaufs({ wert: { visibility_index: 1.2 } })).toBe("ch");
    expect(sistrixLandDesLaufs(null)).toBe("ch");
  });
});

describe("rankVergleichGrund", () => {
  const l = (datum: string, ort: string | null) => ({
    created_at: `${datum}T05:00:00+00:00`,
    wert: { top3: 1, top10: 2 },
    ort,
  });
  it("fehlender Standort auf einer Seite blockiert nicht (kein Wissen = kein Eingriff)", () => {
    expect(
      rankVergleichGrund(l("2026-09-29", "Lucerne,Lucerne,Switzerland"), l("2026-09-22", null)),
    ).toBeNull();
  });
  it("nennt den Grund lesbar", () => {
    expect(rankVergleichGrund(l("2026-09-29", null), l("2026-08-30", null))).toBe(
      "Zählmethode geändert (Hybrid-Zählung → Crawl)",
    );
    expect(
      rankVergleichGrund(
        l("2026-09-29", "Zurich,Zurich,Switzerland"),
        l("2026-09-22", "Switzerland"),
      ),
    ).toBe("Crawl-Standort geändert (Switzerland → Zurich,Zurich,Switzerland)");
  });
});

describe("rankVergleichbar (Methodenwechsel-Guard)", () => {
  // Wie in der DB: aggregate OHNE basis (Snapshot-Schema strippt das Feld).
  const lauf = (
    datum: string,
    ort: string | null = "Zurich,Zurich,Switzerland",
    basis?: string,
  ) => ({
    created_at: `${datum}T05:00:00+00:00`,
    wert: basis ? { top3: 1, top10: 2, basis } : { top3: 1, top10: 2 },
    ort,
  });
  it("beide Laeufe ab 14.09. am selben Standort → vergleichbar", () => {
    expect(rankVergleichbar(lauf("2026-09-29"), lauf("2026-09-22"))).toBe(true);
    expect(rankVergleichbar(lauf("2026-09-29"), lauf("2026-09-14"))).toBe(true);
  });
  it("Vergleichslauf vor 14.09. (Hybrid-Zaehlung) → nicht vergleichbar", () => {
    expect(rankVergleichbar(lauf("2026-09-29"), lauf("2026-08-30"))).toBe(false);
    expect(rankVergleichbar(lauf("2026-09-29"), lauf("2026-09-13"))).toBe(false);
  });
  it("beide Laeufe vor 14.09. am selben Standort → vergleichbar", () => {
    expect(rankVergleichbar(lauf("2026-09-12"), lauf("2026-09-05"))).toBe(true);
  });
  it("anderer Crawl-Standort → nicht vergleichbar", () => {
    expect(rankVergleichbar(lauf("2026-09-29"), lauf("2026-09-22", "Switzerland"))).toBe(false);
  });
  it("gespeichertes basis-Feld hat Vorrang vor dem Datum", () => {
    expect(
      rankVergleichbar(
        lauf("2026-09-29", undefined, "crawl"),
        lauf("2026-09-22", undefined, "gsc"),
      ),
    ).toBe(false);
  });
  it("fehlende Laeufe → nicht vergleichbar", () => {
    expect(rankVergleichbar(null, lauf("2026-09-22"))).toBe(false);
  });
});

const zeile = (land: string, range: string | null, n: number) => ({
  dimensionValues: range ? [{ value: land }, { value: range }] : [{ value: land }],
  metricValues: [{ value: String(n) }],
});

describe("parseGa4Organisch", () => {
  it("summiert je Zeitraum und trennt die Schweiz ab", () => {
    const p = parseGa4Organisch({
      dimensionHeaders: [{ name: "countryId" }, { name: "dateRange" }],
      rows: [
        zeile("CH", "date_range_0", 120),
        zeile("DE", "date_range_0", 30),
        zeile("ch", "date_range_1", 90),
        zeile("AT", "date_range_1", 10),
      ],
    });
    expect(p.cur).toEqual({ total: 150, ch: 120 });
    expect(p.prev).toEqual({ total: 100, ch: 90 });
  });
  it("ohne dateRange-Dimension zaehlt alles zum aktuellen Zeitraum", () => {
    const p = parseGa4Organisch({
      dimensionHeaders: [{ name: "countryId" }],
      rows: [zeile("CH", null, 5), zeile("FR", null, 2)],
    });
    expect(p.cur).toEqual({ total: 7, ch: 5 });
    expect(p.prev).toEqual({ total: 0, ch: 0 });
  });
  it("leere oder kaputte Antwort ergibt Nullen statt Fehler", () => {
    expect(parseGa4Organisch({})).toEqual({ cur: { total: 0, ch: 0 }, prev: { total: 0, ch: 0 } });
    expect(parseGa4Organisch(null)).toEqual({
      cur: { total: 0, ch: 0 },
      prev: { total: 0, ch: 0 },
    });
  });
});

describe("stichtagIso", () => {
  const jetzt = Date.parse("2026-09-29T10:00:00Z");
  it("Sommerzeit: Tagesende Zuerich = 21:59:59.999 UTC", () => {
    expect(stichtagIso("2026-09-20", jetzt)).toBe("2026-09-20T21:59:59.999Z");
  });
  it("Winterzeit: Tagesende Zuerich = 22:59:59.999 UTC", () => {
    expect(stichtagIso("2026-01-15", jetzt)).toBe("2026-01-15T22:59:59.999Z");
  });
  it("heute oder spaeter = neuester Lauf (null)", () => {
    expect(stichtagIso("2026-09-29", jetzt)).toBeNull();
    expect(stichtagIso("2026-10-05", jetzt)).toBeNull();
  });
  it("gestern (Ende von «letzte N Tage») = neuester Lauf, wie die Kacheln", () => {
    expect(stichtagIso("2026-09-28", jetzt)).toBeNull();
  });
  it("vorgestern und aelter bleibt Stichtag", () => {
    expect(stichtagIso("2026-09-27", jetzt)).toBe("2026-09-27T21:59:59.999Z");
  });
  it("kurz nach Mitternacht Schweizer Zeit gilt bereits der neue Tag", () => {
    // 28.09. 22:30 UTC = 29.09. 00:30 in Zuerich → gestern ist der 28.09.
    const nachMitternacht = Date.parse("2026-09-28T22:30:00Z");
    expect(stichtagIso("2026-09-28", nachMitternacht)).toBeNull();
    expect(stichtagIso("2026-09-27", nachMitternacht)).toBe("2026-09-27T21:59:59.999Z");
  });
});
