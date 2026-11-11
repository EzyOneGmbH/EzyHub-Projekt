// Blog-Autopilot Phase 3: Planung und Takt der Schreib-Pipeline gegen ein
// In-Memory-Supabase. Prüft «Keine Generierung ohne freigegebenes Thema»
// (Kap. 10) und den Vorlauf «bis morgen».
import { beforeEach, describe, expect, it, vi } from "vitest";

const P = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
let db: Record<string, any[]>;

function builder(table: string) {
  const st: any = { f: [] as ((r: any) => boolean)[], limit: 0 };
  const rows = () => (db[table] ??= []).filter((r) => st.f.every((f: any) => f(r)));
  const run = () => {
    if (st.insert) {
      const neu = st.insert.map((r: any) => ({ id: crypto.randomUUID(), ...r }));
      if (table === "blog_articles")
        for (const n of neu)
          if (n.topic_id && db[table].some((a) => a.topic_id === n.topic_id))
            return { data: null, error: { message: "duplicate key value violates unique" } };
      db[table].push(...neu);
      return { data: st.single ? neu[0] : neu, error: null };
    }
    let r = rows();
    if (st.del) {
      db[table] = db[table].filter((x) => !r.includes(x));
      return { data: null, error: null };
    }
    if (st.update) for (const x of r) Object.assign(x, st.update);
    if (st.limit) r = r.slice(0, st.limit);
    return { data: st.single ? (r[0] ?? null) : r, error: null };
  };
  const api: any = {
    select: () => api,
    order: () => api,
    or: () => api, // Lock-Filter: im Test immer frei
    limit(n: number) {
      st.limit = n;
      return api;
    },
    eq(k: string, v: any) {
      st.f.push((r: any) => r[k] === v);
      return api;
    },
    in(k: string, a: any[]) {
      st.f.push((r: any) => a.includes(r[k]));
      return api;
    },
    not(k: string, _op: string, _v: any) {
      st.f.push((r: any) => r[k] !== null && r[k] !== undefined);
      return api;
    },
    lte(k: string, v: any) {
      st.f.push((r: any) => r[k] <= v);
      return api;
    },
    gte(k: string, v: any) {
      st.f.push((r: any) => r[k] >= v);
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
    delete() {
      st.del = true;
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

const { planeArtikel, tickeBlogArtikel, datumZuerich } = await import("./blog-pipeline.server");

const JETZT = new Date("2026-11-11T07:00:00Z");

beforeEach(() => {
  db = {
    blog_projects: [{ id: P, client_id: C, status: "active", domain: "faithinhumanity.ch" }],
    blog_topics: [
      // freigegeben, heute → wird eingeplant
      {
        id: "t1",
        project_id: P,
        client_id: C,
        keyword: "a",
        approved_at: "x",
        scheduled_for: "2026-11-11",
      },
      // freigegeben, morgen → wird eingeplant (Vorlauf)
      {
        id: "t2",
        project_id: P,
        client_id: C,
        keyword: "b",
        approved_at: "x",
        scheduled_for: "2026-11-12",
      },
      // freigegeben, übermorgen → noch nicht
      {
        id: "t3",
        project_id: P,
        client_id: C,
        keyword: "c",
        approved_at: "x",
        scheduled_for: "2026-11-13",
      },
      // NICHT freigegeben → nie
      {
        id: "t4",
        project_id: P,
        client_id: C,
        keyword: "d",
        approved_at: null,
        scheduled_for: "2026-11-11",
      },
    ],
    blog_articles: [],
    blog_events: [],
  };
});

describe("planeArtikel", () => {
  it("plant freigegebene Themen bis morgen ein, einmal pro Thema", async () => {
    expect(datumZuerich(JETZT, 1)).toBe("2026-11-12");
    expect(await planeArtikel(JETZT)).toBe(2);
    expect(db.blog_articles.map((a) => a.topic_id).sort()).toEqual(["t1", "t2"]);
    expect(db.blog_articles.every((a) => a.status === "freigegeben" && a.stage === "brief")).toBe(
      true,
    );
    expect(await planeArtikel(JETZT)).toBe(0);
    expect(db.blog_articles).toHaveLength(2);
  });

  it("pausierte Projekte bekommen keine Artikel", async () => {
    db.blog_projects[0].status = "paused";
    expect(await planeArtikel(JETZT)).toBe(0);
  });
});

describe("tickeBlogArtikel", () => {
  it("keine Generierung ohne freigegebenes Thema", async () => {
    db.blog_articles.push({
      id: "a1",
      project_id: P,
      client_id: C,
      topic_id: "t4",
      status: "freigegeben",
      stage: "brief",
      job: {},
      attempts: 2,
    });
    const r = await tickeBlogArtikel(120_000);
    expect(r.fehler).toBe(1);
    const a = db.blog_articles[0];
    expect(a.status).toBe("fehler");
    expect(a.error).toMatch(/nicht freigegeben/);
    expect(a.content_html).toBeUndefined();
    expect(db.blog_events.some((e) => e.type === "article.failed")).toBe(true);
  });
});
