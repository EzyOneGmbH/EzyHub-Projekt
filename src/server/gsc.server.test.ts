// GSC-Client (13.09.2026): Totale aus Aggregat-Abfrage, Query-Zeilen paginiert,
// Coverage/Kuerzung gekennzeichnet — gegen einen simulierten GSC-Endpunkt mit
// mehr als 1'000 Queries.
import { describe, it, expect } from "vitest";
import { gscTotals, gscRows, summiereZeilen, GSC_PAGE_MAX } from "./gsc.server";

// Simulierte Property: N Queries, jede mit 1 Klick; Gesamttotale enthalten
// zusaetzlich 500 Klicks aus anonymisierten Queries, die NIE als Zeile kommen.
function fakeGsc(nQueries: number, anonymKlicks = 500) {
  const calls: any[] = [];
  const fetchImpl = (async (_url: any, init: any) => {
    const body = JSON.parse(String(init.body));
    calls.push(body);
    if (!Array.isArray(body.dimensions) || body.dimensions.length === 0) {
      return Response.json({
        rows: [
          {
            keys: [],
            clicks: nQueries + anonymKlicks,
            impressions: (nQueries + anonymKlicks) * 10,
            ctr: 0.1,
            position: 12.3,
          },
        ],
      });
    }
    const start = Number(body.startRow ?? 0);
    const limit = Number(body.rowLimit);
    const rows = [];
    for (let i = start; i < Math.min(nQueries, start + limit); i++)
      rows.push({ keys: [`query ${i}`], clicks: 1, impressions: 10, ctr: 0.1, position: 5 });
    return Response.json({ rows });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const basis = (fetchImpl: typeof fetch) => ({
  site: "sc-domain:test.ch",
  accessToken: "t",
  startDate: "2026-08-17",
  endDate: "2026-09-13",
  fetchImpl,
});

describe("Gesamttotale: separate Abfrage ohne Dimension", () => {
  it("liefert die echten Totale inkl. anonymisierter Queries und markiert die Quelle", async () => {
    const { fetchImpl, calls } = fakeGsc(1500);
    const t = await gscTotals(basis(fetchImpl));
    expect(t).toEqual({
      clicks: 2000,
      impressions: 20000,
      ctr: 0.1,
      position: 12.3,
      quelle: "aggregate",
    });
    expect(calls[0].dimensions).toEqual([]);
    expect(calls[0]).toMatchObject({ startDate: "2026-08-17", endDate: "2026-09-13" });
  });

  it("Summe ueber Query-Zeilen waere zu klein — deshalb nie als Gesamttotale", async () => {
    const { fetchImpl } = fakeGsc(1500);
    const { rows } = await gscRows({ ...basis(fetchImpl), dimensions: ["query"], rowLimit: 1000 });
    expect(summiereZeilen(rows).clicks).toBe(1000); // 1500 Queries, 1000 geliefert, +500 anonym fehlen
  });
});

describe("Query-Zeilen: Pagination und Coverage bei > 1'000 Queries", () => {
  it("rowLimit 1000 bei 1500 Queries → gekuerzt, Anteil ausgewiesen", async () => {
    const { fetchImpl } = fakeGsc(1500);
    const t = await gscTotals(basis(fetchImpl));
    const { rows, coverage } = await gscRows({
      ...basis(fetchImpl),
      dimensions: ["query"],
      rowLimit: 1000,
      totals: t,
    });
    expect(rows.length).toBe(1000);
    expect(coverage).toEqual({
      rowLimit: 1000,
      rows: 1000,
      truncated: true,
      pages: 1,
      clicksAnteil: 0.5,
      impressionsAnteil: 0.5,
    });
  });

  it("rowLimit 5000 mit Seitengroesse 1000 → 2 Seiten, 1500 Zeilen, nicht gekuerzt", async () => {
    const { fetchImpl, calls } = fakeGsc(1500);
    const { rows, coverage } = await gscRows({
      ...basis(fetchImpl),
      dimensions: ["query"],
      rowLimit: 5000,
      pageSize: 1000,
    });
    expect(rows.length).toBe(1500);
    expect(rows[1000].keys[0]).toBe("query 1000");
    expect(coverage).toMatchObject({ rows: 1500, truncated: false, pages: 2, rowLimit: 5000 });
    expect(calls.map((c) => c.startRow)).toEqual([0, 1000]);
    expect(calls[1].rowLimit).toBe(1000);
  });

  it("genau rowLimit Zeilen vorhanden → letzte Seite voll = als gekuerzt markiert (konservativ)", async () => {
    const { fetchImpl } = fakeGsc(1000);
    const { coverage } = await gscRows({
      ...basis(fetchImpl),
      dimensions: ["query"],
      rowLimit: 1000,
    });
    expect(coverage.truncated).toBe(true);
    expect(coverage.rows).toBe(1000);
  });

  it("weniger Zeilen als Limit → nicht gekuerzt, Seitengroesse auf API-Maximum gekappt", async () => {
    const { fetchImpl, calls } = fakeGsc(30);
    const { coverage } = await gscRows({
      ...basis(fetchImpl),
      dimensions: ["query"],
      rowLimit: 100_000,
      pageSize: 999_999,
    });
    expect(coverage).toMatchObject({ rows: 30, truncated: false, pages: 1 });
    expect(calls[0].rowLimit).toBe(GSC_PAGE_MAX);
  });

  it("HTTP-Fehler werden als GscFehler mit Status geworfen", async () => {
    const fetchImpl = (async () =>
      new Response("nope", { status: 403 })) as unknown as typeof fetch;
    await expect(gscTotals(basis(fetchImpl))).rejects.toMatchObject({ status: 403 });
  });
});
