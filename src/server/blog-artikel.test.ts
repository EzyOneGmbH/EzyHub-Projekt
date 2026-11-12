// Blog-Autopilot Phase 3, Etappe 2: Artikel prüfen. Bearbeiten, «Änderungen an
// WordPress senden», Status-Abgleich und Freigabe gegen ein In-Memory-Supabase.
import { beforeEach, describe, expect, it, vi } from "vitest";

const P = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const U = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
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
vi.mock("@/server/ezyrank-wp.server", async (orig) => ({
  ...((await orig()) as object),
  ezrRequest: vi.fn(),
}));
vi.mock("@/server/secretbox.server", async (orig) => ({
  ...((await orig()) as object),
  decryptSecret: (s: string) => `klar-${s}`,
}));

const { ezrRequest } = await import("@/server/ezyrank-wp.server");
const {
  artikelSicht,
  bearbeiteArtikel,
  freigabe,
  fuerKundeSichtbar,
  kannVeroeffentlichen,
  pruefeWpStatus,
  saeubereEditorHtml,
  sendeAenderungen,
  ungesendet,
} = await import("./blog-artikel.server");
const { zaehleCta } = await import("./blog-pipeline.server");

const wp = ezrRequest as unknown as ReturnType<typeof vi.fn>;
const LANG = Array.from({ length: 40 }, (_, i) => `Wort${i}`).join(" ");
const TEXT = `<h2>Titel</h2><p>${LANG}</p>`;

const agentur = { userId: U, clientId: C, organizationId: "o", role: "admin", domain: "x" } as any;
const kunde = { ...agentur, role: "viewer" } as any;

function rahmen(artikel: Record<string, unknown> = {}, ctx = agentur, projekt = {}) {
  const article = {
    id: A,
    project_id: P,
    client_id: C,
    status: "entwurf_wp",
    title: "Humanitäre Nothilfe",
    slug: "humanitaere-nothilfe",
    seo_title: "",
    meta_description: "",
    excerpt: "",
    focus_keyword: "nothilfe",
    content_html: TEXT,
    version: 1,
    wp_post_id: 18012,
    wp_edit_url: "https://faithinhumanity.ch/wp-admin/post.php?post=18012",
    wp_permalink: null,
    job: { modus: "neu", wordpress: { at: "2026-11-10T10:00:00.000Z" } },
    ...artikel,
  };
  db.blog_articles = [article];
  Object.assign(db.blog_projects[0], projekt);
  return { article, project: db.blog_projects[0], ctx } as any;
}

/** WordPress-Antworten in der Reihenfolge der Aufrufe. */
function wpAntworten(...antworten: any[]) {
  for (const a of antworten) wp.mockResolvedValueOnce(a);
}
const wpOk = (data: any) => ({ ok: true, status: 200, data });
const HEALTH = wpOk({ plugin_version: "2.0.1" });

beforeEach(() => {
  wp.mockReset();
  db = {
    blog_projects: [
      {
        id: P,
        client_id: C,
        status: "active",
        domain: "faithinhumanity.ch",
        language: "de-CH",
        publish_mode: "wp_draft",
      },
    ],
    blog_articles: [],
    blog_events: [],
    article_versions: [{ article_id: A, version: 1, content_html: TEXT, reason: "erstellt" }],
    wp_connections: [
      {
        project_id: P,
        site_url: "https://faithinhumanity.ch",
        key_enc: "geheim",
        status: "connected",
        plugin_version: "2.0.1",
        scopes: ["read", "draft"],
      },
    ],
  };
});

