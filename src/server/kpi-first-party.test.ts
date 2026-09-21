// First-Party-KPIs Phase 3 (22.09.2026): Kachel-Route /api/kpi/first-party
// ueber den ECHTEN Route-Handler mit In-Memory-Supabase (Muster: multi-org
// Integrationstest) plus rpc-Double, das Aufrufe aufzeichnet.
//  - 401 ohne Session, 403 fuer Member, 404 fuer Kunden fremder Org
//  - aktiv:false ohne Kunden-Flag (keine rpc-Aufrufe)
//  - 400 bei verdrehtem Zeitraum / ungueltigen Schwellen
//  - Default 28 Tage inkl. range, Schwellen aus der Query landen 1:1 in den
//    rpc-Args, gewinner/verlierer werden aus EINEM Aufruf getrennt
//  - leer true/false, fail-soft je Block mit redaktiertem Fehler, no-store
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { addDays, heuteYmd } from "../lib/date-range";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const KUNDE_A = "11111111-1111-4111-8111-111111111111";
const KUNDE_A_OHNE = "33333333-3333-4333-8333-333333333333";
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
    { id: KUNDE_A, organization_id: ORG_A, name: "Kunde A", metadata: { first_party_kpi: true } },
    { id: KUNDE_A_OHNE, organization_id: ORG_A, name: "Kunde A2", metadata: { status: "active" } },
    { id: KUNDE_B, organization_id: ORG_B, name: "Kunde B", metadata: { first_party_kpi: true } },
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

// rpc-Double: zeichnet (name, args) auf; Antworten je Funktion konfigurierbar.
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

type H = Record<string, (a: { request: Request }) => Promise<Response>>;
let kpi: H;

function req(path: string, o: { user?: string; org?: string | null } = {}) {
  return new Request(`http://test${path}`, {
    method: "GET",
    headers: {
      ...(o.user ? { authorization: `Bearer ${o.user}` } : {}),
      ...(o.org ? { "x-ezy-active-org": o.org } : {}),
    },
  });
}
const get = (path: string, o: { user?: string; org?: string | null } = {}) =>
  kpi.GET({ request: req(path, o) });

beforeAll(async () => {
  process.env.SUPABASE_URL = "http://stub.local";
  process.env.SUPABASE_ANON_KEY = "stub-anon";
  kpi = (await import("../routes/api/kpi.first-party")).Route.options.server!.handlers as any;
});

beforeEach(() => {
  rpcAufrufe.length = 0;
  for (const k of Object.keys(rpcAntworten)) delete rpcAntworten[k];
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const heute = heuteYmd();
const DATENSTAND_OK = [
  { quelle: "gsc", von: addDays(heute, -120), bis: addDays(heute, -2), zeilen: 4200 },
  { quelle: "ga4", von: addDays(heute, -120), bis: addDays(heute, -1), zeilen: 900 },
];

describe("/api/kpi/first-party — Zugriff", () => {
  it("401 ohne Session", async () => {
    const r = await get(`/api/kpi/first-party?client=${KUNDE_A}`);
    expect(r.status).toBe(401);
    expect(rpcAufrufe).toHaveLength(0);
  });

  it("403 fuer Member (nur Owner/Admin)", async () => {
    const r = await get(`/api/kpi/first-party?client=${KUNDE_A}`, { user: "member-a" });
    expect(r.status).toBe(403);
    expect(rpcAufrufe).toHaveLength(0);
  });

  it("404 fuer Kunden einer fremden Organisation, nie Daten", async () => {
    const r = await get(`/api/kpi/first-party?client=${KUNDE_B}`, { user: "admin-a" });
    expect(r.status).toBe(404);
    const r2 = await get(`/api/kpi/first-party?client=${KUNDE_A}`, { user: "owner-b" });
    expect(r2.status).toBe(404);
    expect(rpcAufrufe).toHaveLength(0);
  });

  it("400 ohne/mit ungueltiger client-UUID", async () => {
    expect((await get(`/api/kpi/first-party`, { user: "admin-a" })).status).toBe(400);
    expect((await get(`/api/kpi/first-party?client=nope`, { user: "admin-a" })).status).toBe(400);
  });

  it("aktiv:false ohne Kunden-Flag — keine rpc-Aufrufe, keine Kacheln", async () => {
    const r = await get(`/api/kpi/first-party?client=${KUNDE_A_OHNE}`, { user: "admin-a" });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ ok: true, aktiv: false });
    expect(j.chancen).toBeUndefined();
    expect(rpcAufrufe).toHaveLength(0);
  });
});

