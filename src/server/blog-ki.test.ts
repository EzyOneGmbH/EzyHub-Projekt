// Blog-Dashboard «KI-Sichtbarkeit»: Zitate der eigenen Domain sammeln und den
// Live-Artikeln zuordnen. Die Auswertung läuft gegen ein In-Memory-Supabase und
// darf nie Daten eines anderen Kunden lesen.
import { beforeEach, describe, expect, it, vi } from "vitest";

const P = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FREMD = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
let db: Record<string, any[]>;

function builder(table: string) {
  const st: any = { f: [] as ((r: any) => boolean)[], limit: 0, range: null };
  const run = () => {
    let r = (db[table] ??= []).filter((x) => st.f.every((f: any) => f(x)));
    if (st.range) r = r.slice(st.range[0], st.range[1] + 1);
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
    range(a: number, b: number) {
      st.range = [a, b];
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

const {
  besucherListe,
  eigeneUrl,
  frageStaende,
  grundKlar,
  kiAuswertung,
  messBasis,
  ordneZu,
  sammleZitate,
  systemStaende,
  urlSchluessel,
  wettbewerbListe,
} = await import("@/server/blog-ki.server");

const PARTS = {
  sa: {
    aio: {
      answers: [
        {
          kw: "hotel tessin see",
          refs: [
            { u: "https://www.beispiel.ch/blog/tessin-tipps/?utm_source=x", d: "beispiel.ch" },
            { u: "https://andere.ch/tessin", d: "andere.ch" },
          ],
        },
      ],
    },
    aim: { answers: [{ kw: "ferien tessin", refs: [{ u: "https://beispiel.ch/hotel" }] }] },
    aiSearch: [
      {
        kw: "bestes hotel tessin",
        engine: "ChatGPT",
        sources: [{ u: "https://beispiel.ch/blog/tessin-tipps?utm_source=chatgpt.com" }],
      },
    ],
    urls: ["https://beispiel.ch/kontakt", "https://beispiel.ch/blog/tessin-tipps"],
  },
};

describe("urlSchluessel", () => {
  it("kürzt auf Host und Pfad", () => {
    expect(urlSchluessel("https://www.Beispiel.ch/Blog/A/?utm_source=chatgpt.com#x")).toBe(
      "beispiel.ch/blog/a",
    );
    expect(urlSchluessel("http://beispiel.ch")).toBe("beispiel.ch");
  });
  it("nimmt nur echte URLs", () => {
    expect(urlSchluessel("Booking.com")).toBe("");
    expect(urlSchluessel(null)).toBe("");
  });
});

describe("eigeneUrl", () => {
  it("erkennt Domain und Subdomain, nicht ähnliche Namen", () => {
    expect(eigeneUrl("https://www.beispiel.ch/a", "beispiel.ch")).toBe(true);
    expect(eigeneUrl("https://blog.beispiel.ch/a", "beispiel.ch")).toBe(true);
    expect(eigeneUrl("https://nichtbeispiel.ch/a", "beispiel.ch")).toBe(false);
    expect(eigeneUrl("https://beispiel.ch.boese.com/a", "beispiel.ch")).toBe(false);
  });
});

describe("sammleZitate", () => {
  it("sammelt nur die eigene Domain, mit Frage und System", () => {
    const z = sammleZitate(
      PARTS,
      [
        {
          prompt: "Wo übernachten im Tessin?",
          platform: "Gemini",
          source_urls: ["Booking.com", "https://beispiel.ch/hotel", "https://andere.ch/x"],
        },
      ],
      "https://www.beispiel.ch/",
    );
    expect(z.every((x) => x.url.includes("beispiel.ch"))).toBe(true);
    expect(z.map((x) => x.system)).toEqual([
      "Google AI Overviews",
      "Google AI Mode",
      "ChatGPT",
      "Gemini",
      "",
      "",
    ]);
    expect(z[3]).toMatchObject({ frage: "Wo übernachten im Tessin?", system: "Gemini" });
  });
  it("liefert nichts ohne Domain oder ohne Daten", () => {
    expect(sammleZitate(PARTS, [], "")).toEqual([]);
    expect(sammleZitate(null, null as any, "beispiel.ch")).toEqual([]);
    expect(sammleZitate({ bc: {}, ca: {} }, [], "beispiel.ch")).toEqual([]);
  });
});

describe("ordneZu", () => {
  it("ordnet Zitate dem Artikel zu und führt den Rest als weitere Seiten", () => {
    const out = ordneZu(sammleZitate(PARTS, [], "beispiel.ch"), [
      { id: "1", titel: "Tessin-Tipps", urls: ["https://beispiel.ch/blog/tessin-tipps/", null] },
      { id: "2", titel: "Nicht zitiert", urls: ["https://beispiel.ch/blog/anderes"] },
    ]);
    expect(out.artikel).toHaveLength(1);
    expect(out.artikel[0]).toMatchObject({
      id: "1",
      url: "https://www.beispiel.ch/blog/tessin-tipps/",
      systeme: ["Google AI Overviews", "ChatGPT"],
    });
    expect(out.artikel[0].fragen).toEqual([
      { frage: "hotel tessin see", system: "Google AI Overviews" },
      { frage: "bestes hotel tessin", system: "ChatGPT" },
    ]);
    expect(out.weitere.map((s) => s.url)).toEqual([
      "https://beispiel.ch/hotel",
      "https://beispiel.ch/kontakt",
    ]);
  });
  it("findet eine Überarbeitung über die URL des Originals", () => {
    const out = ordneZu(
      [{ url: "https://beispiel.ch/alt", frage: "f", system: "ChatGPT" }],
      [{ id: "9", titel: "Refresh", urls: [null, "https://www.beispiel.ch/alt/"] }],
    );
    expect(out.artikel.map((a) => a.id)).toEqual(["9"]);
    expect(out.weitere).toEqual([]);
  });
});

describe("messBasis", () => {
  it("trennt allgemeine Fragen von Fragen nach der Marke", () => {
    expect(
      messBasis([
        { platform: "Gemini", prompt_type: "markt", status: null },
        { platform: "Claude", prompt_type: null, status: "Erwähnt" },
        { platform: "Gemini", prompt_type: "brand", status: "Erwähnt" },
        { platform: "Gemini", prompt_type: "brand", status: "Referenziert" },
        { platform: "Gemini", prompt_type: "brand", status: null },
      ]),
    ).toEqual({ fragen: 2, systeme: ["Claude", "Gemini"], marke: { gefragt: 3, erkannt: 2 } });
  });
  it("kommt ohne Fragen aus", () => {
    expect(messBasis([])).toEqual({ fragen: 0, systeme: [], marke: { gefragt: 0, erkannt: 0 } });
  });
});

const ENG = {
  "0": {
    Grok: { gefragt: 10, beantwortet: 10 },
    Claude: {
      gefragt: 10,
      beantwortet: 0,
      fehler:
        'HTTP 400 {"type":"error","message":"credit balance is too low","request_id":"req_GEHEIM"}',
    },
  },
  "10": {
    Grok: { gefragt: 5, beantwortet: 4 },
    Claude: { gefragt: 5, beantwortet: 0, fehler: "credit balance is too low" },
    Gemini: { gefragt: 5, beantwortet: 0, fehler: "HTTP 429 quota exceeded" },
  },
};

describe("grundKlar", () => {
  it("übersetzt Anbieterfehler in feste Gründe", () => {
    expect(grundKlar("Your credit balance is too low")).toBe("Kein Guthaben");
    expect(grundKlar("HTTP 429 quota exceeded")).toBe("Kontingent erschöpft");
    expect(grundKlar("kein Key gesetzt oder leere Antwort")).toBe("Kein Zugang");
    expect(grundKlar("irgendwas req_123")).toBe("Keine Antwort");
  });
});

describe("systemStaende", () => {
  it("summiert je System, Grund nur für die Agentur und nie als Rohtext", () => {
    const agentur = systemStaende(ENG, true);
    expect(agentur).toEqual([
      { name: "Grok", gefragt: 15, beantwortet: 14 },
      { name: "Claude", gefragt: 15, beantwortet: 0, grund: "Kein Guthaben" },
      { name: "Gemini", gefragt: 5, beantwortet: 0, grund: "Kontingent erschöpft" },
    ]);
    expect(JSON.stringify(agentur)).not.toMatch(/GEHEIM|request_id|HTTP/);
    expect(JSON.stringify(systemStaende(ENG, false))).not.toContain("grund");
  });
  it("kommt ohne Systemstand aus", () => {
    expect(systemStaende(null, true)).toEqual([]);
    expect(systemStaende("x", true)).toEqual([]);
  });
});

describe("frageStaende", () => {
  it("bündelt je Frage, ohne Markenfragen, Fragen mit Nennung zuerst", () => {
    const out = frageStaende([
      { prompt: "Frage A", platform: "Grok", status: null, topic: "Thema 1" },
      { prompt: "Frage A", platform: "Gemini", status: null },
      { prompt: "Frage B", platform: "Grok", status: "Erwähnt" },
      { prompt: "Frage B", platform: "Gemini", status: "Referenziert" },
      { prompt: "Kennst du die Marke?", platform: "Grok", status: "Erwähnt", prompt_type: "brand" },
    ]);
    expect(out.anzahl).toBe(2);
    expect(out.ohneNennung).toBe(1);
    expect(out.fragen).toEqual([
      {
        frage: "Frage B",
        thema: "",
        genannt: true,
        systeme: [
          { name: "Grok", ergebnis: "erwaehnt" },
          { name: "Gemini", ergebnis: "zitiert" },
        ],
      },
      {
        frage: "Frage A",
        thema: "Thema 1",
        genannt: false,
        systeme: [
          { name: "Grok", ergebnis: "nicht" },
          { name: "Gemini", ergebnis: "nicht" },
        ],
      },
    ]);
  });
});

describe("wettbewerbListe", () => {
  const sov = [
    { brand: "Alpha", is_self: false, mentions: 6 },
    { brand: "Eigene AG", is_self: true, mentions: 3 },
    { brand: "Beta", is_self: false, mentions: 3 },
    { brand: "Gesperrt GmbH", is_self: false, mentions: 50 },
    { brand: "", is_self: false, mentions: 9 },
  ];
  it("sortiert nach Nennungen, lässt Ausgeschlossene weg und rechnet den Anteil neu", () => {
    const out = wettbewerbListe(sov, ["gesperrt gmbh"])!;
    expect(out.marken).toEqual([
      { name: "Alpha", nennungen: 6, anteil: 50, selbst: false },
      { name: "Eigene AG", nennungen: 3, anteil: 25, selbst: true },
      { name: "Beta", nennungen: 3, anteil: 25, selbst: false },
    ]);
    expect(out).toMatchObject({ anzahl: 3, rang: 2, eigeneNennungen: 3 });
  });
  it("zeigt die eigene Marke auch ohne Nennung und hinter einer langen Liste", () => {
    const viele = Array.from({ length: 12 }, (_, i) => ({
      brand: `Marke ${i}`,
      is_self: false,
      mentions: 20 - i,
    }));
    const out = wettbewerbListe([...viele, { brand: "Eigene AG", is_self: true, mentions: 0 }])!;
    expect(out.marken).toHaveLength(9);
    expect(out.marken[8]).toEqual({ name: "Eigene AG", nennungen: 0, anteil: 0, selbst: true });
    expect(out).toMatchObject({ anzahl: 13, rang: null, eigeneNennungen: 0 });
  });
  it("schliesst die eigene Marke nie aus und kommt ohne Zeilen aus", () => {
    expect(wettbewerbListe(sov, ["Eigene AG"])!.marken.some((m) => m.selbst)).toBe(true);
    expect(wettbewerbListe([])).toBeNull();
    expect(wettbewerbListe(null as any)).toBeNull();
  });
});

describe("besucherListe", () => {
  const berichte = [
    { id: "neu", snapshot_date: "2026-11-10" },
    { id: "mitte", snapshot_date: "2026-10-16" },
    { id: "alt", snapshot_date: "2026-10-01" },
  ];
  it("nimmt den jüngsten Bericht mit Zeilen und summiert je System", () => {
    const out = besucherListe(
      [
        { report_id: "alt", engine: "ChatGPT", sessions: 99, conversions: 9 },
        { report_id: "mitte", engine: "Perplexity", sessions: 1, conversions: 2 },
        { report_id: "mitte", engine: "ChatGPT", sessions: 3, conversions: 0 },
        { report_id: "mitte", engine: "Claude", sessions: 0, conversions: 0 },
        { report_id: "unbekannt", engine: "Grok", sessions: 500, conversions: 0 },
      ],
      berichte,
    );
    expect(out).toEqual({
      stand: "2026-10-16",
      sitzungen: 4,
      conversions: 2,
      systeme: [
        { name: "ChatGPT", sitzungen: 3, conversions: 0 },
        { name: "Perplexity", sitzungen: 1, conversions: 2 },
      ],
    });
  });
  it("kommt ohne Zeilen aus", () => {
    expect(besucherListe([], berichte)).toBeNull();
    expect(besucherListe(null as any, null as any)).toBeNull();
  });
});

describe("kiAuswertung", () => {
  beforeEach(() => {
    db = {
      clients: [
        { id: C, domain: "beispiel.ch" },
        { id: FREMD, domain: "fremd.ch" },
      ],
      ai_visibility_reports: [
        {
          id: "r-fremd",
          client_id: FREMD,
          snapshot_date: "2026-11-12",
          score: 99,
          citations: 500,
          parts: { sa: { urls: ["https://beispiel.ch/geheim"] } },
        },
        {
          id: "r1",
          client_id: C,
          snapshot_date: "2026-11-10",
          score: 41,
          score_delta: 3,
          mentions: 12,
          mentions_delta: null,
          citations: 5,
          citations_delta: -1,
          cited_pages: 3,
          cited_pages_delta: 0,
          parts: PARTS,
        },
      ],
      ai_visibility_prompts: [
        {
          report_id: "r1",
          client_id: C,
          prompt: "Wo übernachten im Tessin?",
          platform: "Gemini",
          source_urls: ["https://beispiel.ch/blog/tessin-tipps"],
        },
        {
          report_id: "r-fremd",
          client_id: FREMD,
          prompt: "Fremde Frage",
          platform: "Grok",
          source_urls: ["https://beispiel.ch/blog/tessin-tipps"],
        },
      ],
      blog_articles: [
        {
          id: "a1",
          project_id: P,
          status: "live",
          title: "Tessin-Tipps",
          wp_permalink: "https://beispiel.ch/blog/tessin-tipps/",
        },
        {
          id: "a2",
          project_id: P,
          status: "entwurf_wp",
          title: "Entwurf",
          wp_permalink: "https://beispiel.ch/hotel",
        },
      ],
    };
  });

  it("liefert Kennzahlen und Zitate nur für den eigenen Kunden", async () => {
    const out: any = await kiAuswertung({ id: P, client_id: C });
    expect(out).toMatchObject({
      gemessen: true,
      stand: "2026-11-10",
      score: 41,
      scoreDelta: 3,
      erwaehnungen: 12,
      erwaehnungenDelta: null,
      zitate: 5,
      zitateDelta: -1,
      seiten: 3,
      artikelLive: 1,
      basis: { fragen: 1, systeme: ["Gemini"], marke: { gefragt: 0, erkannt: 0 } },
    });
    expect(out.artikel).toHaveLength(1);
    expect(out.artikel[0].systeme).toEqual(["Google AI Overviews", "ChatGPT", "Gemini"]);
    const text = JSON.stringify(out);
    expect(text).not.toContain("Fremde Frage");
    expect(text).not.toContain("geheim");
    // Der Entwurf ist kein Live-Artikel: seine Seite bleibt unter «weitere».
    expect(out.weitere.map((s: any) => s.url)).toContain("https://beispiel.ch/hotel");
  });

  it("liefert Verlauf, Systemstand und Fragen, den Grund nur der Agentur", async () => {
    db.ai_visibility_reports.push({
      id: "r0",
      client_id: C,
      snapshot_date: "2026-11-03",
      score: 30,
      mentions: 8,
      citations: 2,
    });
    db.ai_visibility_reports[1].parts = { ...PARTS, eng: ENG };
    const kunde: any = await kiAuswertung({ id: P, client_id: C });
    expect(kunde.verlauf).toEqual([
      { datum: "2026-11-03", score: 30, erwaehnungen: 8, zitate: 2 },
      { datum: "2026-11-10", score: 41, erwaehnungen: 12, zitate: 5 },
    ]);
    expect(kunde.systemStand.map((x: any) => x.name)).toEqual(["Grok", "Claude", "Gemini"]);
    expect(JSON.stringify(kunde)).not.toMatch(/"grund"|GEHEIM|credit balance/);
    expect(kunde.fragenAnzahl).toBe(1);
    expect(kunde.fragenOhneNennung).toBe(1);
    expect(kunde.fragen[0].frage).toBe("Wo übernachten im Tessin?");
    const agentur: any = await kiAuswertung({ id: P, client_id: C }, { agentur: true });
    expect(agentur.systemStand[1]).toMatchObject({ name: "Claude", grund: "Kein Guthaben" });
    expect(JSON.stringify(agentur)).not.toMatch(/GEHEIM|credit balance|Fremde Frage/);
  });

  it("liefert Wettbewerber und KI-Besucher nur für den eigenen Kunden", async () => {
    db.clients[0].ga4_property = "properties/1";
    db.ai_visibility_reports.push({ id: "r0", client_id: C, snapshot_date: "2026-11-03" });
    db.ai_visibility_sov = [
      { report_id: "r1", client_id: C, brand: "Beispiel", is_self: true, mentions: 2 },
      { report_id: "r1", client_id: C, brand: "Konkurrent", is_self: false, mentions: 6 },
      { report_id: "r1", client_id: C, brand: "Raus AG", is_self: false, mentions: 40 },
      { report_id: "r0", client_id: C, brand: "Alte Marke", is_self: false, mentions: 7 },
      {
        report_id: "r-fremd",
        client_id: FREMD,
        brand: "Fremde Marke",
        is_self: false,
        mentions: 9,
      },
    ];
    db.ai_visibility_competitors = [
      { client_id: C, name: "Raus AG", active: false },
      { client_id: FREMD, name: "Konkurrent", active: false },
    ];
    db.ai_visibility_attribution = [
      {
        report_id: "r0",
        client_id: C,
        engine: "ChatGPT",
        sessions: 4,
        conversions: 1,
        visitors: [{ country: "Geheimland", sessions: 4 }],
        events: [{ name: "geheim_event" }],
      },
      { report_id: "r-fremd", client_id: FREMD, engine: "Grok", sessions: 700, conversions: 70 },
    ];
    const out: any = await kiAuswertung({ id: P, client_id: C });
    expect(out.wettbewerb.marken.map((m: any) => m.name)).toEqual(["Konkurrent", "Beispiel"]);
    expect(out.wettbewerb).toMatchObject({ rang: 2, anzahl: 2, eigeneNennungen: 2 });
    expect(out.analyticsVerbunden).toBe(true);
    expect(out.besucher).toEqual({
      stand: "2026-11-03",
      sitzungen: 4,
      conversions: 1,
      systeme: [{ name: "ChatGPT", sitzungen: 4, conversions: 1 }],
    });
    expect(JSON.stringify(out)).not.toMatch(
      /Fremde Marke|Raus AG|Alte Marke|Geheimland|geheim_event|700|properties/,
    );
  });

  it("kommt ohne Vergleich und ohne Besuche aus", async () => {
    const out: any = await kiAuswertung({ id: P, client_id: C });
    expect(out.wettbewerb).toBeNull();
    expect(out.besucher).toBeNull();
    expect(out.analyticsVerbunden).toBe(false);
  });

  it("meldet ohne Messung «nicht gemessen»", async () => {
    db.ai_visibility_reports = db.ai_visibility_reports.filter((r) => r.client_id !== C);
    expect(await kiAuswertung({ id: P, client_id: C })).toEqual({ gemessen: false });
  });
});
