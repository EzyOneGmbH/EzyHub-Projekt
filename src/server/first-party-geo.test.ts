// First-Party GEO (22.09.2026): Route /api/kpi/first-party-geo ueber den
// ECHTEN Route-Handler mit In-Memory-Supabase plus rpc-Double und fetch-Stub
// (Muster: kpi-first-party.test.ts).
//  - 401/403/404/400, aktiv:false ohne Kunden-Flag (keine rpc/fetch-Aufrufe)
//  - GET alle Bloecke: rpc-Args, zitierte URLs aus dem juengsten Report,
//    Brand-Begriffe aus clients.brand_terms, robots.txt der Kundendomain
//  - block=… laedt nur diesen Block; fail-soft je Block mit redaktiertem Fehler
//  - POST did: Validierung, Fenster, rpc-Args, Ergebnisform, 502 bei DB-Fehler
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { addDays, heuteYmd } from "../lib/date-range";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const KUNDE_A = "11111111-1111-4111-8111-111111111111";
const KUNDE_A_OHNE = "33333333-3333-4333-8333-333333333333";
const KUNDE_A_OHNE_DOMAIN = "44444444-4444-4444-8444-444444444444";
const KUNDE_B = "22222222-2222-4222-8222-222222222222";

const users: Record<string, { org: string; role: string }[]> = {
  "admin-a": [{ org: ORG_A, role: "admin" }],
  "member-a": [{ org: ORG_A, role: "member" }],
  "owner-b": [{ org: ORG_B, role: "owner" }],
};

const db: Record<string, any[]> = {
  app_users: Object.entries(users).flatMap(([uid, ms]) =>
    ms.map((m) => ({ id: `${uid}@${m.org}`, user_id: uid, organization_id: m.org, role: m.role })),
  ),
  clients: [
    {
      id: KUNDE_A,
      organization_id: ORG_A,
      name: "Kunde A",
      domain: "https://www.kunde-a.ch/",
      brand_terms: ["kunde a", "kundea"],
      metadata: { first_party_kpi: true },
    },
    {
      id: KUNDE_A_OHNE,
      organization_id: ORG_A,
      name: "Kunde A2",
      domain: "a2.ch",
      brand_terms: [],
      metadata: { status: "active" },
    },
    {
      id: KUNDE_A_OHNE_DOMAIN,
      organization_id: ORG_A,
      name: "Kunde A3",
      domain: null,
      brand_terms: [],
      metadata: { first_party_kpi: true },
    },
    {
      id: KUNDE_B,
      organization_id: ORG_B,
      name: "Kunde B",
      domain: "b.ch",
      brand_terms: [],
      metadata: { first_party_kpi: true },
    },
  ],
  // Reihenfolge = «order snapshot_date desc» (der Builder ignoriert order/limit)
  ai_visibility_reports: [
    { client_id: KUNDE_A, snapshot_date: "2026-09-21", parts: { pr: { selfShare: 5 } } },
    {
      client_id: KUNDE_A,
      snapshot_date: "2026-09-14",
      parts: {
        br: { urls: ["https://kunde-a.ch/blog/x", "https://kunde-a.ch/neu"] },
        sa: { urls: ["https://kunde-a.ch/blog/x"] },
      },
    },
    {
      client_id: KUNDE_B,
      snapshot_date: "2026-09-20",
      parts: { br: { urls: ["https://b.ch/z"] } },
    },
  ],
};

function builder(table: string) {
  const st: any = { filters: [] as ((r: any) => boolean)[], single: false };
  const api: any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "then")
          return (resolve: any) => {
            const rows = (db[table] || []).filter((r) => st.filters.every((f: any) => f(r)));
            const data = st.single ? (rows.length === 1 ? rows[0] : null) : rows;
            resolve({ data, error: null, count: rows.length });
          };
        if (prop === "eq")
          return (k: string, v: any) => (st.filters.push((r: any) => r[k] === v), api);
        if (prop === "maybeSingle" || prop === "single") return () => ((st.single = true), api);
        return () => api;
      },
    },
  );
  return api;
}