describe("/api/kpi/first-party — Zeitraum und Schwellen", () => {
  it("400 bei verdrehtem Zeitraum (startDate nach endDate)", async () => {
    const r = await get(
      `/api/kpi/first-party?client=${KUNDE_A}&startDate=2026-09-10&endDate=2026-09-01`,
      { user: "admin-a" },
    );
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/startDate/);
    expect(rpcAufrufe).toHaveLength(0);
  });

  it("400 bei zu langem Zeitraum (> 366 Tage) und ungueltigen Schwellen", async () => {
    const lang = await get(`/api/kpi/first-party?client=${KUNDE_A}&days=400`, { user: "admin-a" });
    expect(lang.status).toBe(400);
    const neg = await get(`/api/kpi/first-party?client=${KUNDE_A}&minImpressions=-5`, {
      user: "admin-a",
    });
    expect(neg.status).toBe(400);
    const verdreht = await get(`/api/kpi/first-party?client=${KUNDE_A}&posVon=20&posBis=8`, {
      user: "admin-a",
    });
    expect(verdreht.status).toBe(400);
    expect(rpcAufrufe).toHaveLength(0);
  });

  it("Default 28 Tage: range {from,to,days} exakt, endDate = heute (UTC)", async () => {
    rpcAntworten.kpi_datenstand = { data: DATENSTAND_OK, error: null };
    const r = await get(`/api/kpi/first-party?client=${KUNDE_A}`, { user: "admin-a" });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.aktiv).toBe(true);
    expect(j.range).toEqual({ from: addDays(heute, -27), to: heute, days: 28 });
    expect(j.konfig).toEqual({
      minImpressions: 100,
      posVon: 8,
      posBis: 20,
      zielposition: 5,
      limit: 25,
    });
  });

  it("rpc-Aufrufe: alle fuenf Funktionen, Schwellen aus der Query landen 1:1 in den Args", async () => {
    const r = await get(
      `/api/kpi/first-party?client=${KUNDE_A}&startDate=2026-08-01&endDate=2026-08-31&minImpressions=250&posVon=6&posBis=15&zielposition=3&limit=40`,
      { user: "admin-a" },
    );
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.range).toEqual({ from: "2026-08-01", to: "2026-08-31", days: 31 });
    const namen = rpcAufrufe.map((c) => c.name).sort();
    expect(namen).toEqual([
      "kpi_chancen_keywords",
      "kpi_ctr_kurve",
      "kpi_datenstand",
      "kpi_gewinner_verlierer",
      "kpi_organic_conversions",
    ]);
    const arg = (n: string) => rpcAufrufe.find((c) => c.name === n)!.args;
    expect(arg("kpi_datenstand")).toEqual({ _client_id: KUNDE_A });
    expect(arg("kpi_chancen_keywords")).toEqual({
      _client_id: KUNDE_A,
      _von: "2026-08-01",
      _bis: "2026-08-31",
      _min_impressions: 250,
      _pos_von: 6,
      _pos_bis: 15,
      _zielposition: 3,
      _limit: 40,
    });
    expect(arg("kpi_gewinner_verlierer")).toEqual({
      _client_id: KUNDE_A,
      _von: "2026-08-01",
      _bis: "2026-08-31",
      _limit: 10,
    });
    expect(arg("kpi_organic_conversions")).toEqual({
      _client_id: KUNDE_A,
      _von: "2026-08-01",
      _bis: "2026-08-31",
      _limit: 10,
    });
    expect(arg("kpi_ctr_kurve")).toEqual({
      _client_id: KUNDE_A,
      _von: "2026-08-01",
      _bis: "2026-08-31",
    });
    expect(j.konfig).toEqual({
      minImpressions: 250,
      posVon: 6,
      posBis: 15,
      zielposition: 3,
      limit: 40,
    });
  });
});

