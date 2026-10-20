import { describe, expect, it } from "vitest";
import { umzuordnungAnwenden, umzuordnungVon } from "./convUmzuordnung";

const meta = {
  conv_umzuordnung: {
    hinweis: "test",
    eintraege: [
      {
        datum: "2026-10-05",
        nummer: "A",
        umsatz: 453.6,
        von: "Unassigned",
        nach: "Organic Search",
      },
      { datum: "2026-10-05", nummer: "B", umsatz: 316, von: "Unassigned", nach: "Organic Search" },
      { datum: "2026-09-01", nummer: "C", umsatz: 100, von: "Unassigned", nach: "Organic Search" },
      { datum: "kaputt", umsatz: 1, nach: "Organic Search" },
    ],
  },
};

const result = {
  range: { from: "2026-10-01", to: "2026-10-20" },
  rows: [
    {
      date: "20261005",
      eventName: "purchase",
      channel: "Unassigned",
      source: "(not set)",
      count: 2,
      value: 769.6,
      country: "Switzerland",
    },
    { date: "20261005", eventName: "mail_click", channel: "Unassigned", count: 1, value: 0 },
  ],
  channels: [
    { channel: "Unassigned", sessions: 9, conversions: 3, revenue: 769.6 },
    { channel: "Organic Search", sessions: 200, conversions: 5, revenue: 151.51 },
  ],
};

describe("convUmzuordnung", () => {
  it("liest nur gültige Einträge", () => {
    expect(umzuordnungVon(meta)?.eintraege.map((e) => e.nummer)).toEqual(["A", "B", "C"]);
    expect(umzuordnungVon({})).toBeNull();
    expect(umzuordnungVon(null)).toBeNull();
  });

  it("verschiebt Buchungen im Zeitraum von Unassigned nach Organic", () => {
    const { result: r, angewendet } = umzuordnungAnwenden(result, umzuordnungVon(meta));
    expect(angewendet.map((e) => e.nummer)).toEqual(["A", "B"]);
    const rows = (r as typeof result).rows as Array<Record<string, unknown>>;
    expect(
      rows.filter((x) => x.eventName === "purchase" && x.channel === "Unassigned"),
    ).toHaveLength(0);
    const org = rows.filter((x) => x.channel === "Organic Search");
    expect(org).toHaveLength(2);
    expect(
      org.every(
        (x) => x.umgeordnet === true && x.source === "google" && x.country === "Switzerland",
      ),
    ).toBe(true);
    expect(rows.some((x) => x.eventName === "mail_click")).toBe(true);
    const ch = (r as typeof result).channels as Array<Record<string, unknown>>;
    expect(ch.find((c) => c.channel === "Unassigned")).toMatchObject({
      conversions: 1,
      revenue: 0,
    });
    expect(ch.find((c) => c.channel === "Organic Search")).toMatchObject({
      conversions: 7,
      revenue: 921.11,
      umgeordnet: 2,
    });
  });

  it("lässt das Ergebnis ohne Treffer unverändert", () => {
    const leer = { ...result, range: { from: "2026-08-01", to: "2026-08-31" } };
    const { result: r, angewendet } = umzuordnungAnwenden(leer, umzuordnungVon(meta));
    expect(angewendet).toHaveLength(0);
    expect(r).toBe(leer);
  });
});
