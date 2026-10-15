import { describe, expect, it } from "vitest";
import { buildSeoBericht } from "./seoBericht";

const daten = {
  kunde: "Hotel Test",
  datum: "2026-10-15",
  rank: {
    keywords: [
      { kw: "hotel test", pos: 1, posPrev7: 3, posPrev28: 2, volume: 500 },
      { kw: "spa test", pos: 9, posPrev7: 5, volume: 100 },
    ],
  },
  gscQ: {
    topNonbrandQueries: [{ query: "seminar test", position: 12, impressions: 1000, clicks: 5 }],
  },
  gscSum: { metrics: { clicks: 1234, impressions: 56789, position: 8.4 } },
  traf: {
    channels: [{ channel: "Organic Search", sessions: 2000 }],
    countriesOrganic: [{ country: "Switzerland", sessions: 1500 }],
  },
  conv: {
    breakdownByChannel: { "Organic Search": { phone: 4, mail: 2, contact: 0, maps: 1 } },
    channels: [{ channel: "Organic Search", conversions: 12, revenue: 3400 }],
  },
};

describe("buildSeoBericht", () => {
  it("Monatsreport mit allen Abschnitten", () => {
    const { title, markdown } = buildSeoBericht("monatsreport", daten);
    expect(title).toBe("SEO-Monatsreport – Hotel Test – 15.10.2026");
    expect(markdown).toContain("**Organische Besuche (GA4):** 2’000 (davon 1’500 aus der Schweiz)");
    expect(markdown).toContain("**1** Suchbegriffe in den Top 3, **2** in den Top 10");
    expect(markdown).toContain("- hotel test: Platz 3 → **1**");
    expect(markdown).toContain("- spa test: Platz 5 → **9**");
    expect(markdown).toContain("4 Anrufe, 2 Mail-Klicks, 1 Routenplaner");
    expect(markdown).toContain("Umsatz CHF 3’400");
    expect(markdown).toContain("**seminar test** — Ø Platz 12");
    expect(markdown).not.toContain("<");
  });

  it("Quick-Wins ohne Cluster-Lauf bleibt lesbar", () => {
    const { markdown } = buildSeoBericht("quickwins", { kunde: "X", datum: "2026-10-15" });
    expect(markdown).toContain("Aktuell keine Begriffe auf Platz 5–20.");
    expect(markdown).not.toContain("Kannibalisierung");
  });
});