describe("saeubereEditorHtml", () => {
  it("entfernt Skripte, Handler, style und unbekannte Tags, der Text bleibt", () => {
    expect(
      saeubereEditorHtml(
        '<p style="color:red" onclick="x()">Hallo <font face="a">Welt</font></p><script>alert(1)</script>',
      ),
    ).toBe("<p>Hallo Welt</p>");
  });

  it("baut kein Tag aus Bruchstücken zusammen", () => {
    const out = saeubereEditorHtml("<p>a</p><<x>script>alert(1)<<x>/script>");
    expect(out).not.toMatch(/<\/?script/i);
    const bild = saeubereEditorHtml('<<x>img src="https://a.ch/b.png" onerror="alert(1)">');
    expect(bild).not.toMatch(/onerror/i);
    expect(bild).not.toMatch(/<x/i);
  });

  it("lässt nur sichere Linkziele und Bildquellen zu", () => {
    expect(saeubereEditorHtml('<p><a href="javascript:alert(1)">x</a></p>')).toBe(
      "<p><a>x</a></p>",
    );
    expect(saeubereEditorHtml('<p><a href="https://a.ch/" target="_top">x</a></p>')).toBe(
      '<p><a href="https://a.ch/">x</a></p>',
    );
    expect(saeubereEditorHtml('<img src="http://a.ch/b.png" alt="B">')).toBe('<img alt="B">');
    expect(saeubereEditorHtml('<img src="data:image/svg+xml,x">')).toBe("<img>");
  });

  it("macht aus div einen Absatz, ohne Absatz im Absatz", () => {
    expect(saeubereEditorHtml("<div><p>A</p></div><div>B</div><p><br></p>")).toBe(
      "<p>A</p><p>B</p>",
    );
  });

  it("behält Claim-Markierungen, andere span fallen weg", () => {
    expect(
      saeubereEditorHtml(
        '<p><span data-claim="2">Zahl</span> und <span style="x">Rest <span>innen</span></span></p>',
      ),
    ).toBe('<p><span data-claim="2">Zahl</span> und Rest innen</p>');
  });

  it("eine lose spitze Klammer wird Text", () => {
    expect(saeubereEditorHtml("<p>3 < 5</p>")).toBe("<p>3 &lt; 5</p>");
  });

  it("bringt den CTA in die Form mit Klassen auf den Absätzen", () => {
    const out = saeubereEditorHtml(
      '<div class="ezyrank-cta"><p>Jetzt helfen</p><p><a class="ezyrank-cta-button" href="https://faithinhumanity.ch/spenden/">Spenden</a></p></div>',
    );
    expect(out).toContain('<p class="ezyrank-cta ezyrank-cta-text">Jetzt helfen</p>');
    expect(out).toContain('<p class="ezyrank-cta ezyrank-cta-button"><a href=');
    expect(out).not.toMatch(/<div/);
    expect(zaehleCta(out)).toBe(1);
  });
});

describe("Sicht und Sichtbarkeit", () => {
  it("der Kunde sieht den Artikel erst nach der Prüfung", () => {
    expect(fuerKundeSichtbar({ status: "entwurf_wp", job: {} })).toBe(false);
    expect(fuerKundeSichtbar({ status: "entwurf_wp", job: { review: { at: "x" } } })).toBe(true);
    expect(fuerKundeSichtbar({ status: "live", job: {} })).toBe(true);
  });

  it("ungesendet: im Hub bearbeitet nach dem letzten Senden", () => {
    const p = { publish_mode: "wp_draft" };
    const a = (job: any, mehr: any = {}) => ({ wp_post_id: 1, job, ...mehr });
    expect(ungesendet(a({ wordpress: { at: "2026-11-10" } }), p)).toBe(false);
    expect(
      ungesendet(a({ wordpress: { at: "2026-11-10" }, bearbeitet: { at: "2026-11-11" } }), p),
    ).toBe(true);
    expect(
      ungesendet(a({ wordpress: { at: "2026-11-12" }, bearbeitet: { at: "2026-11-11" } }), p),
    ).toBe(false);
    expect(ungesendet(a({ bearbeitet: { at: "2026-11-11" } }, { wp_post_id: null }), p)).toBe(
      false,
    );
    expect(ungesendet(a({ bearbeitet: { at: "2026-11-11" } }), { publish_mode: "hub_only" })).toBe(
      false,
    );
  });

  it("artikelSicht gibt den Job-Zwischenstand nicht heraus", () => {
    const sicht: any = artikelSicht(
      {
        id: A,
        status: "entwurf_wp",
        content_html: TEXT,
        locked_until: "x",
        job: {
          modus: "refresh",
          brief: { original_url: "https://faithinhumanity.ch/a/", gliederung: ["intern"] },
          recherche: { quellen: [{ url: "https://q.ch/", titel: "Q", roh: "intern" }] },
          entwurf: { html: "intern" },
          pruefung: { claims_offen: 0 },
        },
      },
      { publish_mode: "wp_draft" },
    );
    expect(sicht.job).toBeUndefined();
    expect(sicht.locked_until).toBeUndefined();
    expect(sicht.modus).toBe("refresh");
    expect(sicht.original_url).toBe("https://faithinhumanity.ch/a/");
    expect(sicht.quellen).toEqual([{ url: "https://q.ch/", titel: "Q" }]);
    expect(JSON.stringify(sicht)).not.toContain("intern");
  });

  it("live schalten geht nur für neue Artikel mit Scope publish", () => {
    const p = { publish_mode: "wp_draft" };
    expect(kannVeroeffentlichen({ wp_post_id: 1, job: { modus: "neu" } }, p, ["publish"])).toBe(
      true,
    );
    expect(kannVeroeffentlichen({ wp_post_id: 1, job: { modus: "neu" } }, p, ["draft"])).toBe(
      false,
    );
    expect(kannVeroeffentlichen({ wp_post_id: 1, job: { modus: "refresh" } }, p, ["publish"])).toBe(
      false,
    );
  });
});

