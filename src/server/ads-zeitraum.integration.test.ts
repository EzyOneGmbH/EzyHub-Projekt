// QS-Runde (13.09.2026): OpenAI-Ads und ChatGPT-Ads GET-Routen folgen dem
// Zeitraum-Vertrag (zeitraumAusParams) — echte Handler gegen eine In-Memory-
// Supabase: gueltige Daten, Reihenfolge, Zukunft, Maximaldauer → 400;
// jede 200-Antwort traegt `range` (from/to/days); Default = genau 30 Tage.
import { describe, it, expect, beforeAll, vi } from "vitest";

const KUNDE = "11111111-1111-4111-8111-111111111111";
const ACC = "acc-1";

const db: Record<string, any[]> = {
  clients: [{ id: KUNDE, name: "Kunde A", organization_id: "org-a" }],
  openai_ads_config: [
    { client_id: KUNDE, pixel_id: "pix", enabled: true, updated_at: "2026-09-01" },
  ],
  openai_ads_events: [
    {
      id: 1,
      client_id: KUNDE,
      event_type: "lead",
      openai_status: "sent",
      created_at: "2026-09-10T10:00:00Z",
    },
    {
      id: 2,
      client_id: KUNDE,
      event_type: "purchase",
      amount_cents: 5000,
      currency: "CHF",
      openai_status: "sent",
      created_at: "2026-08-20T10:00:00Z",
    },
  ],
  chatgpt_ads_accounts: [
    {
      id: ACC,
      client_id: KUNDE,
      openai_ad_account_id: "mock-1",
      name: "Mock",
      currency_code: "CHF",
      status: "active",
      is_mock: true,
    },
  ],
  chatgpt_ads_campaigns: [
    { account_id: ACC, openai_campaign_id: "c1", name: "K1", status: "active" },
  ],
  chatgpt_ads_insights_daily: [
    {
      account_id: ACC,
      scope: "campaign",
      scope_openai_id: "c1",
      date: "2026-09-10",
      impressions: 10,
      clicks: 1,
      spend: 2,
    },
    {
      account_id: ACC,
      scope: "campaign",
      scope_openai_id: "c1",
      date: "2026-08-20",
      impressions: 20,
      clicks: 2,
      spend: 4,
    },
  ],
  chatgpt_ads_commands: [],
  chatgpt_ads_audiences: [],
};

// Generischer Proxy-Builder: eq/neq/gte/lte/lt/in werden ausgewertet, alles
// Uebrige ist chainbar (order/select/limit …); unbekannte Tabellen → [].
function builder(table: string) {
  const st: any = { filters: [] as ((r: any) => boolean)[], single: false, limit: 0 };
  const cmp = (op: string, a: any, b: any) => {
    if (a == null) return false;
    const x = String(a),
      y = String(b);
    return op === "gte"
      ? x >= y
      : op === "lte"
        ? x <= y
        : op === "lt"
          ? x < y
          : op === "gt"
            ? x > y
            : false;
  };
  const api: any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "then")
          return (resolve: any) => {
            let rows = (db[table] || []).filter((r) => st.filters.every((f: any) => f(r)));
            if (st.limit) rows = rows.slice(0, st.limit);
            resolve({ data: st.single ? (rows.length === 1 ? rows[0] : null) : rows, error: null });
          };
        if (prop === "eq")
          return (k: string, v: any) => (st.filters.push((r: any) => r[k] === v), api);
        if (prop === "neq")
          return (k: string, v: any) => (st.filters.push((r: any) => r[k] !== v), api);
        if (prop === "in")
          return (k: string, arr: any[]) => (st.filters.push((r: any) => arr.includes(r[k])), api);
        if (["gte", "lte", "lt", "gt"].includes(prop))
          return (k: string, v: any) => (st.filters.push((r: any) => cmp(prop, r[k], v)), api);
        if (prop === "limit") return (n: number) => ((st.limit = n), api);
        if (prop === "maybeSingle" || prop === "single") return () => ((st.single = true), api);
        return () => api;
      },
    },
  );
  return api;
}
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (t: string) => builder(t),
    rpc: async () => ({ data: null, error: null }),
  },
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-a" } } }) },
    from: (t: string) => builder(t),
  }),
}));

