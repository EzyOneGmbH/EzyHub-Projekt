// Blog-Dashboard «Themen-Autorität» und «Interne Verlinkung»: reine Helfer und
// die Auswertung gegen ein In-Memory-Supabase. Gelesen werden darf nur das
// eigene Projekt.
import { beforeEach, describe, expect, it, vi } from "vitest";

const P = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
let db: Record<string, any[]>;

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

const { gemeinsameWoerter, interneLinks, strukturAuswertung, themenUebersicht } =
  await import("@/server/blog-struktur.server");

describe("interneLinks", () => {
  it("zählt nur Ziele der eigenen Domain, ohne Doppelte und ohne sich selbst", () => {
    const html = `
      <p><a href="https://www.beispiel.ch/blog/b/">B</a>
      <a class="x" href='/blog/b?utm=1'>B nochmals</a>
      <a href="/kontakt/">Kontakt</a>
      <a href="#abschnitt">Anker</a>
      <a href="https://beispiel.ch/blog/a">selbst</a>
      <a href="https://fremd.ch/x">fremd</a>
      <a href="mailto:hallo@beispiel.ch">Mail</a></p>`;
    expect(interneLinks(html, "https://beispiel.ch/blog/a/", "beispiel.ch").sort()).toEqual([
      "beispiel.ch/blog/b",
      "beispiel.ch/kontakt",
    ]);
  });
  it("liefert ohne Text nichts", () => {
    expect(interneLinks(null, "https://beispiel.ch/a", "beispiel.ch")).toEqual([]);
  });
});

describe("gemeinsameWoerter", () => {
  it("zählt gemeinsame Wörter ab vier Zeichen", () => {
    expect(gemeinsameWoerter("Ferien im Tessin planen", "Tessin: Ferien mit Kindern")).toBe(2);
    expect(gemeinsameWoerter("Tessin", "Wallis")).toBe(0);
  });
});

describe("themenUebersicht", () => {
  it("ordnet Artikel, offene Themen und Chancen den Themen zu", () => {
    const out = themenUebersicht(
      [{ name: "Tessin" }, { name: "Wallis" }],
      [
        { id: "t1", cluster: "Tessin" },
        { id: "t2", cluster: "tessin " },
        { id: "t3", cluster: "Wallis" },
        { id: "t4", cluster: null },
        { id: "t5", cluster: "Graubünden" },
      ],
      [
        { topic_id: "t1", status: "live" },
        { topic_id: "t2", status: "entwurf_wp" },
        { topic_id: "t4", status: "live" },
        { topic_id: null, status: "geplant" },
      ],
      [{ cluster: "Wallis" }, { cluster: "Wallis" }, { cluster: null }],
    );
    expect(out.themen).toEqual([
      { name: "Tessin", live: 1, geplant: 1, chancen: 0, stufe: "aufbau" },
      { name: "Wallis", live: 0, geplant: 1, chancen: 2, stufe: "leer" },
      { name: "Graubünden", live: 0, geplant: 1, chancen: 0, stufe: "leer" },
    ]);
    expect(out.ohneThema).toEqual({ live: 1, geplant: 1 });
  });
  it("stuft ein Thema ab drei Live-Artikeln als stark ein", () => {
    const out = themenUebersicht(
      [{ name: "Tessin" }],
      [{ id: "t1", cluster: "Tessin" }],
      [1, 2, 3].map(() => ({ topic_id: "t1", status: "live" })),
      [],
    );
    expect(out.themen[0].stufe).toBe("stark");
  });
});

describe("strukturAuswertung", () => {
  beforeEach(() => {
    db = {
      blog_analysis_runs: [
        { project_id: P, status: "done", result: { clusters: [{ name: "Tessin", seeds: [] }] } },
        { project_id: "anderes", status: "done", result: { clusters: [{ name: "Fremd" }] } },
      ],
      blog_topics: [
        { id: "t1", project_id: P, cluster: "Tessin" },
        { id: "tx", project_id: "anderes", cluster: "Fremd" },
      ],
      keyword_audits: [{ id: "au", project_id: P, status: "done" }],
      keyword_opportunities: [
        { project_id: P, audit_id: "au", cluster: "Tessin", category: "neu", decision: "offen" },
        {
          project_id: P,
          audit_id: "au",
          cluster: "Tessin",
          category: "neu",
          decision: "verworfen",
        },
        {
          project_id: P,
          audit_id: "au",
          cluster: "Tessin",
          category: "abgedeckt",
          decision: "offen",
        },
        { project_id: P, audit_id: "alt", cluster: "Tessin", category: "neu", decision: "offen" },
      ],
      blog_articles: [
        {
          id: "a",
          project_id: P,
          topic_id: "t1",
          status: "live",
          title: "Ferien im Tessin planen",
          wp_permalink: "https://beispiel.ch/blog/a/",
          content_html:
            '<p><a href="/blog/b/">B</a> <a href="/kontakt">Kontakt</a> <a href="https://fremd.ch/">x</a></p>',
          job: { modus: "neu" },
        },
        {
          id: "b",
          project_id: P,
          topic_id: null,
          status: "live",
          title: "Tessin mit Kindern",
          wp_permalink: "https://beispiel.ch/?p=9",
          content_html: "<p>Ohne Links</p>",
          job: { modus: "refresh", brief: { original_url: "https://www.beispiel.ch/blog/b" } },
        },
        {
          id: "ohne-url",
          project_id: P,
          topic_id: null,
          status: "live",
          title: "Nur im Hub",
          wp_permalink: null,
          content_html: "",
        },
        {
          id: "fremd",
          project_id: "anderes",
          topic_id: "tx",
          status: "live",
          title: "Tessin fremd",
          wp_permalink: "https://beispiel.ch/blog/fremd/",
          content_html: '<a href="/blog/a/">A</a>',
        },
      ],
    };
  });

  it("liefert Themen und Verlinkung nur für das eigene Projekt", async () => {
    const out: any = await strukturAuswertung({
      id: P,
      client_id: C,
      domain: "https://www.beispiel.ch/",
      internal_links: 4,
    });
    expect(out.themen).toEqual([
      { name: "Tessin", live: 1, geplant: 0, chancen: 1, stufe: "aufbau" },
    ]);
    expect(out.ohneThema).toEqual({ live: 2, geplant: 0 });
    expect(out.links.ziel).toBe(4);
    const nach = Object.fromEntries(out.links.artikel.map((x: any) => [x.id, x]));
    expect(Object.keys(nach).sort()).toEqual(["a", "b"]);
    // a verlinkt auf b (über die URL des Originals) und auf die Kontaktseite.
    expect(nach.a).toMatchObject({ ausgehend: 2, eingehend: 0 });
    expect(nach.a.vorschlaege).toEqual([{ id: "b", titel: "Tessin mit Kindern" }]);
    expect(nach.b).toMatchObject({ ausgehend: 0, eingehend: 1, vorschlaege: [] });
    expect(JSON.stringify(out)).not.toContain("remd");
  });

  it("kommt ohne Analyse, Audit und Artikel aus", async () => {
    db = {};
    expect(await strukturAuswertung({ id: P, client_id: C, domain: "beispiel.ch" })).toEqual({
      themen: [],
      ohneThema: { live: 0, geplant: 0 },
      stark: 3,
      links: { ziel: 3, artikel: [] },
    });
  });
});