describe("bearbeiteArtikel", () => {
  it("nur Ezy One, nur vor der Freigabe", async () => {
    expect((await bearbeiteArtikel(rahmen({}, kunde), { title: "Neuer Titel" })).status).toBe(403);
    expect((await bearbeiteArtikel(rahmen({ status: "live" }), { title: "Neu" })).status).toBe(409);
    expect((await bearbeiteArtikel(rahmen({ status: "schreibt" }), { title: "Neu" })).status).toBe(
      409,
    );
  });

  it("im Faktencheck nur Titel und SEO-Felder, nicht der Text", async () => {
    const r = rahmen({ status: "faktencheck" });
    expect((await bearbeiteArtikel(r, { content_html: TEXT + "<p>x</p>" })).status).toBe(409);
    const out = await bearbeiteArtikel(r, { seo_title: "Nothilfe in Afrika" });
    expect(out.body).toMatchObject({ ok: true, geaendert: ["seo_title"], version: 1 });
    expect(db.article_versions).toHaveLength(1);
  });

  it("speichert den Text gesäubert als neue Version", async () => {
    const r = rahmen();
    const out = await bearbeiteArtikel(r, {
      title: "Große Hilfe",
      content_html: `<div onclick="x()"><p>${LANG} Straße <a href="https://www.unocha.org/gho" target="_blank">OCHA</a> und <a href="https://faithinhumanity.ch/spenden/">Spenden</a></p></div><script>alert(1)</script>`,
    });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ geaendert: ["title", "content_html"], version: 2 });
    const a = db.blog_articles[0];
    expect(a.title).toBe("Grosse Hilfe");
    expect(a.content_html).not.toMatch(/onclick|script|<div|ß/);
    expect(a.content_html).toContain(
      '<a href="https://www.unocha.org/gho" rel="nofollow noopener">',
    );
    expect(a.content_html).toContain('<a href="https://faithinhumanity.ch/spenden/">');
    expect(a.word_count).toBeGreaterThan(40);
    expect(a.version).toBe(2);
    expect(a.job.bearbeitet.by).toBe(U);
    expect(db.article_versions[1]).toMatchObject({
      article_id: A,
      version: 2,
      reason: "manuell",
      created_by: U,
    });
    expect(db.blog_events.map((e) => e.type)).toEqual(["article.edited"]);
    expect(ungesendet(a, db.blog_projects[0])).toBe(true);
  });

  it("ohne Änderung keine Version und kein Ereignis", async () => {
    const out = await bearbeiteArtikel(rahmen(), {
      title: "Humanitäre Nothilfe",
      content_html: TEXT,
    });
    expect(out.body).toEqual({ ok: true, geaendert: [] });
    expect(db.article_versions).toHaveLength(1);
    expect(db.blog_events).toHaveLength(0);
  });

  it("lehnt einen zu kurzen Text ab", async () => {
    expect((await bearbeiteArtikel(rahmen(), { content_html: "<p>Nur kurz</p>" })).status).toBe(
      400,
    );
  });
});