const rpcAufrufe: Array<{ name: string; args: any }> = [];
const rpcAntworten: Record<string, { data: any; error: any } | (() => never)> = {};
const supabaseAdminStub = {
  from: (t: string) => builder(t),
  rpc: (name: string, args: any) => {
    rpcAufrufe.push({ name, args });
    const a = rpcAntworten[name];
    if (typeof a === "function") return Promise.resolve().then(a);
    return Promise.resolve(a ?? { data: [], error: null });
  },
};
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: supabaseAdminStub,
  supabaseSecretKey: () => "test-secret",
  supabaseKeyTyp: () => ({ secret: "legacy_service_role", publishable: "legacy_anon" }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (_u: string, _k: string, opts: any) => ({
    auth: {
      getUser: async () => {
        const h = String(opts?.global?.headers?.Authorization || "");
        const id = h.startsWith("Bearer ") ? h.slice(7) : "";
        return { data: { user: users[id] ? { id } : null } };
      },
    },
    from: (t: string) => builder(t),
  }),
}));

// fetch-Stub fuer robots.txt
const fetchAufrufe: string[] = [];
let robotsAntwort: () => Promise<Response> = async () =>
  new Response("User-agent: *\nDisallow: /wp-admin/\n\nUser-agent: GPTBot\nDisallow: /\n", {
    status: 200,
  });
const fetchStub = vi.fn(async (url: string) => {
  fetchAufrufe.push(String(url));
  return robotsAntwort();
});

type H = Record<string, (a: { request: Request }) => Promise<Response>>;
let geo: H;

type Opt = { user?: string; org?: string | null; body?: unknown };
function req(path: string, method: "GET" | "POST", o: Opt = {}) {
  return new Request(`http://test${path}`, {
    method,
    headers: {
      ...(o.user ? { authorization: `Bearer ${o.user}` } : {}),
      ...(o.org ? { "x-ezy-active-org": o.org } : {}),
      ...(o.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(o.body !== undefined
      ? { body: typeof o.body === "string" ? o.body : JSON.stringify(o.body) }
      : {}),
  });
}
const get = (path: string, o: Opt = {}) => geo.GET({ request: req(path, "GET", o) });
const post = (body: unknown, o: Opt = {}) =>
  geo.POST({ request: req("/api/kpi/first-party-geo", "POST", { ...o, body }) });

beforeAll(async () => {
  process.env.SUPABASE_URL = "http://stub.local";
  process.env.SUPABASE_ANON_KEY = "stub-anon";
  vi.stubGlobal("fetch", fetchStub);
  geo = (await import("../routes/api/kpi.first-party-geo")).Route.options.server!.handlers as any;
});
afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  rpcAufrufe.length = 0;
  fetchAufrufe.length = 0;
  for (const k of Object.keys(rpcAntworten)) delete rpcAntworten[k];
  robotsAntwort = async () =>
    new Response("User-agent: *\nDisallow: /wp-admin/\n\nUser-agent: GPTBot\nDisallow: /\n", {
      status: 200,
    });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const heute = heuteYmd();
const URL_A = `/api/kpi/first-party-geo?client=${KUNDE_A}`;

describe("/api/kpi/first-party-geo — Zugriff", () => {
  it("401 ohne Session, 403 fuer Member", async () => {
    expect((await get(URL_A)).status).toBe(401);
    expect((await get(URL_A, { user: "member-a" })).status).toBe(403);
    expect((await post({ client: KUNDE_A, action: "did" }, { user: "member-a" })).status).toBe(403);
    expect(rpcAufrufe).toHaveLength(0);
    expect(fetchAufrufe).toHaveLength(0);
  });

  it("404 fuer Kunden einer fremden Organisation (GET und POST), nie Daten", async () => {
    expect(
      (await get(`/api/kpi/first-party-geo?client=${KUNDE_B}`, { user: "admin-a" })).status,
    ).toBe(404);
    expect((await get(URL_A, { user: "owner-b" })).status).toBe(404);
    const r = await post(
      {
        client: KUNDE_B,
        action: "did",
        pages: ["https://b.ch/z"],
        changeDate: addDays(heute, -60),
      },
      { user: "admin-a" },
    );
    expect(r.status).toBe(404);
    expect(rpcAufrufe).toHaveLength(0);
    expect(fetchAufrufe).toHaveLength(0);
  });

  it("400 ohne/mit ungueltiger client-UUID, bei unbekanntem block und verdrehtem Zeitraum", async () => {
    expect((await get(`/api/kpi/first-party-geo`, { user: "admin-a" })).status).toBe(400);
    expect((await get(`/api/kpi/first-party-geo?client=nope`, { user: "admin-a" })).status).toBe(
      400,
    );
    const b = await get(`${URL_A}&block=did`, { user: "admin-a" });
    expect(b.status).toBe(400);
    expect((await b.json()).error).toMatch(/block/);
    const z = await get(`${URL_A}&startDate=2026-09-10&endDate=2026-09-01`, { user: "admin-a" });
    expect(z.status).toBe(400);
    expect(rpcAufrufe).toHaveLength(0);
  });

  it("aktiv:false ohne Kunden-Flag — keine rpc-/fetch-Aufrufe (GET und POST)", async () => {
    const r = await get(`/api/kpi/first-party-geo?client=${KUNDE_A_OHNE}`, { user: "admin-a" });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ ok: true, aktiv: false });
    expect(j.referrals).toBeUndefined();
    const p = await post(
      { client: KUNDE_A_OHNE, action: "did", pages: ["/x"], changeDate: addDays(heute, -60) },
      { user: "admin-a" },
    );
    expect(await p.json()).toEqual({ ok: true, aktiv: false });
    expect(rpcAufrufe).toHaveLength(0);
    expect(fetchAufrufe).toHaveLength(0);
  });
});

