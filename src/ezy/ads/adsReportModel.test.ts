import { describe, expect, it } from "vitest";
import {
  ausLand,
  conversionZeilen,
  deltaTon,
  herkunft,
  istMarke,
  kennzahlen,
  markenBegriffe,
  topKampagnen,
  wichtigste,
  zielgruppe,
  type Snapshot,
} from "./adsReportModel";

const basis = (report: any = null, over: Partial<Snapshot> = {}): Snapshot => ({
  totals: { cost: 1065, clicks: 3167, impressions: 137224, conversions: 23, conversionValue: 9256 },
  prev: { cost: 1133, clicks: 7690, impressions: 164735, conversions: 20, conversionValue: 8384 },
  campaigns: [
    {
      name: "Brand",
      status: "ENABLED",
      cost: 210,
      clicks: 300,
      impressions: 900,
      conversions: 15,
      conversionValue: 5644,
      roas: 0,
    },
    {
      name: "PMax",
      status: "ENABLED",
      cost: 262,
      clicks: 600,
      impressions: 29000,
      conversions: 4,
      conversionValue: 1468,
      roas: 0,
    },
    {
      name: "Display",
      status: "PAUSED",
      cost: 0,
      clicks: 0,
      impressions: 0,
      conversions: 0,
      conversionValue: 0,
      roas: 0,
    },
  ],
  report,
  ...over,
});
const report = {
  conversionActions: [
    {
      name: "Buchung abgeschlossen",
      category: "PURCHASE",
      booking: true,
      count: 23,
      value: 9256,
      prevCount: 20,
      prevValue: 8384,
    },
    {
      name: "Buchung gestartet",
      category: "BEGIN_CHECKOUT",
      booking: false,
      count: 64,
      value: 0,
      prevCount: 59,
      prevValue: 0,
    },
    {
      name: "Telefon",
      category: "PHONE_CALL_LEAD",
      booking: false,
      count: 41,
      value: 0,
      prevCount: 36,
      prevValue: 0,
    },
  ],
  geo: {
    countries: [
      {
        id: "2756",
        name: "Switzerland",
        countryCode: "CH",
        clicks: 2000,
        impressions: 1,
        conversions: 14,
        value: 5480,
      },
      {
        id: "2276",
        name: "Germany",
        countryCode: "DE",
        clicks: 500,
        impressions: 1,
        conversions: 4,
        value: 1500,
      },
      {
        id: "2380",
        name: "Italy",
        countryCode: "IT",
        clicks: 300,
        impressions: 1,
        conversions: 2,
        value: 700,
      },
      {
        id: "2040",
        name: "Austria",
        countryCode: "AT",
        clicks: 30,
        impressions: 1,
        conversions: 0,
        value: 0,
      },
    ],
    regions: [],
    cities: [
      {
        id: "1",
        name: "Zurich",
        countryCode: "CH",
        clicks: 1,
        impressions: 1,
        conversions: 5,
        value: 2050,
      },
      {
        id: "2",
        name: "Munich",
        countryCode: "DE",
        clicks: 1,
        impressions: 1,
        conversions: 6,
        value: 1000,
      },
    ],
  },
  audience: {
    age: [
      { key: "AGE_RANGE_35_44", conversions: 3, clicks: 10 },
      { key: "AGE_RANGE_45_54", conversions: 1, clicks: 10 },
      { key: "AGE_RANGE_UNDETERMINED", conversions: 4, clicks: 50 },
    ],
    gender: [{ key: "UNDETERMINED", conversions: 2, clicks: 9 }],
    device: [
      { key: "MOBILE", conversions: 6, clicks: 1 },
      { key: "DESKTOP", conversions: 3, clicks: 1 },
      { key: "CONNECTED_TV", conversions: 1, clicks: 1 },
    ],
  },
};

describe("kennzahlen", () => {
  it("Buchungen aus Hauptziel-Aktionen, alle Conversions inkl. Soft", () => {
    const k = kennzahlen(basis(report));
    expect(k.buchungen).toBe(23);
    expect(k.alle).toBe(128);
    expect(k.soft).toBe(105);
    expect(k.d.buchungen).toBe(15);
    expect(Math.round(k.avg)).toBe(402);
    expect(k.d.cpc).toBeGreaterThan(100);
  });
  it("ohne Report-Block: Fallback auf Gesamt-Conversions", () => {
    const k = kennzahlen(basis(null));
    expect(k.buchungen).toBe(23);
    expect(k.alle).toBe(23);
  });
});