describe("sendeAenderungen", () => {
  it("sendet in den gleichen Entwurf, Kommentare und Pings zu", async () => {
    const r = rahmen({
      content_html: `<p><span data-claim="1">${LANG}</span></p>`,
      job: { modus: "refresh", bearbeitet: { at: "2026-11-11T10:00:00.000Z" } },
    });
    wpAntworten(
      wpOk({ status: "draft" }),
      HEALTH,
      wpOk({ post_id: 18012, edit_url: "https://faithinhumanity.ch/e", permalink: null }),
    );
    const out = await sendeAenderungen(r);
    expect(out.status).toBe(200);
    expect(wp.mock.calls.map((c) => `${c[1]} ${c[2]}`)).toEqual([
      "GET /posts/18012",
      "GET /health",
      "POST /posts",
    ]);
    const body = wp.mock.calls[2][3];
    expect(body).toMatchObject({
      external_id: A,
      status: "draft",
      comment_status: "closed",
      ping_status: "closed",
      title: "[Überarbeitung] Humanitäre Nothilfe",
      slug: "humanitaere-nothilfe-ueberarbeitung",
    });
    expect(body.content_html).not.toContain("data-claim");
    // Der Schlüssel geht entschlüsselt an WordPress, nie in die Antwort.
    expect(wp.mock.calls[2][0]).toEqual({
      siteUrl: "https://faithinhumanity.ch",
      key: "klar-geheim",
    });
    expect(JSON.stringify(out.body)).not.toContain("geheim");
    const a = db.blog_articles[0];
    expect(a.wp_edit_url).toBe("https://faithinhumanity.ch/e");
    expect(ungesendet(a, db.blog_projects[0])).toBe(false);
    expect(db.blog_events.map((e) => e.type)).toEqual(["article.wp_synced"]);
  });

  it("überschreibt keinen veröffentlichten Beitrag", async () => {
    wpAntworten(wpOk({ status: "publish" }));
    const out = await sendeAenderungen(rahmen());
    expect(out.status).toBe(409);
    expect(wp).toHaveBeenCalledTimes(1);
  });

  it("nur Ezy One, nur fertige Entwürfe mit WordPress", async () => {
    expect((await sendeAenderungen(rahmen({}, kunde))).status).toBe(403);
    expect((await sendeAenderungen(rahmen({ status: "faktencheck" }))).status).toBe(409);
    expect((await sendeAenderungen(rahmen({ status: "kunde_freigegeben" }))).status).toBe(409);
    expect((await sendeAenderungen(rahmen({ job: { modus: "vorschlag" } }))).status).toBe(409);
    expect((await sendeAenderungen(rahmen({}, agentur, { publish_mode: "hub_only" }))).status).toBe(
      409,
    );
    expect(wp).not.toHaveBeenCalled();
  });

  it("sendet nicht an einen zu alten Connector", async () => {
    wpAntworten(wpOk({ status: "draft" }), wpOk({ plugin_version: "2.0.0" }));
    const out = await sendeAenderungen(rahmen());
    expect(out.status).toBe(502);
    expect(String(out.body.error)).toMatch(/zu alt/);
    expect(wp).toHaveBeenCalledTimes(2);
  });
});