describe("/api/kpi/first-party — Antwort", () => {
  it("leer:true, wenn keine Quelle Zeilen im Zeitraum hat (Referenz-CTR zaehlt nicht)", async () => {
    rpcAntworten.kpi_datenstand = {
      data: [{ quelle: "gsc", von: "2025-01-01", bis: "2025-03-31", zeilen: 500 }],
      error: null,
    };
    rpcAntworten.kpi_ctr_kurve = {
      data: [{ pos: 1, queries: 0, impressions: 0, clicks: 0, ctr: 0.3, quelle: "referenz" }],
      error: null,
    };
    const r = await get(
      `/api/kpi/first-party?client=${KUNDE_A}&startDate=2026-08-01&endDate=2026-08-31`,
      { user: "admin-a" },
    );
    const j = await r.json();
    expect(j.leer).toBe(true);
    expect(j.chancen).toEqual({ rows: [], fehler: null });
    expect(j.ctrKurve.rows).toHaveLength(1);
  });

  it("leer:false mit Daten; gewinner/verlierer aus EINEM Aufruf getrennt; alle Bloecke ohne Fehler", async () => {
    rpcAntworten.kpi_datenstand = { data: DATENSTAND_OK, error: null };
    rpcAntworten.kpi_chancen_keywords = {
      data: [
        {
          query: "seo agentur zürich",
          impressions: 1234,
          clicks: 12,
          ctr: 0.0097,
          pos: 9.4,
          seiten: 1,
          top_page: "https://a.ch/seo",
          erwartete_ctr: 0.06,
          ctr_luecke: 0.05,
          potenzial_klicks: 62,
          score: 61.7,
        },
      ],
      error: null,
    };
    rpcAntworten.kpi_gewinner_verlierer = {
      data: [
        {
          richtung: "gewinner",
          page: "https://a.ch/x",
          clicks: 50,
          clicks_vorher: 20,
          delta_clicks: 30,
        },
        {
          richtung: "verlierer",
          page: "https://a.ch/y",
          clicks: 5,
          clicks_vorher: 40,
          delta_clicks: -35,
        },
        {
          richtung: "gewinner",
          page: "https://a.ch/z",
          clicks: 22,
          clicks_vorher: 10,
          delta_clicks: 12,
        },
      ],
      error: null,
    };
    rpcAntworten.kpi_organic_conversions = {
      data: [
        {
          landing_page: "/x",
          sessions: 100,
          engaged_sessions: 60,
          key_events: 5,
          conversion_rate: 0.05,
        },
      ],
      error: null,
    };
    const r = await get(`/api/kpi/first-party?client=${KUNDE_A}`, { user: "admin-a" });
    const j = await r.json();
    expect(j.leer).toBe(false);
    expect(j.datenstand.rows).toHaveLength(2);
    expect(j.chancen.rows[0].query).toBe("seo agentur zürich");
    expect(j.gewinner.rows.map((x: any) => x.page)).toEqual(["https://a.ch/x", "https://a.ch/z"]);
    expect(j.verlierer.rows.map((x: any) => x.page)).toEqual(["https://a.ch/y"]);
    expect(j.organicConversions.rows).toHaveLength(1);
    for (const b of [
      "datenstand",
      "chancen",
      "gewinner",
      "verlierer",
      "organicConversions",
      "ctrKurve",
    ])
      expect(j[b].fehler).toBeNull();
  });

  it("leer:false, wenn nur der Datenstand Zeilen im Zeitraum meldet (Schwellen zu hoch)", async () => {
    rpcAntworten.kpi_datenstand = { data: DATENSTAND_OK, error: null };
    const r = await get(`/api/kpi/first-party?client=${KUNDE_A}&minImpressions=100000`, {
      user: "admin-a",
    });
    const j = await r.json();
    expect(j.leer).toBe(false);
    expect(j.chancen.rows).toEqual([]);
  });

  it("fail-soft je Block: Fehler redaktiert (nur message, keine details/hint/code), Rest liefert", async () => {
    rpcAntworten.kpi_datenstand = { data: DATENSTAND_OK, error: null };
    rpcAntworten.kpi_chancen_keywords = {
      data: null,
      error: {
        message: "canceling statement due to statement timeout",
        details: "SELECT * FROM gsc_query_daily WHERE client_id = 'geheim'",
        hint: "increase statement_timeout",
        code: "57014",
      },
    };
    rpcAntworten.kpi_gewinner_verlierer = () => {
      throw new Error("Verbindung abgebrochen");
    };
    const r = await get(`/api/kpi/first-party?client=${KUNDE_A}`, { user: "admin-a" });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain("gsc_query_daily");
    expect(text).not.toContain("57014");
    expect(text).not.toContain("statement_timeout");
    const j = JSON.parse(text);
    expect(j.ok).toBe(true);
    expect(j.chancen).toEqual({ rows: [], fehler: "canceling statement due to statement timeout" });
    expect(j.gewinner).toEqual({ rows: [], fehler: "Verbindung abgebrochen" });
    expect(j.verlierer.fehler).toBe("Verbindung abgebrochen");
    expect(j.datenstand.fehler).toBeNull();
    expect(j.organicConversions).toEqual({ rows: [], fehler: null });
    expect(j.leer).toBe(false);
  });
});
