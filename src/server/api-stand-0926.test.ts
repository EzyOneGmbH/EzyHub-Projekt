// API-Stand 09/2026 (21.09.2026): Ahrefs is_spam im Backlink-Overview,
// limits-and-usage-Auswertung und die Supabase-API-Key-Umstellung
// (sb_secret_… / sb_publishable_… mit Legacy-Fallback).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  berechneSpam,
  parseAhrefsUnits,
  fetchAhrefsLimits,
  fetchBacklinkOverviewAhrefs,
} from "./backlink-overview.server";
import { supabaseSecretKey, supabaseKeyTyp } from "@/integrations/supabase/client.server";

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("berechneSpam", () => {
  it("Anteil an live_refdomains, gerundet auf 4 Stellen", () => {
    const s = berechneSpam(12, 300, true);
    expect(s).toEqual({
      spamDomains: 12,
      spamAnteil: 0.04,
      liveRefdomains: 300,
      capped: false,
      ohneSpam: true,
    });
  });
  it("ohne Basis kein Anteil; Deckel markiert Untergrenze", () => {
    expect(berechneSpam(5, null, false).spamAnteil).toBeNull();
    expect(berechneSpam(5, 0, false).liveRefdomains).toBeNull();
    expect(berechneSpam(1000, 2000, true, 1000).capped).toBe(true);
    expect(berechneSpam(999, 2000, true, 1000).capped).toBe(false);
  });
  it("Anteil nie über 1", () => {
    expect(berechneSpam(50, 10, true).spamAnteil).toBe(1);
  });
});

describe("parseAhrefsUnits / fetchAhrefsLimits", () => {
  const raw = {
    limits_and_usage: {
      subscription: "Advanced",
      units_limit_api_key: 10000,
      units_usage_api_key: 2500,
      units_limit_workspace: 50000,
      units_usage_workspace: 12000,
      usage_reset_date: "2026-10-01",
      api_key_expiration_date: "2027-01-01T00:00:00Z",
    },
  };
  it("liest Limit/Verbrauch/Reset und rechnet den Anteil", () => {
    const u = parseAhrefsUnits(raw)!;
    expect(u.units_limit_api_key).toBe(10000);
    expect(u.units_usage_api_key).toBe(2500);
    expect(u.verbrauchAnteil).toBe(0.25);
    expect(u.usage_reset_date).toBe("2026-10-01");
    expect(u.subscription).toBe("Advanced");
  });
  it("unlimitierter Key (null) → kein Anteil; fehlender Block → null", () => {
    const u = parseAhrefsUnits({
      limits_and_usage: { ...raw.limits_and_usage, units_limit_api_key: null },
    })!;
    expect(u.units_limit_api_key).toBeNull();
    expect(u.verbrauchAnteil).toBeNull();
    expect(parseAhrefsUnits({})).toBeNull();
    expect(parseAhrefsUnits(null)).toBeNull();
  });

  const origFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = origFetch;
  });
  it("fetchAhrefsLimits ruft den kostenlosen Endpunkt und wertet aus", async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: any) => {
      calls.push(String(input));
      return jsonRes(raw);
    }) as any;
    const r = await fetchAhrefsLimits("Bearer test");
    expect(calls[0]).toContain("/v3/subscription-info/limits-and-usage");
    expect(r.ok && r.units.verbrauchAnteil).toBe(0.25);
  });
  it("429 wird als Rate-Limit gemeldet, Key landet nie im Fehlertext", async () => {
    globalThis.fetch = vi.fn(async () => new Response("Bearer secret-xyz", { status: 429 })) as any;
    const r = await fetchAhrefsLimits("Bearer secret-xyz");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(429);
      expect(r.error).not.toContain("secret-xyz");
    }
  });
});