describe("pruefeWpStatus", () => {
  it("ein in WordPress veröffentlichter neuer Artikel wird live", async () => {
    wpAntworten(
      wpOk({
        status: "publish",
        permalink: "https://faithinhumanity.ch/a/",
        modified: "2026-11-12T08:00:00",
      }),
    );
    const out = await pruefeWpStatus(rahmen());
    expect(out.body).toMatchObject({ ok: true, status: "live", wp: { status: "publish" } });
    const a = db.blog_articles[0];
    expect(a).toMatchObject({
      status: "live",
      published_at: "2026-11-12T08:00:00",
      wp_permalink: "https://faithinhumanity.ch/a/",
    });
    expect(a.job.wordpress.status).toBe("publish");
    expect(db.blog_events.map((e) => e.type)).toEqual(["article.published"]);
  });

  it("eine veröffentlichte Überarbeitung bleibt Entwurf im Hub, mit Hinweis", async () => {
    wpAntworten(wpOk({ status: "publish" }));
    const out = await pruefeWpStatus(rahmen({ job: { modus: "refresh" } }));
    expect(out.body.status).toBe("entwurf_wp");
    expect(String(out.body.hinweis)).toMatch(/doppelt/);
    expect(db.blog_articles[0].status).toBe("entwurf_wp");
  });

  it("meldet einen gelöschten Beitrag, statt das Plugin zu verdächtigen", async () => {
    wpAntworten({ ok: false, status: 404, code: "ezr_plugin_missing", message: "x" });
    const out = await pruefeWpStatus(rahmen());
    expect(out.status).toBe(200);
    expect(String(out.body.hinweis)).toMatch(/nicht gefunden/);
    expect(db.blog_articles[0].job.wordpress.status).toBe("fehlt");
  });

  it("WordPress nicht erreichbar: 502, nichts geändert", async () => {
    wpAntworten({ ok: false, status: 0, code: "ezr_unreachable", message: "Zeit abgelaufen" });
    const out = await pruefeWpStatus(rahmen());
    expect(out.status).toBe(502);
    expect(db.blog_articles[0].status).toBe("entwurf_wp");
  });
});

