import { describe, expect, it } from "vitest";
import { adsKachelnAusOverview, adsKachelnAusSnapshots } from "./adsKacheln";

describe("adsKachelnAusOverview", () => {
  it("bildet Kosten, Umsatz und ROAS der Übersichts-Zeile ab", () => {
    const out = adsKachelnAusOverview(
      [{ clientId: "a", cur: { cost: 200, conversionValue: 900 }, error: null }],
      "2026-11-19",
    );
    expect(out).toEqual({ a: { budget: 200, revenue: 900, roas: 4.5, date: "2026-11-19" } });
  });

  it("ROAS 0 ohne Kosten (keine Division durch null)", () => {
    const out = adsKachelnAusOverview(
      [{ clientId: "a", cur: { cost: 0, conversionValue: 50 } }],
      "2026-11-19",
    );
    expect(out.a.roas).toBe(0);
  });

  it("Fehlerzeile: der zuletzt gezeigte Wert bleibt stehen", () => {
    const vorher = { a: { budget: 10, revenue: 20, roas: 2, date: "2026-11-19" } };
    const out = adsKachelnAusOverview(
      [
        { clientId: "a", cur: null, error: "Ads API HTTP 500" },
        { clientId: "b", cur: null, error: "Kein Google-Ads-Konto hinterlegt" },
      ],
      "2026-11-19",
      vorher,
    );
    expect(out).toEqual({ a: vorher.a }); // b ohne Vorwert bleibt leer
  });

  it("verträgt leere Eingaben", () => {
    expect(adsKachelnAusOverview(null, "2026-11-19")).toEqual({});
    expect(adsKachelnAusOverview([{ clientId: null, cur: { cost: 1 } }], "2026-11-19")).toEqual({});
  });
});

describe("adsKachelnAusSnapshots", () => {
  it("je Kunde gewinnt die erste (neueste) Zeile", () => {
    const out = adsKachelnAusSnapshots([
      {
        client_id: "a",
        created_at: "2026-11-19T09:21:46Z",
        t: { cost: 300, conversionValue: 600 },
        roas: 2,
      },
      {
        client_id: "a",
        created_at: "2026-11-19T05:21:10Z",
        t: { cost: 1, conversionValue: 1 },
        roas: 1,
      },
      { client_id: "b", created_at: "2026-11-18T21:20:00Z", t: null, roas: null },
    ]);
    expect(out).toEqual({
      a: { budget: 300, revenue: 600, roas: 2, date: "2026-11-19" },
      b: { budget: 0, revenue: 0, roas: 0, date: "2026-11-18" },
    });
  });
});