describe("fetchBacklinkOverviewAhrefs: is_spam", () => {
  const origFetch = globalThis.fetch;
  let urls: URL[] = [];
  beforeEach(() => {
    urls = [];
    globalThis.fetch = vi.fn(async (input: any) => {
      const u = new URL(String(input));
      urls.push(u);
      if (u.pathname.endsWith("/backlinks-stats"))
        return jsonRes({ metrics: { live: 900, live_refdomains: 200 } });
      if (u.pathname.endsWith("/referring-domains")) {
        const where = u.searchParams.get("where") || "";
        if (where.includes("true"))
          return jsonRes({
            refdomains: Array.from({ length: 8 }, (_, i) => ({ domain: `s${i}` })),
          });
        return jsonRes({
          refdomains: [{ domain: "gut.ch", domain_rating: 70, is_spam: false }],
        });
      }
      return jsonRes({ ok: true });
    }) as any;
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("zählt Spam-Domains per where is_spam=true und weist den Anteil aus", async () => {
    const o = await fetchBacklinkOverviewAhrefs("example.ch", "Bearer t");
    expect(o.spam).toEqual({
      spamDomains: 8,
      spamAnteil: 0.04,
      liveRefdomains: 200,
      capped: false,
      ohneSpam: true,
    });
    const rd = urls.filter((u) => u.pathname.endsWith("/referring-domains"));
    expect(rd).toHaveLength(2);
    const zaehlung = rd.find((u) => (u.searchParams.get("where") || "").includes("true"))!;
    expect(JSON.parse(zaehlung.searchParams.get("where")!)).toEqual({
      field: "is_spam",
      is: ["eq", true],
    });
    expect(zaehlung.searchParams.get("history")).toBe("live");
    const top = rd.find((u) => u !== zaehlung)!;
    expect(top.searchParams.get("select")).toContain("is_spam");
    expect(JSON.parse(top.searchParams.get("where")!)).toEqual({
      field: "is_spam",
      is: ["eq", false],
    });
    expect((o.referring_domains as any).refdomains[0].domain).toBe("gut.ch");
    expect(o.all_failed).toBe(false);
    expect(o.errors.spam).toBeNull();
  });

  it("ohneSpam=false: Top-Liste ohne Where-Filter, Anteil trotzdem ausgewiesen", async () => {
    const o = await fetchBacklinkOverviewAhrefs("example.ch", "Bearer t", { ohneSpam: false });
    const top = urls.filter(
      (u) =>
        u.pathname.endsWith("/referring-domains") &&
        (u.searchParams.get("select") || "").includes("domain_rating"),
    );
    expect(top).toHaveLength(1);
    expect(top[0].searchParams.has("where")).toBe(false);
    expect(o.spam?.ohneSpam).toBe(false);
    expect(o.spam?.spamDomains).toBe(8);
  });

  it("Spam-Abruf-Fehler macht den Lauf nicht «failed»", async () => {
    globalThis.fetch = vi.fn(async (input: any) => {
      const u = new URL(String(input));
      if (u.pathname.endsWith("/referring-domains")) return new Response("boom", { status: 500 });
      if (u.pathname.endsWith("/backlinks-stats"))
        return jsonRes({ metrics: { live_refdomains: 10 } });
      return jsonRes({ ok: true });
    }) as any;
    const o = await fetchBacklinkOverviewAhrefs("example.ch", "Bearer t");
    expect(o.spam).toBeNull();
    expect(o.referring_domains).toBeNull();
    expect(o.errors.spam).toMatch(/HTTP 500/);
    expect(o.all_failed).toBe(false);
  });
});

describe("Supabase-API-Key-Umstellung", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });
  it("sb_secret_… hat Vorrang vor dem Legacy-Service-Role-Key", () => {
    process.env.SUPABASE_SECRET_KEY = "sb_secret_abc";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJlegacy";
    expect(supabaseSecretKey()).toBe("sb_secret_abc");
    expect(supabaseKeyTyp().secret).toBe("sb_secret");
  });
  it("Fallback auf SUPABASE_SERVICE_ROLE_KEY wird als legacy ausgewiesen", () => {
    delete process.env.SUPABASE_SECRET_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJlegacy";
    expect(supabaseSecretKey()).toBe("eyJlegacy");
    expect(supabaseKeyTyp().secret).toBe("legacy_service_role");
  });
  it("Publishable-Typ: sb_publishable_ vs. anon-JWT vs. fehlt", () => {
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_x";
    expect(supabaseKeyTyp()).toEqual({ secret: "fehlt", publishable: "sb_publishable" });
    process.env.SUPABASE_PUBLISHABLE_KEY = "eyJanon";
    expect(supabaseKeyTyp().publishable).toBe("legacy_anon");
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_ANON_KEY;
    expect(supabaseKeyTyp().publishable).toBe("fehlt");
  });
});