describe("freigabe", () => {
  it("zuerst prüft Ezy One, dann gibt der Kunde frei", async () => {
    expect((await freigabe(rahmen({}, kunde), "approve")).status).toBe(403);
    expect((await freigabe(rahmen({}, kunde), "review")).status).toBe(403);

    const r = rahmen();
    expect((await freigabe(r, "review")).body).toMatchObject({ ok: true, status: "entwurf_wp" });
    expect(db.blog_articles[0].job.review.by).toBe(U);
    expect(fuerKundeSichtbar(db.blog_articles[0])).toBe(true);

    const out = await freigabe({ ...r, ctx: kunde }, "approve");
    expect(out.body).toMatchObject({ ok: true, status: "kunde_freigegeben" });
    expect(String(out.body.hinweis)).toMatch(/in WordPress veröffentlichen/);
    expect(db.blog_articles[0].job.freigabe).toMatchObject({ rolle: "kunde" });
    // Verbindung ohne Scope «publish»: kein Aufruf an WordPress
    expect(wp).not.toHaveBeenCalled();
    expect(db.blog_events.map((e) => e.type)).toEqual(["article.reviewed", "article.approved"]);
  });

  it("die Prüfung lässt sich zurücknehmen", async () => {
    const r = rahmen({ job: { modus: "neu", review: { at: "x", by: U } } });
    await freigabe(r, "review_zurueck");
    expect(db.blog_articles[0].job.review).toBeNull();
    expect((await freigabe({ ...r, ctx: kunde }, "approve")).status).toBe(403);
  });

  it("keine Prüfung und keine Freigabe mit ungesendeten Änderungen", async () => {
    const job = {
      modus: "neu",
      review: { at: "x", by: U },
      wordpress: { at: "2026-11-10T10:00:00.000Z" },
      bearbeitet: { at: "2026-11-11T10:00:00.000Z" },
    };
    expect((await freigabe(rahmen({ job }), "review")).status).toBe(409);
    expect((await freigabe(rahmen({ job }), "approve")).status).toBe(409);
    expect((await freigabe(rahmen({ job }, kunde), "approve")).status).toBe(409);
    expect(db.blog_articles[0].status).toBe("entwurf_wp");
  });

  it("mit Scope publish wird ein neuer Artikel live geschaltet", async () => {
    db.wp_connections[0].scopes = ["read", "draft", "publish"];
    wpAntworten(wpOk({ status: "publish", permalink: "https://faithinhumanity.ch/a/" }));
    const out = await freigabe(rahmen(), "approve");
    expect(wp.mock.calls[0].slice(1, 3)).toEqual(["POST", "/posts/18012/publish"]);
    expect(out.body).toMatchObject({ status: "live", permalink: "https://faithinhumanity.ch/a/" });
    expect(db.blog_articles[0]).toMatchObject({
      status: "live",
      wp_permalink: "https://faithinhumanity.ch/a/",
    });
    expect(db.blog_articles[0].job.freigabe.rolle).toBe("agentur");
    expect(db.blog_events.map((e) => e.type)).toEqual(["article.approved", "article.published"]);
  });

  it("eine Überarbeitung wird nie von hier veröffentlicht", async () => {
    db.wp_connections[0].scopes = ["read", "draft", "publish"];
    const out = await freigabe(rahmen({ job: { modus: "refresh" } }), "approve");
    expect(wp).not.toHaveBeenCalled();
    expect(out.body.status).toBe("kunde_freigegeben");
    expect(String(out.body.hinweis)).toMatch(/bestehenden Beitrag/);
  });

  it("klappt das Veröffentlichen nicht, bleibt es bei der Freigabe", async () => {
    db.wp_connections[0].scopes = ["publish"];
    wpAntworten({ ok: false, status: 500, code: "ezr_error", message: "Fehler" });
    const out = await freigabe(rahmen(), "approve");
    expect(out.body.status).toBe("kunde_freigegeben");
    expect(String(out.body.hinweis)).toMatch(/nicht geklappt/);
    expect(db.blog_articles[0].status).toBe("kunde_freigegeben");
  });

  it("nur fertige Entwürfe; «erledigt» erst nach der Freigabe", async () => {
    expect((await freigabe(rahmen({ status: "faktencheck" }), "approve")).status).toBe(409);
    expect((await freigabe(rahmen({ status: "live" }), "approve")).status).toBe(409);
    expect((await freigabe(rahmen(), "erledigt")).status).toBe(409);
    expect(
      (await freigabe(rahmen({ status: "kunde_freigegeben" }, kunde), "erledigt")).status,
    ).toBe(403);
    const out = await freigabe(rahmen({ status: "kunde_freigegeben" }), "erledigt");
    expect(out.body).toMatchObject({ ok: true, status: "live" });
    expect(db.blog_articles[0].published_at).toBeTruthy();
  });

  it("ein Vorschlag bleibt im Hub", async () => {
    const out = await freigabe(
      rahmen({ wp_post_id: null, job: { modus: "vorschlag" } }),
      "approve",
    );
    expect(out.body.status).toBe("kunde_freigegeben");
    expect(String(out.body.hinweis)).toMatch(/Vorschlag/);
    expect(wp).not.toHaveBeenCalled();
  });
});

