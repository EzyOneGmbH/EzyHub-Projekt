// Gratis-Takt (11.10.2026): richtige Jobs je Kunde, Reihenfolge stalest-first.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
import { gratisJobsFuer, reihenfolge, MIN_ABSTAND_MS } from "./gratis-takt.server";

const k = (p: Partial<Parameters<typeof gratisJobsFuer>[0]>) => ({
  id: "k",
  name: "K",
  domain: "k.ch",
  gsc_property: "sc-domain:k.ch",
  ga4_property: "123",
  ...p,
});

describe("Gratis-Takt", () => {
  it("nur kostenlose Jobs — nie Ahrefs/Rankings/Ads", () => {
    const jobs = gratisJobsFuer(k({}), new Set());
    expect(jobs.sort()).toEqual(
      [
        "ga4",
        "ga4_conversions",
        "ga4_traffic",
        "gsc",
        "gsc_queries",
        "pagespeed",
        "seo_history",
      ].sort(),
    );
    expect(jobs).not.toContain("ahrefs");
    expect(jobs).not.toContain("google_ads");
  });

  it("respektiert die App-Freischaltung wie der Sammellauf", () => {
    expect(gratisJobsFuer(k({}), new Set(["seo"]))).toEqual([
      "ga4",
      "ga4_traffic",
      "ga4_conversions",
    ]);
    expect(gratisJobsFuer(k({}), new Set(["seo", "geo"]))).toEqual([]);
    expect(gratisJobsFuer(k({ gsc_property: null, ga4_property: null }), new Set())).toEqual([
      "pagespeed",
    ]);
  });

  it("am längsten nicht bearbeitet zuerst, frische Kunden warten", () => {
    const jetzt = 10 * MIN_ABSTAND_MS;
    const zuletzt = new Map([
      ["a", jetzt - MIN_ABSTAND_MS - 1],
      ["b", jetzt - 5 * MIN_ABSTAND_MS],
      ["c", jetzt - 1000],
    ]);
    const kunden = ["a", "b", "c", "d"].map((id) => ({ id, jobs: ["gsc"] }));
    expect(reihenfolge(kunden, zuletzt, jetzt)).toEqual(["d", "b", "a"]);
    expect(reihenfolge([{ id: "x", jobs: [] }], new Map(), jetzt)).toEqual([]);
  });
});
