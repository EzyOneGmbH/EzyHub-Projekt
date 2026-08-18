import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

// Phase-0-Abnahme (0.2 + 0.3): decideApproval mit gemocktem Supabase + Ads-API.
// Beweist: (a) LEARNING_* blockiert den Write im Execute-Pfad (423, Approval
// bleibt pending), (b) paralleles Doppel-Approve fuehrt genau EINMAL aus
// (atomarer Claim, Verlierer erhaelt 409 already_executed), (c) abgelaufene
// Approvals sind nicht ausfuehrbar (410 + Status expired), (d) approved_by ist
// bei Freigaben zwingend (400).

const h = vi.hoisted(() => {
  const db: Record<string, Array<Record<string, any>>> = {
    ads_approvals: [],
    ads_changelog: [],
    clients: [],
    ads_autopilot_config: [],
  };
  class QB {
    private filters: Array<[string, any]> = [];
    private op: "select" | "update" | "insert" = "select";
    private patch: Record<string, any> = {};
    private insertedRow: Record<string, any> | null = null;
    private wantRows = false;
    constructor(private t: string) {}
    select(_cols?: string) {
      if (this.op === "update" || this.op === "insert") this.wantRows = true;
      return this;
    }
    update(patch: Record<string, any>) {
      this.op = "update";
      this.patch = patch;
      return this;
    }
    insert(row: Record<string, any>) {
      this.op = "insert";
      this.insertedRow = { id: `id-${Math.random().toString(36).slice(2)}`, ...row };
      db[this.t].push(this.insertedRow);
      return this;
    }
    eq(col: string, val: any) {
      this.filters.push([col, val]);
      return this;
    }
    order() {
      return this;
    }
    private run() {
      if (this.op === "update") {
        // Atomar im JS-Sinn: Filter + Patch in einem synchronen Schritt -
        // genau das Verhalten, das der DB-seitige status='pending'-Guard liefert.
        const rows = db[this.t].filter((r) => this.filters.every(([c, v]) => r[c] === v));
        for (const r of rows) Object.assign(r, this.patch);
        return { data: this.wantRows ? rows.map((r) => ({ ...r })) : null, error: null };
      }
      if (this.op === "insert")
        return { data: this.wantRows ? [this.insertedRow] : null, error: null };
      const rows = db[this.t].filter((r) => this.filters.every(([c, v]) => r[c] === v));
      return { data: rows.map((r) => ({ ...r })), error: null };
    }
    maybeSingle() {
      const { data, error } = this.run();
      return Promise.resolve({ data: (data && data[0]) ?? null, error });
    }
    then(onFulfilled: any, onRejected: any) {
      return Promise.resolve(this.run()).then(onFulfilled, onRejected);
    }
  }
  return { db, supabaseAdmin: { from: (t: string) => new QB(t) } };
});

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: h.supabaseAdmin }));
vi.mock("./google-tokens.server", () => ({
  getGoogleAccessToken: async () => ({ accessToken: "tok" }),
}));

import { decideApproval, isCampaignLearning } from "./google-ads-autopilot.server";

// ── Ads-API-Fetch-Mock: GAQL-Router + Mutate-Zaehler ─────────────────────────
let mutateCalls = 0;
let systemStatus = "ENABLED"; // bidding_strategy_system_status der Test-Kampagne

function routeGaql(q: string): Array<Record<string, any>> {
  if (q.includes("bidding_strategy_system_status FROM campaign WHERE campaign.name"))
    return [{ campaign: { biddingStrategySystemStatus: systemStatus } }];
  if (q.includes("campaign_budget.id"))
    return [{ campaignBudget: { id: "42", amountMicros: 10_000_000 } }];
  if (q.includes("search_budget_lost_impression_share"))
    return [
      {
        campaign: { name: "L", status: "ENABLED", biddingStrategySystemStatus: systemStatus },
        campaignBudget: { amountMicros: 10_000_000 },
        metrics: {
          costMicros: 100_000_000,
          conversions: 6,
          conversionsValue: 0,
          searchBudgetLostImpressionShare: 0,
        },
      },
    ];
  if (q.includes("FROM customer") && q.includes("LAST_30_DAYS"))
    return [{ metrics: { costMicros: 100_000_000 } }];
  if (q.includes("FROM customer") && q.includes("LAST_7_DAYS"))
    return [{ metrics: { costMicros: 50_000_000, conversions: 3 } }];
  if (q.includes("FROM customer") && q.includes("BETWEEN"))
    return [{ metrics: { conversions: 30 } }];
  return [];
}

beforeAll(() => {
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "dev-token";
  process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes(":mutate")) {
        mutateCalls += 1;
        return { ok: true, json: async () => ({}), text: async () => "" } as any;
      }
      if (systemStatus === "__HTTP_FAIL__")
        return { ok: false, status: 500, json: async () => ({}), text: async () => "boom" } as any;
      const q = String(JSON.parse(String(init?.body ?? "{}")).query ?? "");
      return {
        ok: true,
        json: async () => [{ results: routeGaql(q) }],
        text: async () => "",
      } as any;
    }),
  );
});