describe("live stellen und Indexierung", () => {
  const ORIGINAL = "https://faithinhumanity.ch/nothilfe/";
  const refresh = { job: { modus: "refresh", brief: { original_url: ORIGINAL }, wordpress: {} } };
  const mitPlugin = (version: string) => {
    db.wp_connections[0].scopes = ["read", "draft", "publish"];
    db.wp_connections[0].plugin_version = version;
  };

  it("eine Überarbeitung geht nur mit Original-URL und Plugin ab 2.1.0 live", () => {
    const p = db.blog_projects[0];
    const a = { wp_post_id: 1, ...refresh };
    expect(kannVeroeffentlichen(a, p, ["publish"], "2.1.0")).toBe(true);
    expect(kannVeroeffentlichen(a, p, ["publish"], "2.0.1")).toBe(false);
    expect(kannVeroeffentlichen(a, p, ["draft"], "2.1.0")).toBe(false);
    expect(
      kannVeroeffentlichen({ wp_post_id: 1, job: { modus: "refresh" } }, p, ["publish"], "2.1.0"),
    ).toBe(false);
  });

  it("die Freigabe ersetzt den bestehenden Beitrag und meldet ihn", async () => {
    mitPlugin("2.1.0");
    wpAntworten(
      wpOk({
        post_id: 4711,
        status: "publish",
        permalink: ORIGINAL,
        edit_url: "https://faithinhumanity.ch/wp-admin/post.php?post=4711",
        replaced_draft_id: 18012,
        indexnow: { ok: true, status: 202 },
      }),
    );
    const out = await freigabe(rahmen(refresh), "approve");
    expect(wp).toHaveBeenCalledTimes(1);
    expect(wp.mock.calls[0].slice(1, 3)).toEqual(["POST", "/posts/18012/replace-original"]);
    expect(wp.mock.calls[0][3]).toMatchObject({ original_url: ORIGINAL });
    expect(out.body).toMatchObject({ status: "live", permalink: ORIGINAL });
    expect(String(out.body.hinweis)).toMatch(/aktualisiert/);
    const a = db.blog_articles[0];
    expect(a).toMatchObject({ status: "live", wp_post_id: 4711, wp_permalink: ORIGINAL });
    expect(a.job.wordpress.ersetzt_entwurf).toBe(18012);
    expect(a.job.indexierung.indexnow).toEqual({ ok: true, status: 202 });
    expect(a.job.indexierung.google.ok).toBe(false);
    expect(db.blog_events.map((e) => e.type)).toEqual([
      "article.approved",
      "article.published",
      "article.index_requested",
    ]);
  });

  it("fehlt der bestehende Beitrag, bleibt es bei der Freigabe", async () => {
    mitPlugin("2.1.0");
    wpAntworten({ ok: false, status: 404, code: "ezr_original_not_found", message: "x" });
    const out = await freigabe(rahmen(refresh), "approve");
    expect(out.body.status).toBe("kunde_freigegeben");
    expect(String(out.body.hinweis)).toMatch(/nicht gefunden/);
    expect(db.blog_articles[0].wp_post_id).toBe(18012);
  });

  it("erneut einreichen: nur Ezy One, nur live", async () => {
    const { indexierung } = await import("./blog-artikel.server");
    expect((await indexierung(rahmen({ status: "live" }, kunde), "melden")).status).toBe(403);
    expect((await indexierung(rahmen(), "melden")).status).toBe(409);
    expect((await indexierung(rahmen({ status: "live" }), "melden")).status).toBe(409);
    mitPlugin("2.1.0");
    wpAntworten(wpOk({ indexnow: { ok: true, status: 200 } }));
    const out = await indexierung(
      rahmen({ status: "live", wp_permalink: "https://faithinhumanity.ch/a/" }),
      "melden",
    );
    expect(wp.mock.calls[0].slice(1, 3)).toEqual(["POST", "/posts/18012/indexnow"]);
    expect((out.body.indexierung as any).indexnow.ok).toBe(true);
    expect((out.body.indexierung as any).google.grund).toMatch(/Search Console/);
    // Ohne Search Console lässt sich der Google-Stand nicht abfragen.
    expect(
      (
        await indexierung(
          rahmen({ status: "live", wp_permalink: "https://faithinhumanity.ch/a/" }),
          "pruefen",
        )
      ).status,
    ).toBe(409);
  });

  it("liest Plugin-Antwort und robots.txt", async () => {
    const { ausPlugin, sitemapsAusRobots } = await import("./blog-indexierung.server");
    expect(ausPlugin(null).ok).toBe(false);
    expect(ausPlugin({ ok: false, status: 403, error: "Key ungültig" })).toEqual({
      ok: false,
      status: 403,
      grund: "Key ungültig",
    });
    expect(
      sitemapsAusRobots(
        "User-agent: *\nSitemap: https://a.ch/s.xml\nsitemap: https://a.ch/s.xml\nSitemap: /x",
      ),
    ).toEqual(["https://a.ch/s.xml"]);
  });
});