describe("/api/kpi/first-party-geo — GET", () => {
  it("alle vier Bloecke: rpc-Args, Report-URLs, Brand-Begriffe, robots.txt, no-store", async () => {
    rpcAntworten.kpi_ki_referrals = {
      data: [
        {
          date: "2026-08-02",
          session_source: "chatgpt.com",
          session_medium: "referral",
          landing_page: "/blog/x",
          sessions: 7,
          engaged_sessions: 5,
          key_events: 1,
        },
        {
          date: "2026-08-02",
          session_source: "box.ai",
          session_medium: "referral",
          landing_page: "/z",
          sessions: 50,
          engaged_sessions: 1,
          key_events: 0,
        },
      ],
      error: null,
    };
    rpcAntworten.kpi_seiten_zeitraum = {
      data: [
        { page: "https://www.kunde-a.ch/blog/x/", impressions: 800, clicks: 30, pos: 5.5 },
        { page: "https://www.kunde-a.ch/angebot", impressions: 300, clicks: 9, pos: 8 },
      ],
      error: null,
    };
    rpcAntworten.kpi_brand_wochen = {
      data: [
        {
          woche_ab: "2026-08-03",
          brand_impressions: 50,
          brand_clicks: 10,
          nonbrand_impressions: 150,
          nonbrand_clicks: 5,
        },
      ],
      error: null,
    };
    const r = await get(`${URL_A}&startDate=2026-08-01&endDate=2026-08-31`, { user: "admin-a" });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.aktiv).toBe(true);
    expect(j.range).toEqual({ from: "2026-08-01", to: "2026-08-31", days: 31 });
    expect(j.fehler).toBeUndefined();

    expect(rpcAufrufe.map((c) => c.name).sort()).toEqual([
      "kpi_brand_wochen",
      "kpi_ki_referrals",
      "kpi_seiten_zeitraum",
    ]);
    const arg = (n: string) => rpcAufrufe.find((c) => c.name === n)!.args;
    expect(arg("kpi_ki_referrals")).toEqual({
      _client_id: KUNDE_A,
      _von: "2026-08-01",
      _bis: "2026-08-31",
    });
    expect(arg("kpi_brand_wochen")).toEqual({
      _client_id: KUNDE_A,
      _von: "2026-08-01",
      _bis: "2026-08-31",
      _begriffe: ["kunde a", "kundea"],
    });

    // referrals: box.ai verworfen, ChatGPT gezaehlt, Tage gefuellt
    expect(j.referrals.engines).toEqual([
      { engine: "ChatGPT", sessions: 7, engaged: 5, keyEvents: 1, anteilProzent: 100 },
    ]);
    expect(j.referrals.tage).toHaveLength(31);
    expect(j.referrals.landingpages).toEqual([
      { engine: "ChatGPT", landingPage: "/blog/x", sessions: 7, keyEvents: 1 },
    ]);
    expect(j.referrals.hinweis).toContain("AI-Overview-Klicks zaehlen als Organic");

    // zitate: juengster Report MIT br/sa-URLs (14.09.), nicht der reine pr-Report
    expect(j.zitate.standVom).toBe("2026-09-14");
    expect(j.zitate.zitiert).toEqual([
      {
        page: "https://www.kunde-a.ch/blog/x/",
        impressions: 800,
        clicks: 30,
        pos: 5.5,
        zitiert: true,
      },
      { page: "https://kunde-a.ch/neu", impressions: 0, clicks: 0, pos: null, zitiert: true },
    ]);
    expect(j.zitate.organischNichtZitiert).toEqual([
      { page: "https://www.kunde-a.ch/angebot", impressions: 300, clicks: 9, pos: 8 },
    ]);
    expect(j.zitate.zitiertOhneSichtbarkeit).toEqual([
      { page: "https://kunde-a.ch/neu", impressions: 0, clicks: 0 },
    ]);
    expect(j.zitate.zusammenfassung).toEqual({
      zitierteSeiten: 2,
      davonMitOrganik: 1,
      organischeSeitenOhneZitat: 1,
    });

    // brand
    expect(j.brand.begriffe).toEqual(["kunde a", "kundea"]);
    expect(j.brand.wochen).toEqual([
      {
        wocheAb: "2026-08-03",
        brandImpressions: 50,
        brandClicks: 10,
        nonbrandImpressions: 150,
        nonbrandClicks: 5,
        brandAnteilProzent: 25,
      },
    ]);
    expect(j.brand.trendProzent).toBeNull();

    // crawler: robots.txt der Kundendomain (Host aus clients.domain)
    expect(fetchAufrufe).toEqual(["https://www.kunde-a.ch/robots.txt"]);
    expect(j.crawler.robotsUrl).toBe("https://www.kunde-a.ch/robots.txt");
    expect(j.crawler.geladen).toBe(true);
    const gpt = j.crawler.bots.find((b: any) => b.name === "GPTBot");
    expect(gpt).toMatchObject({
      betreiber: "OpenAI",
      zweck: "training",
      status: "gesperrt",
      regel: "Disallow: /",
    });
    expect(j.crawler.bots.find((b: any) => b.name === "OAI-SearchBot")).toMatchObject({
      status: "erlaubt",
      regel: "Disallow: /wp-admin/",
    });
    for (const b of j.crawler.bots)
      for (const k of ["name", "betreiber", "zweck", "haeltSichAnRobots", "status", "empfehlung"])
        expect(b).toHaveProperty(k);
  });

  it("block=referrals laedt nur diesen Block (kein fetch, keine anderen rpc)", async () => {
    const r = await get(`${URL_A}&block=referrals&days=7`, { user: "admin-a" });
    const j = await r.json();
    expect(rpcAufrufe.map((c) => c.name)).toEqual(["kpi_ki_referrals"]);
    expect(fetchAufrufe).toHaveLength(0);
    expect(j.referrals).toBeDefined();
    expect(j.referrals.tage).toHaveLength(7);
    expect(j.zitate).toBeUndefined();
    expect(j.brand).toBeUndefined();
    expect(j.crawler).toBeUndefined();
    expect(j.range).toEqual({ from: addDays(heute, -6), to: heute, days: 7 });
  });

  it("Brand-Fallback ohne brand_terms: Domain-Stamm; ohne Domain Crawler-Block mit fehler", async () => {
    const r = await get(`/api/kpi/first-party-geo?client=${KUNDE_A_OHNE_DOMAIN}`, {
      user: "admin-a",
    });
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(fetchAufrufe).toHaveLength(0);
    expect(j.crawler).toMatchObject({ robotsUrl: null, geladen: false });
    expect(j.crawler.bots.every((b: any) => b.status === "unbestimmt" && b.regel === null)).toBe(
      true,
    );
    expect(j.fehler).toEqual({ crawler: "Keine Domain beim Kunden hinterlegt" });
    expect(j.brand.begriffe).toEqual([]);
    expect(rpcAufrufe.find((c) => c.name === "kpi_brand_wochen")!.args._begriffe).toEqual([]);
  });

  it("fail-soft je Block: redaktierter Fehler in fehler[block], andere Bloecke liefern; robots-Fehler → geladen:false", async () => {
    rpcAntworten.kpi_ki_referrals = {
      data: null,
      error: {
        message: "canceling statement due to statement timeout",
        details: "SELECT * FROM ga4_landing_daily WHERE client_id = 'geheim'",
        hint: "increase statement_timeout",
        code: "57014",
      },
    };
    rpcAntworten.kpi_brand_wochen = () => {
      throw new Error("Verbindung abgebrochen");
    };
    robotsAntwort = async () => {
      throw new Error("ETIMEDOUT");
    };
    const r = await get(URL_A, { user: "admin-a" });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain("ga4_landing_daily");
    expect(text).not.toContain("57014");
    expect(text).not.toContain("statement_timeout");
    const j = JSON.parse(text);
    expect(j.ok).toBe(true);
    expect(j.fehler).toEqual({
      referrals: "canceling statement due to statement timeout",
      brand: "Verbindung abgebrochen",
    });
    expect(j.referrals).toBeUndefined();
    expect(j.brand).toBeUndefined();
    expect(j.zitate.zusammenfassung).toEqual({
      zitierteSeiten: 2,
      davonMitOrganik: 0,
      organischeSeitenOhneZitat: 0,
    });
    expect(j.crawler).toMatchObject({
      robotsUrl: "https://www.kunde-a.ch/robots.txt",
      geladen: false,
    });
  });
});

