// Blog-Dashboard «Wirkung je Artikel»: Zeiträume, Seitenfilter und die
// Auswertung gegen ein In-Memory-Supabase. Abgefragt werden darf nur die
// Property und die Domain des eigenen Kunden.
import { beforeEach, describe, expect, it, vi } from "vitest";

const P = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FREMD = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
let db: Record<string, any[]>;
let tokenFuer: string[];
let aufrufe: any[];
let gscFehler: boolean;

function builder(table: string) {
  const st: any = { f: [] as ((r: any) => boolean)[], limit: 0 };
  const run = () => {
    let r = (db[table] ??= []).filter((x) => st.f.every((f: any) => f(x)));
    if (st.limit) r = r.slice(0, st.limit);
    return { data: st.single ? (r[0] ?? null) : r, error: null };
  };
  const api: any = {
    select: () => api,
    order: () => api,
    limit(n: number) {
      st.limit = n;
      return api;
    },
    eq(k: string, v: any) {
      st.f.push((r: any) => r[k] === v);
      return api;
    },
    maybeSingle() {
      st.single = true;
      return Promise.resolve(run());
    },
    then(res: any, rej: any) {
      return Promise.resolve(run()).then(res, rej);
    },
  };
  return api;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => builder(t) },
}));
vi.mock("@/server/google-tokens.server", () => ({
  getGoogleAccessToken: async (clientId: string) => {
    tokenFuer.push(clientId);
    return { accessToken: "tok", connectionId: "x", email: null };
  },
}));
vi.mock("@/server/gsc.server", async (orig) => ({
  ...(await orig<typeof import("@/server/gsc.server")>()),
  gscTotals: async (b: any) => {
    aufrufe.push(b);
    if (gscFehler) throw new Error("sc-domain:geheim.ch nicht erlaubt");
    const nach = b.startDate >= "2026-10-01";
    return {
      clicks: nach ? 30 : 10,
      impressions: nach ? 900 : 400,
      ctr: 0.03,
      position: nach ? 8.2 : 14.5,
      quelle: "aggregate",
    };
  },
}));

const { seitenMuster, wirkungAuswertung, wirkungFenster } =
  await import("@/server/blog-wirkung.server");

const HEUTE = new Date("2026-11-13T10:00:00Z");

describe("wirkungFenster", () => {
  it("misst höchstens 28 Tage ab dem Live-Tag und gleich viele davor", () => {
    expect(wirkungFenster("2026-10-01T08:00:00Z", HEUTE)).toEqual({
      tage: 28,
      nach: { startDate: "2026-10-01", endDate: "2026-10-28" },
      vor: { startDate: "2026-09-03", endDate: "2026-09-30" },
    });
  });
  it("kürzt bei jungen Artikeln auf die vorhandenen Tage", () => {
    // Letzter Tag mit Daten: 10.11. (drei Tage Verzug).
    expect(wirkungFenster("2026-11-06T08:00:00Z", HEUTE)).toEqual({
      tage: 5,
      nach: { startDate: "2026-11-06", endDate: "2026-11-10" },
      vor: { startDate: "2026-11-01", endDate: "2026-11-05" },
    });
  });
  it("liefert null, solange Google noch keine Daten hat", () => {
    expect(wirkungFenster("2026-11-12T08:00:00Z", HEUTE)).toBeNull();
    expect(wirkungFenster(null, HEUTE)).toBeNull();
    expect(wirkungFenster("kein Datum", HEUTE)).toBeNull();
  });
});

describe("seitenMuster", () => {
  it("trifft genau die Seite, mit und ohne www. und Schrägstrich", () => {
    const re = new RegExp(seitenMuster("https://www.beispiel.ch/blog/tessin-tipps/?x=1"));
    expect(re.test("https://beispiel.ch/blog/tessin-tipps")).toBe(true);
    expect(re.test("https://www.beispiel.ch/blog/tessin-tipps/")).toBe(true);
    expect(re.test("https://beispiel.ch/blog/tessin-tipps-2/")).toBe(false);
    expect(re.test("https://beispiel.ch/blog/tessin-tipps/seite")).toBe(false);
    expect(re.test("https://beispielxch/blog/tessin-tipps")).toBe(false);
  });
  it("liefert nichts ohne gültige URL", () => {
    expect(seitenMuster("")).toBe("");
    expect(seitenMuster("ftp://beispiel.ch/a")).toBe("");
  });
});

