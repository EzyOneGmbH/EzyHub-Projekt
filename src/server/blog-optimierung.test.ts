import { beforeEach, describe, expect, it, vi } from "vitest";

const P = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const U = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const URL_A = "https://beispiel.ch/blog/a/";
let db: Record<string, any[]>;

function builder(table: string) {
  const st: any = { f: [] as ((r: any) => boolean)[], limit: 0 };
  const rows = () => (db[table] ??= []).filter((r) => st.f.every((f: any) => f(r)));
  const run = () => {
    if (st.insert) {
      const neu = st.insert.map((r: any) => ({ id: crypto.randomUUID(), ...r }));
      (db[table] ??= []).push(...neu);
      return { data: st.single ? neu[0] : neu, error: null };
    }
    let r = rows();
    if (st.update) for (const x of r) Object.assign(x, st.update);
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
    in(k: string, v: any[]) {
      st.f.push((r: any) => v.includes(r[k]));
      return api;
    },
    insert(r: any) {
      st.insert = Array.isArray(r) ? r : [r];
      return api;
    },
    update(r: any) {
      st.update = r;
      return api;
    },
    maybeSingle() {
      st.single = true;
      return Promise.resolve(run());
    },
    single() {
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

const { baueListe, einschaetzung, mitBedarf, starteOptimierung } =
  await import("./blog-optimierung.server");

const agentur: any = { userId: U, clientId: C, organizationId: "o", role: "admin", domain: "x" };
const kunde: any = { ...agentur, role: "viewer" };
const projekt = { id: P, client_id: C, status: "active", domain: "beispiel.ch" };
const heute = new Date("2026-11-25T10:00:00Z");

const live = (mehr: Record<string, unknown> = {}) => ({
  id: A,
  project_id: P,
  status: "live",
  title: "Artikel A",
  wp_permalink: URL_A,
  published_at: "2026-09-01",
  herkunft: "extern",
  ...mehr,
});

describe("einschaetzung", () => {
  it("Ranking-Chance geht vor", () => {
    const e = einschaetzung({
      chance: { keyword: "nothilfe", position: 11.4 },
      indexVerdict: "PASS",
      zuletzt: "2020-01-01",
      heute,
    });
    expect(e.stufe).toBe("hoch");
    expect(e.grund).toContain("Position 11");
    expect(e.grund).toContain("nothilfe");
    // Massnahmen aus allen Befunden: Ranking und Alter
    expect(e.massnahmen[0]).toContain("nothilfe");
    expect(e.massnahmen.join(" ")).toContain("aktuellen Stand");
  });

  it("ohne Befund keine Massnahmen", () => {
    expect(
      einschaetzung({ indexVerdict: "PASS", zuletzt: "2026-10-01", heute }).massnahmen,
    ).toEqual([]);
    expect(
      einschaetzung({ indexVerdict: "FAIL", zuletzt: "2026-10-01", heute }).massnahmen.length,
    ).toBeGreaterThan(0);
  });

  it("nicht indexiert → hoch", () => {
    expect(einschaetzung({ indexVerdict: "FAIL", zuletzt: "2026-10-01", heute }).stufe).toBe(
      "hoch",
    );
  });

  it("älter als 12 Monate → mittel, sonst ok", () => {
    expect(einschaetzung({ zuletzt: "2025-10-01", heute }).stufe).toBe("mittel");
    expect(einschaetzung({ zuletzt: "2026-03-01", indexVerdict: "PASS", heute }).stufe).toBe("ok");
    expect(einschaetzung({ heute }).stufe).toBe("ok");
  });
});

describe("baueListe", () => {
  it("je URL eine Zeile, der Hub-Artikel geht vor dem bestehenden", () => {
    const liste = baueListe({
      articles: [
        live(),
        live({ id: "hub", herkunft: null, wp_permalink: "https://www.beispiel.ch/blog/a" }),
        { id: "x", status: "entwurf_wp", wp_permalink: null },
      ],
      opps: [],
      items: [],
      kunde: false,
      heute,
    });
    expect(liste).toHaveLength(1);
    expect(liste[0].id).toBe("hub");
    expect(liste[0].extern).toBe(false);
  });

  it("zeigt den Stand der Überarbeitung, dem Kunden erst nach der Prüfung", () => {
    const articles = [
      live(),
      { id: "r1", status: "schreibt", opt_url: URL_A, created_at: "2026-11-25T08:00:00Z" },
    ];
    const a = baueListe({ articles, opps: [], items: [], kunde: false, heute });
    expect(a[0].ueberarbeitung).toEqual({ id: "r1", status: "schreibt", zustand: "laeuft" });
    const k = baueListe({ articles, opps: [], items: [], kunde: true, heute });
    expect(k[0].ueberarbeitung).toBeNull();

    const geprueft = [
      live(),
      { id: "r2", status: "entwurf_wp", modus: "refresh", brief_url: URL_A, review: { at: "x" } },
    ];
    const k2 = baueListe({ articles: geprueft, opps: [], items: [], kunde: true, heute });
    expect(k2[0].ueberarbeitung).toEqual({ id: "r2", status: "entwurf_wp", zustand: "bereit" });
  });

  it("sortiert: Optimieren, dann Auffrischen, dann In Ordnung", () => {
    const liste = baueListe({
      articles: [
        live({ id: "ok", wp_permalink: "https://beispiel.ch/ok/", published_at: "2026-10-01" }),
        live({ id: "alt", wp_permalink: "https://beispiel.ch/alt/", published_at: "2024-01-01" }),
        live({ id: "chance", wp_permalink: "https://beispiel.ch/chance/" }),
        live({ id: "index", wp_permalink: "https://beispiel.ch/index/" }),
      ],
      opps: [
        {
          keyword: "kw",
          category: "fast_vorne",
          avg_position: 12,
          impressions: 900,
          covered_by_url: "https://beispiel.ch/chance",
        },
      ],
      items: [{ target_url: "https://beispiel.ch/index/", index_verdict: "FAIL" }],
      kunde: false,
      heute,
    });
    expect(liste.map((z) => z.id)).toEqual(["chance", "index", "alt", "ok"]);
    expect(liste[0].keyword).toBe("kw");
    expect(liste[2].einschaetzung.stufe).toBe("mittel");

    // Anzeige: stabile Artikel fallen weg und werden nur gezählt
    const { artikel, stabil } = mitBedarf(liste);
    expect(artikel.map((z) => z.id)).toEqual(["chance", "index", "alt"]);
    expect(stabil).toBe(1);
    expect(artikel.every((z) => z.einschaetzung.massnahmen.length > 0)).toBe(true);
  });

  it("stabiler Artikel bleibt sichtbar, solange eine Überarbeitung offen ist", () => {
    const liste = baueListe({
      articles: [
        live({ published_at: "2026-10-01" }),
        { id: "r1", status: "entwurf_wp", opt_url: URL_A, created_at: "2026-11-25T08:00:00Z" },
      ],
      opps: [],
      items: [],
      kunde: false,
      heute,
    });
    expect(liste[0].einschaetzung.stufe).toBe("ok");
    expect(mitBedarf(liste)).toMatchObject({ stabil: 0, artikel: [{ id: A }] });
  });
});

describe("starteOptimierung", () => {
  beforeEach(() => {
    db = {
      blog_articles: [
        { ...live(), herkunft: undefined, job: { herkunft: "extern" }, focus_keyword: null },
      ],
      blog_topics: [],
      blog_events: [],
      keyword_audits: [],
      keyword_opportunities: [],
      content_items: [],
    };
  });

  it("nur für die Agentur", async () => {
    expect((await starteOptimierung(projekt, kunde, A)).status).toBe(403);
    expect(db.blog_topics).toHaveLength(0);
  });

  it("nicht ohne gestarteten Autopilot", async () => {
    const a = await starteOptimierung({ ...projekt, status: "draft" }, agentur, A);
    expect(a.status).toBe(409);
  });

  it("fremder oder nicht veröffentlichter Artikel → 404", async () => {
    expect((await starteOptimierung({ ...projekt, id: "anderes" }, agentur, A)).status).toBe(404);
    db.blog_articles[0].status = "entwurf_wp";
    expect((await starteOptimierung(projekt, agentur, A)).status).toBe(404);
  });

  it("Adresse ausserhalb der Kunden-Website → 400", async () => {
    db.blog_articles[0].wp_permalink = "https://fremd.example/blog/a/";
    expect((await starteOptimierung(projekt, agentur, A)).status).toBe(400);
    expect(db.blog_articles).toHaveLength(1);
  });

  it("legt Thema und Artikel mit Bezug zum Original an, kein zweites Mal", async () => {
    db.keyword_audits.push({ id: "au", project_id: P, status: "done" });
    db.keyword_opportunities.push({
      id: "op",
      audit_id: "au",
      keyword: "nothilfe spenden",
      category: "fast_vorne",
      impressions: 500,
      covered_by_url: "https://www.beispiel.ch/blog/a",
    });
    const a = await starteOptimierung(projekt, agentur, A);
    expect(a.status).toBe(200);
    const topic = db.blog_topics[0];
    expect(topic).toMatchObject({
      project_id: P,
      client_id: C,
      kind: "refresh",
      keyword: "nothilfe spenden",
      opportunity_id: "op",
      approved_by: U,
    });
    const neu = db.blog_articles[1];
    expect((a.body.article as any).id).toBe(neu.id);
    expect(neu).toMatchObject({
      topic_id: topic.id,
      status: "freigegeben",
      stage: "brief",
      focus_keyword: "nothilfe spenden",
      job: { trigger: "manuell", optimierung: { url: URL_A, artikel_id: A } },
    });

    const b = await starteOptimierung(projekt, agentur, A);
    expect(b.status).toBe(409);
    expect((b.body.article as any).id).toBe(neu.id);
    expect(db.blog_articles).toHaveLength(2);
  });

  it("ohne Audit: Keyword aus dem Titel", async () => {
    const a = await starteOptimierung(projekt, agentur, A);
    expect(a.status).toBe(200);
    expect(db.blog_topics[0].keyword).toBe("Artikel A");
  });

  it("wartet, wenn schon zwei Artikel geschrieben werden", async () => {
    db.blog_articles.push(
      { id: "s1", project_id: P, status: "schreibt", job: {} },
      { id: "s2", project_id: P, status: "freigegeben", job: {} },
    );
    expect((await starteOptimierung(projekt, agentur, A)).status).toBe(429);
    expect(db.blog_topics).toHaveLength(0);
  });
});
