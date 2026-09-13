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

// ── Contract-Test (Release-Blocker 13.09.2026): Request-Body strikt nach
//    offizieller Search-Analytics-API — ein Fake-Endpunkt lehnt unbekannte
//    Felder (z. B. orderBy) mit HTTP 400 ab, wie Google es tut.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { baueGscRequest, sortiereNach, GSC_REQUEST_FELDER } from "./gsc.server";

function strengerGsc(nQueries = 40) {
  const calls: any[] = [];
  const erlaubt = new Set<string>(GSC_REQUEST_FELDER);
  const fetchImpl = (async (_url: any, init: any) => {
    const body = JSON.parse(String(init.body));
    calls.push(body);
    const fremd = Object.keys(body).filter((k) => !erlaubt.has(k));
    if (fremd.length)
      return Response.json(
        {
          error: {
            code: 400,
            message: `Invalid JSON payload received. Unknown name "${fremd[0]}"`,
          },
        },
        { status: 400 },
      );
    if (!body.startDate || !body.endDate || !Array.isArray(body.dimensions))
      return Response.json({ error: { code: 400, message: "missing field" } }, { status: 400 });
    if (body.dimensions.length === 0)
      return Response.json({
        rows: [{ keys: [], clicks: 500, impressions: 9000, ctr: 0.05, position: 9 }],
      });
    const start = Number(body.startRow ?? 0);
    const rows = [];
    // nativ nach Klicks absteigend; Impressionen bewusst NICHT monoton
    for (let i = start; i < Math.min(nQueries, start + Number(body.rowLimit)); i++)
      rows.push({
        keys: body.dimensions.map((d: string) => `${d} ${i}`),
        clicks: nQueries - i,
        impressions: (i * 37) % 101,
        ctr: 0.1,
        position: 5,
      });
    return Response.json({ rows });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("Contract: Request-Body = offizielle Search-Analytics-API (kein orderBy)", () => {
  it("baueGscRequest emittiert ausschliesslich Allowlist-Felder", () => {
    const req: any = baueGscRequest(
      {
        site: "s",
        accessToken: "t",
        startDate: "2026-09-01",
        endDate: "2026-09-10",
        filter: { dataState: "all" },
      },
      { dimensions: ["query"], rowLimit: 10, startRow: 0, orderBy: [{ field: "clicks" }], foo: 1 },
    );
    expect(req).toEqual({
      startDate: "2026-09-01",
      endDate: "2026-09-10",
      dimensions: ["query"],
      rowLimit: 10,
      startRow: 0,
      dataState: "all",
    });
    expect("orderBy" in req).toBe(false);
  });

  it("Totale, Query-Zeilen und Query/Page-Zeilen passieren den strengen Endpunkt", async () => {
    const { fetchImpl, calls } = strengerGsc();
    const b = {
      ...basis(fetchImpl),
      filter: {
        dimensionFilterGroups: [
          { filters: [{ dimension: "country" as const, expression: "che" }] },
        ],
      },
    };
    await expect(gscTotals(b)).resolves.toMatchObject({ clicks: 500, quelle: "aggregate" });
    const q = await gscRows({ ...b, dimensions: ["query"], rowLimit: 100, pageSize: 25 });
    expect(q.rows.length).toBe(40);
    const qp = await gscRows({ ...b, dimensions: ["query", "page"], rowLimit: 5000 });
    expect(qp.rows[0].keys).toEqual(["query 0", "page 0"]);
    for (const c of calls) for (const k of Object.keys(c)) expect(GSC_REQUEST_FELDER).toContain(k);
    expect(calls.some((c) => c.dimensionFilterGroups)).toBe(true);
  });

  it("ein unbekanntes Feld wuerde mit 400 abgelehnt (Fake-Endpunkt verhaelt sich wie Google)", async () => {
    const { fetchImpl } = strengerGsc();
    const res = await fetchImpl("x", {
      method: "POST",
      body: JSON.stringify({
        startDate: "2026-09-01",
        endDate: "2026-09-10",
        dimensions: ["query"],
        rowLimit: 5,
        orderBy: [],
      }),
    } as any);
    expect(res.status).toBe(400);
    const txt = await res.text();
    expect(txt).toContain("Unknown name");
    expect(txt).toContain("orderBy");
  });

  it("Klicks kommen nativ sortiert; Impressionen werden lokal sortiert", async () => {
    const { fetchImpl } = strengerGsc();
    const { rows } = await gscRows({ ...basis(fetchImpl), dimensions: ["query"], rowLimit: 100 });
    expect(rows.map((r) => r.clicks)).toEqual([...rows.map((r) => r.clicks)].sort((a, b) => b - a));
    const nachImpr = sortiereNach(rows, "impressions");
    expect(nachImpr.map((r) => r.impressions)).toEqual(
      [...rows.map((r) => r.impressions)].sort((a, b) => b - a),
    );
    expect(nachImpr).not.toBe(rows); // Kopie, Original unveraendert
  });

  it("kein GSC-Aufrufer im Repo sendet mehr orderBy (GSC-Import, Traffic Overview, jobGsc, jobGscQueries, Query/Page)", () => {
    const dateien = [
      "src/routes/api/google.gsc-import.ts",
      "src/routes/api/admin.traffic-overview.ts",
      "src/routes/api/admin.populate.ts",
      "src/routes/api/admin.content-sync.ts",
      "src/routes/api/admin.aivis-sync.ts",
      "src/server/google.functions.ts",
      "src/server/gsc.server.ts",
    ];
    for (const f of dateien) {
      const src = readFileSync(resolve(process.cwd(), f), "utf8");
      // Kommentare duerfen den Begriff erwaehnen; ein Request-Feld `orderBy:` nicht.
      const treffer = src.split("\n").filter((l) => /^\s*orderBy\s*:/.test(l));
      expect({ datei: f, treffer }).toEqual({ datei: f, treffer: [] });
    }
  });
});