describe("/api/kpi/first-party-geo — POST did", () => {
  const change = addDays(heute, -60); // Post-Fenster (Default 7 Tage Washout, 28 Tage) liegt komplett in der Vergangenheit
  const gueltig = {
    client: KUNDE_A,
    action: "did",
    pages: ["https://kunde-a.ch/blog/x"],
    changeDate: change,
  };

  it("400 bei ungueltigem Body, falscher action, leeren pages, falschem Datum, Parametern ausserhalb der Grenzen", async () => {
    expect((await post("kein json", { user: "admin-a" })).status).toBe(400);
    expect((await post({ ...gueltig, action: "lift" }, { user: "admin-a" })).status).toBe(400);
    expect((await post({ ...gueltig, pages: [] }, { user: "admin-a" })).status).toBe(400);
    expect((await post({ ...gueltig, pages: "x" }, { user: "admin-a" })).status).toBe(400);
    expect((await post({ ...gueltig, changeDate: "01.08.2026" }, { user: "admin-a" })).status).toBe(
      400,
    );
    expect((await post({ ...gueltig, praeTage: 3 }, { user: "admin-a" })).status).toBe(400);
    expect((await post({ ...gueltig, washoutTage: -1 }, { user: "admin-a" })).status).toBe(400);
    expect((await post({ ...gueltig, postTage: 500 }, { user: "admin-a" })).status).toBe(400);
    expect(rpcAufrufe).toHaveLength(0);
  });

  it("400, wenn das Post-Fenster noch in der Zukunft liegt", async () => {
    const r = await post({ ...gueltig, changeDate: addDays(heute, -3) }, { user: "admin-a" });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/Post-Fenster/);
    expect(rpcAufrufe).toHaveLength(0);
  });

  it("rechnet DiD: rpc-Args = Ladefenster, Ergebnisform gemaess Vertrag", async () => {
    const praeFrom = addDays(change, -56);
    const praeTo = addDays(change, -1);
    const postFrom = addDays(change, 7);
    const postTo = addDays(postFrom, 27);
    const zeile = (page: string, date: string, clicks: number) => ({
      page,
      date,
      clicks,
      impressions: clicks * 10,
    });
    rpcAntworten.kpi_seiten_tage = {
      data: [
        zeile("https://kunde-a.ch/blog/x", praeFrom, 100),
        zeile("https://kunde-a.ch/blog/x", postFrom, 150),
        zeile("https://kunde-a.ch/blog/a", praeFrom, 10),
        zeile("https://kunde-a.ch/blog/a", postFrom, 12),
        zeile("https://kunde-a.ch/blog/b", praeFrom, 20),
        zeile("https://kunde-a.ch/blog/b", postFrom, 18),
        zeile("https://kunde-a.ch/blog/c", praeFrom, 10),
        zeile("https://kunde-a.ch/blog/c", postFrom, 11),
        zeile("https://kunde-a.ch/blog/d", praeFrom, 40),
        zeile("https://kunde-a.ch/blog/d", postFrom, 44),
      ],
      error: null,
    };
    const r = await post(gueltig, { user: "admin-a" });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(rpcAufrufe).toEqual([
      { name: "kpi_seiten_tage", args: { _client_id: KUNDE_A, _von: praeFrom, _bis: postTo } },
    ]);
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.did).toEqual({
      behandelt: { seiten: 1, praeClicks: 100, postClicks: 150 },
      kontrolle: { seiten: 4, quelle: "sektion", ratioMittel: 1.075, ratioSe: 0.0629 },
      counterfactual: 107.5,
      lift: 42.5,
      liftLo: 30.2,
      liftHi: 54.8,
      verdikt: "likely_positive",
      fenster: { prae: { from: praeFrom, to: praeTo }, post: { from: postFrom, to: postTo } },
    });
  });

  it("eigene Parameter (praeTage/washoutTage/postTage) bestimmen das Ladefenster; Post auf heute gekappt", async () => {
    const c = addDays(heute, -10);
    const r = await post(
      { ...gueltig, changeDate: c, praeTage: 14, washoutTage: 0, postTage: 28 },
      { user: "admin-a" },
    );
    expect(r.status).toBe(200);
    expect(rpcAufrufe[0].args).toEqual({ _client_id: KUNDE_A, _von: addDays(c, -14), _bis: heute });
    const j = await r.json();
    expect(j.did.fenster.post).toEqual({ from: c, to: heute });
    expect(j.did.verdikt).toBe("insufficient_data");
  });

  it("502 mit redaktiertem Fehler, wenn kpi_seiten_tage scheitert", async () => {
    rpcAntworten.kpi_seiten_tage = {
      data: null,
      error: { message: "permission denied", details: "gsc_daily geheim", code: "42501" },
    };
    const r = await post(gueltig, { user: "admin-a" });
    expect(r.status).toBe(502);
    const text = await r.text();
    expect(text).not.toContain("geheim");
    expect(JSON.parse(text)).toEqual({ ok: false, error: "permission denied" });
  });
});