describe("wirkungAuswertung", () => {
  beforeEach(() => {
    tokenFuer = [];
    aufrufe = [];
    gscFehler = false;
    db = {
      clients: [
        { id: C, gsc_property: "sc-domain:beispiel.ch" },
        { id: FREMD, gsc_property: "sc-domain:fremd.ch" },
      ],
      blog_articles: [
        {
          id: "neu",
          project_id: P,
          status: "live",
          title: "Neuer Artikel",
          wp_permalink: "https://beispiel.ch/blog/neu/",
          published_at: "2026-10-01T08:00:00Z",
          job: { modus: "neu" },
        },
        {
          id: "refresh",
          project_id: P,
          status: "live",
          title: "Überarbeitung",
          wp_permalink: "https://beispiel.ch/?p=99",
          published_at: "2026-10-05T08:00:00Z",
          job: { modus: "refresh", brief: { original_url: "https://www.beispiel.ch/alt/" } },
        },
        {
          id: "frisch",
          project_id: P,
          status: "live",
          title: "Von gestern",
          wp_permalink: "https://beispiel.ch/blog/frisch/",
          published_at: "2026-11-12T08:00:00Z",
          job: {},
        },
        {
          id: "fremde-url",
          project_id: P,
          status: "live",
          title: "Falsche Domain",
          wp_permalink: "https://fremd.ch/blog/x/",
          published_at: "2026-10-01T08:00:00Z",
          job: {},
        },
        {
          id: "entwurf",
          project_id: P,
          status: "entwurf_wp",
          title: "Entwurf",
          wp_permalink: "https://beispiel.ch/blog/entwurf/",
          published_at: null,
        },
        {
          id: "anderes-projekt",
          project_id: "anderes",
          status: "live",
          title: "Anderes Projekt",
          wp_permalink: "https://fremd.ch/blog/y/",
          published_at: "2026-10-01T08:00:00Z",
        },
      ],
    };
  });

  it("vergleicht Überarbeitungen mit vorher und fragt nur den eigenen Kunden ab", async () => {
    const out: any = await wirkungAuswertung({ id: P, client_id: C }, HEUTE);
    expect(out.verbunden).toBe(true);
    const nach = Object.fromEntries(out.artikel.map((a: any) => [a.id, a]));
    expect(Object.keys(nach).sort()).toEqual(["fremde-url", "frisch", "neu", "refresh"]);
    expect(nach.neu).toMatchObject({ modus: "neu", tage: 28, vor: null, grund: null });
    expect(nach.neu.nach).toEqual({ clicks: 30, impressions: 900, ctr: 0.03, position: 8.2 });
    expect(nach.refresh).toMatchObject({ modus: "refresh", tage: 28, grund: null });
    expect(nach.refresh.vor).toMatchObject({ clicks: 10, impressions: 400 });
    expect(nach.frisch).toMatchObject({ grund: "frisch", nach: null });
    expect(nach["fremde-url"]).toMatchObject({ grund: "url", nach: null });

    expect(tokenFuer).toEqual([C]);
    // Ein Abruf für den neuen Artikel, zwei für die Überarbeitung.
    expect(aufrufe).toHaveLength(3);
    for (const b of aufrufe) {
      expect(b.site).toBe("sc-domain:beispiel.ch");
      const muster = b.filter.dimensionFilterGroups[0].filters[0].expression;
      expect(muster).toContain("beispiel\\.ch");
      expect(muster).not.toContain("fremd");
    }
    // Die Überarbeitung wird über die URL des Originals gemessen.
    expect(
      aufrufe.some((b) =>
        b.filter.dimensionFilterGroups[0].filters[0].expression.endsWith("/alt/?$"),
      ),
    ).toBe(true);
  });

  it("gibt bei Google-Fehlern keinen Fehlertext weiter", async () => {
    gscFehler = true;
    const out: any = await wirkungAuswertung({ id: P, client_id: C }, HEUTE);
    expect(out.artikel.find((a: any) => a.id === "neu")).toMatchObject({
      grund: "fehler",
      nach: null,
    });
    expect(JSON.stringify(out)).not.toContain("geheim");
  });

  it("meldet ohne Search Console «nicht verbunden» und ruft Google nicht auf", async () => {
    db.clients[0].gsc_property = null;
    expect(await wirkungAuswertung({ id: P, client_id: C }, HEUTE)).toEqual({ verbunden: false });
    expect(tokenFuer).toEqual([]);
    expect(aufrufe).toEqual([]);
  });

  it("ruft Google nicht auf, wenn kein Artikel live ist", async () => {
    db.blog_articles = [];
    expect(await wirkungAuswertung({ id: P, client_id: C }, HEUTE)).toEqual({
      verbunden: true,
      tage: 28,
      artikel: [],
    });
    expect(tokenFuer).toEqual([]);
  });
});