describe("deltaTon", () => {
  it("bewertet Richtung je Kennzahl", () => {
    expect(deltaTon(10, "up")).toBe("gut");
    expect(deltaTon(10, "down")).toBe("schlecht");
    expect(deltaTon(-5, "down")).toBe("gut");
    expect(deltaTon(null, "up")).toBe("neutral");
    expect(deltaTon(5, "neutral")).toBe("neutral");
  });
});

describe("topKampagnen / conversionZeilen", () => {
  it("nur Kampagnen mit Umsatz, Anteil am Umsatz", () => {
    const t = topKampagnen(basis());
    expect(t.map((c) => c.name)).toEqual(["Brand", "PMax"]);
    expect(Math.round(t[0].anteil)).toBe(79);
    expect(t[0].roas).toBeCloseTo(26.88, 1);
  });
  it("Conversion-Zeilen mit Anteil, Kosten je Conversion und Kategorie", () => {
    const z = conversionZeilen(basis(report));
    expect(z[0]).toMatchObject({ hauptziel: true, anzahl: 23, delta: 15, kategorie: "Kauf" });
    expect(Math.round(z[1].anteil)).toBe(50);
    expect(z[1].kostenJe).toBeCloseTo(16.64, 1);
    expect(z[1].kategorie).toBe("Buchung gestartet");
  });
});

describe("herkunft / ausLand", () => {
  it("Anteile je Land, Staedte nach Buchungen, deutsche Laendernamen", () => {
    const h = herkunft(basis(report))!;
    expect(h.total).toBe(20);
    expect(h.anzahlLaender).toBe(3);
    expect(Math.round(h.laender[0].anteil)).toBe(70);
    expect(h.laender[0].anzeige).toBe("Schweiz");
    expect(h.staedte[0].name).toBe("Munich");
  });
  it("Artikel bei Laendern", () => {
    expect(ausLand("CH", "Schweiz")).toBe("aus der Schweiz");
    expect(ausLand("US", "USA")).toBe("aus den USA");
    expect(ausLand("DE", "Deutschland")).toBe("aus Deutschland");
  });
});

describe("zielgruppe", () => {
  it("Anteile ohne «unbekannt», Basis Buchungen", () => {
    const z = zielgruppe(basis(report))!;
    expect(z.alter.basis).toBe("conversions");
    expect(z.alter.gruppen.find((g) => g.key === "AGE_RANGE_35_44")!.anteil).toBe(75);
    expect(z.alter.unbekanntAnteil).toBe(50);
    expect(z.geschlecht.leer).toBe(true);
    expect(z.geraet.gruppen.map((g) => g.label)).toEqual([
      "Smartphone",
      "Computer",
      "Tablet",
      "Andere",
    ]);
    expect(z.geraet.gruppen[0].anteil).toBe(60);
  });
});

describe("Marken-Erkennung", () => {
  it("findet markante Namensteile, keine generischen Woerter", () => {
    const m = markenBegriffe("B5 Boutique Hotel", []);
    expect(m).toEqual(["b5"]);
    expect(istMarke("b5 boutique hotel lugano", m)).toBe(true);
    expect(istMarke("hotel lugano", m)).toBe(false);
    expect(istMarke("b52 bar", m)).toBe(false);
    expect(istMarke("la campagnola ascona", markenBegriffe("Hotel La Campagnola"))).toBe(true);
  });
});

describe("wichtigste", () => {
  it("liefert drei Erkenntnisse: Buchungen, Kosten-Effizienz, Herkunft", () => {
    const w = wichtigste(basis(report));
    expect(w).toHaveLength(3);
    expect(w[0]).toMatchObject({ ton: "gut" });
    expect(w[0].titel).toBe("23 Buchungen: 15 % mehr als in der Vorperiode.");
    expect(w[1].ton).toBe("warnung");
    expect(w[1].titel).toMatch(/Klicks sind deutlich teurer geworden/);
    expect(w[2].titel).toBe("70 % der Buchungen kommen aus der Schweiz, vor allem aus Zurich.");
    expect(w[2].text).toBe("Dahinter folgen Deutschland und Italien.");
  });
  it("ohne Buchungen und ohne Geo: Hinweis statt leerer Karte", () => {
    const w = wichtigste(
      basis(null, {
        totals: { cost: 100, clicks: 50, impressions: 900, conversions: 0, conversionValue: 0 },
      }),
    );
    expect(w[0].titel).toBe("Noch keine Buchungen im Zeitraum.");
  });
});
