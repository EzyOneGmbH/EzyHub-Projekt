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

const { eigeneUrl, kiAuswertung, messBasis, ordneZu, sammleZitate, urlSchluessel } =
  await import("@/server/blog-ki.server");

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

  it("meldet ohne Messung «nicht gemessen»", async () => {
    db.ai_visibility_reports = db.ai_visibility_reports.filter((r) => r.client_id !== C);
    expect(await kiAuswertung({ id: P, client_id: C })).toEqual({ gemessen: false });
  });
});
