// Zwischenspeicher (06.10.2026): Browser-Speicher gehört einem Login; der
// Server speichert nur vollständige Performance-Zeilen.
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import { cacheGet, cachePut, setzeCacheBesitzer } from "./data/rangeStore";
import { seoZeileSpeicherbar } from "@/server/seo-overview.server";

describe("Browser-Zwischenspeicher", () => {
  beforeEach(() => localStorage.clear());

  it("bleibt für denselben Login erhalten", () => {
    setzeCacheBesitzer("user-a");
    cachePut("kacheln:seo:x", { a: 1 });
    setzeCacheBesitzer("user-a");
    expect(cacheGet("kacheln:seo:x")?.data).toEqual({ a: 1 });
  });

  it("wird bei anderem Login und beim Abmelden geleert", () => {
    setzeCacheBesitzer("user-a");
    cachePut("kacheln:seo:x", { a: 1 });
    setzeCacheBesitzer("user-b");
    expect(cacheGet("kacheln:seo:x")).toBeNull();
    cachePut("run:k", { b: 2 });
    setzeCacheBesitzer(null);
    expect(cacheGet("run:k")).toBeNull();
    // fremde Schlüssel (z. B. Sprache) bleiben unberührt
    localStorage.setItem("ezy.lang.v1", "fr");
    setzeCacheBesitzer("user-c");
    expect(localStorage.getItem("ezy.lang.v1")).toBe("fr");
  });
});

describe("Server-Zwischenspeicher: nur vollständige Zeilen", () => {
  it("speichert Zeilen ohne Google-Fehler", () => {
    expect(seoZeileSpeicherbar({ hinweise: [], error: null })).toBe(true);
    expect(
      seoZeileSpeicherbar({ hinweise: ["Kein Sistrix-Wert bis Zeitraum-Ende"], error: null }),
    ).toBe(true);
  });
  it("hält Google-Fehler nicht eine Stunde fest", () => {
    expect(seoZeileSpeicherbar({ hinweise: ["GA4: HTTP 500"], error: null })).toBe(false);
    expect(seoZeileSpeicherbar({ hinweise: ["Search Console: Quota"], error: null })).toBe(false);
    expect(seoZeileSpeicherbar({ hinweise: ["Google nicht verbunden"], error: null })).toBe(false);
    expect(seoZeileSpeicherbar({ hinweise: [], error: "x" })).toBe(false);
  });
});
