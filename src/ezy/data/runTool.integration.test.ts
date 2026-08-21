// Integrationstest executeTool (Regressionstest 2026-08-21): der komplette
// Client-Pfad eines synchronen Tool-Laufs mit gemocktem Netz. Kernpunkt:
// Routen, die Fehler als HTTP 200 + { ok:false } melden (PageSpeed) oder als
// 200 mit all-failed-errors (Backlink-Overview), dürfen NIE als Erfolg enden.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({ ezyFetch: vi.fn() }));
vi.mock("./useEzyToolSettings", () => ({ toolProvider: () => "google" }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: vi.fn(() => {
      throw new Error("audit_runs-Insert darf bei serverPersists nicht laufen");
    }),
  },
}));

import { executeTool } from "./runTool";
import { ezyFetch } from "./api";

const CLIENT = { id: "20000000-0000-4000-8000-000000000001", domain: "kunde.ch", name: "Kunde" };

const resp = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

beforeEach(() => {
  vi.mocked(ezyFetch).mockReset();
});

describe("executeTool: synchrone Mess-Routen", () => {
  it("CWV-Audit: HTTP 200 + ok:false ist ein Fehler, kein Erfolg", async () => {
    vi.mocked(ezyFetch).mockResolvedValue(
      resp(200, { ok: false, error: "PSI quota überschritten" }),
    );
    const r = await executeTool("cwv-audit", CLIENT, {});
    expect(r.ok).toBe(false);
    expect(r.error).toBe("PSI quota überschritten");
    expect(r.message).toContain("PSI quota");
  });

  it("CWV-Audit: HTTP 200 + ok:true bleibt Erfolg", async () => {
    vi.mocked(ezyFetch).mockResolvedValue(resp(200, { ok: true, metrics: { lcp: 1800 } }));
    const r = await executeTool("cwv-audit", CLIENT, {});
    expect(r.ok).toBe(true);
    expect(r.message).toBe("Live-Lauf abgeschlossen");
  });

  it("SEO-Audit (Backlink-Overview): all-failed auf HTTP 200 ist ein Fehler", async () => {
    vi.mocked(ezyFetch).mockResolvedValue(
      resp(200, {
        ok: false,
        error: "Alle DataForSEO-Sektionen fehlgeschlagen",
        errors: { summary: "timeout", history: "timeout", labs: "timeout" },
      }),
    );
    const r = await executeTool("open-seo-audit", CLIENT, {});
    expect(r.ok).toBe(false);
  });

  it("SEO-Audit: teilweiser Ausfall bleibt Erfolg mit Hinweis", async () => {
    vi.mocked(ezyFetch).mockResolvedValue(
      resp(200, {
        ok: true,
        errors: { summary: null, history: "timeout", labs: null },
        backlinks_stats: { backlinks: 12 },
      }),
    );
    const r = await executeTool("open-seo-audit", CLIENT, {});
    expect(r.ok).toBe(true);
    expect(r.message).toBe("Live-Lauf teilweise erfolgreich");
  });

  it("HTTP-Fehler bleibt Fehler (kein Regressionsverlust)", async () => {
    vi.mocked(ezyFetch).mockResolvedValue(resp(503, { error: "Server not configured" }));
    const r = await executeTool("cwv-audit", CLIENT, {});
    expect(r.ok).toBe(false);
    expect(r.error).toBe("Server not configured");
  });
});