const FUTURE = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
const PAST = new Date(Date.now() - 3600 * 1000).toISOString();

function seed(over: Partial<Record<string, any>> = {}) {
  h.db.ads_approvals.length = 0;
  h.db.ads_changelog.length = 0;
  h.db.clients.length = 0;
  h.db.ads_autopilot_config.length = 0;
  h.db.clients.push({ id: "c1", name: "Testkunde", google_ads_customer: "111" });
  h.db.ads_autopilot_config.push({
    client_id: "c1",
    industry: "hotel",
    kill_switch: false,
    observe_only: false,
    autonomy_level: 1,
    monthly_budget_chf: 1000,
    target_cpa_chf: 50,
    target_roas: null,
    season_high: [],
    season_low: [],
    no_touch_campaigns: [],
    languages: ["de"],
    notes: null,
    notes_updated_at: null,
    min_conversions_baseline: 3,
    conversion_lag_days: 7,
    min_conversions_for_budget_rec: 5,
  });
  h.db.ads_changelog.push({ id: "cl1", status: "pending", approved_by: null });
  h.db.ads_approvals.push({
    id: "ap1",
    client_id: "c1",
    customer_id: "111",
    run_id: "r1",
    action_id: "a-001",
    type: "budget_change",
    entity: "L",
    current_value: "CHF 10.00/Tag",
    proposed_value: "CHF 11.00/Tag",
    rationale: "test",
    payload: { kind: "budget", campaign: "L", dailyChf: 11 },
    status: "pending",
    expires_at: FUTURE,
    changelog_id: "cl1",
    decided_by: null,
    decided_at: null,
    ...over,
  });
}

beforeEach(() => {
  mutateCalls = 0;
  systemStatus = "ENABLED";
});

describe("Learning-Phase-Gate im Execute-Pfad (Abnahme 0.2)", () => {
  it("blockiert den Write bei LEARNING_* mit 423 - Approval bleibt pending", async () => {
    seed();
    systemStatus = "LEARNING_BUDGET_CHANGE";
    const r = await decideApproval({ approvalId: "ap1", decision: "approve", decidedBy: "Tester" });
    expect(r.ok).toBe(false);
    expect(r.httpStatus).toBe(423);
    expect(r.error).toContain("Learning Phase aktiv");
    expect(mutateCalls).toBe(0);
    expect(h.db.ads_approvals[0].status).toBe("pending"); // spaeter erneut freigebbar
  });

  it("isCampaignLearning: LEARNING_* -> true, ENABLED -> false, Query-Fehler -> konservativ true", async () => {
    systemStatus = "LEARNING_NEW";
    expect((await isCampaignLearning("c1", "111", "L")).learning).toBe(true);
    systemStatus = "ENABLED";
    expect((await isCampaignLearning("c1", "111", "L")).learning).toBe(false);
    systemStatus = "__HTTP_FAIL__";
    const failed = await isCampaignLearning("c1", "111", "L");
    expect(failed.learning).toBe(true);
    expect(failed.status).toBe("QUERY_FAILED");
  });
});

describe("Approval-Hygiene (Abnahme 0.3)", () => {
  it("paralleles Doppel-Approve fuehrt genau EINMAL aus; Verlierer erhaelt 409 already_executed", async () => {
    seed();
    const [r1, r2] = await Promise.all([
      decideApproval({ approvalId: "ap1", decision: "approve", decidedBy: "Tester" }),
      decideApproval({ approvalId: "ap1", decision: "approve", decidedBy: "Tester" }),
    ]);
    const okOnes = [r1, r2].filter((r) => r.ok && r.status === "executed");
    const conflicts = [r1, r2].filter((r) => !r.ok && r.httpStatus === 409);
    expect(okOnes).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    expect(mutateCalls).toBe(1); // genau EIN Google-Write
    expect(h.db.ads_approvals[0].status).toBe("executed");
  });

  it("abgelaufenes Approval ist nicht ausfuehrbar (410) und wird als expired markiert", async () => {
    seed({ expires_at: PAST });
    const r = await decideApproval({ approvalId: "ap1", decision: "approve", decidedBy: "Tester" });
    expect(r.httpStatus).toBe(410);
    expect(mutateCalls).toBe(0);
    expect(h.db.ads_approvals[0].status).toBe("expired");
  });

  it("approve ohne decidedBy wird mit 400 abgelehnt (approved_by zwingend)", async () => {
    seed();
    const r = await decideApproval({ approvalId: "ap1", decision: "approve" });
    expect(r.httpStatus).toBe(400);
    expect(mutateCalls).toBe(0);
    expect(h.db.ads_approvals[0].status).toBe("pending");
  });

  it("approved_by landet nach Freigabe im Changelog", async () => {
    seed();
    const r = await decideApproval({ approvalId: "ap1", decision: "approve", decidedBy: "Volkan" });
    expect(r.ok).toBe(true);
    expect(h.db.ads_changelog[0].approved_by).toBe("Volkan");
    expect(h.db.ads_changelog[0].status).toBe("executed");
  });
});