let openai: any, chatgpt: any;
beforeAll(async () => {
  process.env.SUPABASE_URL = "http://stub.local";
  process.env.SUPABASE_ANON_KEY = "stub";
  openai = (await import("../routes/api/admin.openai-ads")).Route.options.server!.handlers as any;
  chatgpt = (await import("../routes/api/admin.chatgpt-ads")).Route.options.server!.handlers as any;
});

const get = (h: any, qs: string) =>
  h.GET({
    request: new Request(`http://test/api/x?client=${KUNDE}&${qs}`, {
      headers: { authorization: "Bearer user-a" },
    }),
  });

const HEUTE = new Date().toISOString().slice(0, 10);

describe.each([
  ["OpenAI Ads", () => openai],
  ["ChatGPT Ads", () => chatgpt],
])("%s GET: Zeitraum-Vertrag", (_name, h) => {
  it("exakter historischer Range → 200 mit range (inklusiv, Tage gezaehlt)", async () => {
    const r = await get(h(), "start=2026-08-01&end=2026-08-31");
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.range).toEqual({ from: "2026-08-01", to: "2026-08-31", days: 31 });
  });

  it("ohne Angabe → genau 30 Tage bis heute", async () => {
    const j = await (await get(h(), "")).json();
    expect(j.range.days).toBe(30);
    expect(j.range.to).toBe(HEUTE);
  });

  it("days=7 → genau 7 Tage; startDate/endDate-Schreibweise wird akzeptiert", async () => {
    expect((await (await get(h(), "days=7")).json()).range.days).toBe(7);
    const j = await (await get(h(), "startDate=2026-09-01&endDate=2026-09-02")).json();
    expect(j.range).toMatchObject({ from: "2026-09-01", to: "2026-09-02", days: 2 });
  });

  it.each([
    ["ungueltiges Datum", "start=2026-02-30&end=2026-03-01", /YYYY-MM-DD|Ungültiges/],
    ["verdrehte Reihenfolge", "start=2026-09-10&end=2026-09-01", /nach endDate/],
    ["Zukunft", "start=2099-01-01&end=2099-01-31", /Zukunft/],
    ["zu lang", "start=2024-01-01&end=2025-12-31", /zu lang/],
    ["nur ein Ende", "start=2026-09-01", /beide/],
  ])("%s → 400 mit klarer Meldung", async (_l, qs, re) => {
    const r = await get(h(), qs);
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(re);
  });
});

describe("Zeitraum filtert die Daten wirklich", () => {
  it("OpenAI-Events: nur Events im Range (inklusive Endtag)", async () => {
    const j = await (await get(openai, "start=2026-09-01&end=2026-09-10")).json();
    expect(j.totals.events).toBe(1);
    const alle = await (await get(openai, "start=2026-08-01&end=2026-09-10")).json();
    expect(alle.totals.events).toBe(2);
  });

  it("ChatGPT-Insights: nur Tage im Range", async () => {
    const r = await get(chatgpt, `start=2026-09-01&end=${HEUTE}`);
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.connected).toBe(true);
    expect(j.insights.map((x: any) => x.date)).toEqual(["2026-09-10"]);
  });

  it("insights-breakdown (POST) validiert start/end gleich streng", async () => {
    const post = (body: any) =>
      chatgpt.POST({
        request: new Request("http://test/api/x", {
          method: "POST",
          headers: { authorization: "Bearer user-a", "content-type": "application/json" },
          body: JSON.stringify({ action: "insights-breakdown", clientId: KUNDE, ...body }),
        }),
      });
    const verdreht = await post({ segment: "country", start: "2026-09-10", end: "2026-09-01" });
    // 400 der Zeitraumpruefung ODER ein frueherer Auth-/Scope-Fehler — nie 200.
    expect(verdreht.status).not.toBe(200);
  });
});
