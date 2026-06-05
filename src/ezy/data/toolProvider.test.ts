import { describe, it, expect } from "vitest";
import { toolProvider } from "./useEzyToolSettings";

describe("toolProvider", () => {
  it("maps canonry to the canonry provider", () => {
    expect(toolProvider("canonry")).toBe("canonry");
  });

  it("maps the Ahrefs-backed audits to the ahrefs provider", () => {
    for (const id of ["open-seo-audit", "full-seo-audit", "technical-audit", "on-page-audit"]) {
      expect(toolProvider(id)).toBe("ahrefs");
    }
  });

  it("maps the GEO audit to perplexity", () => {
    expect(toolProvider("geo-aeo-audit")).toBe("perplexity");
  });

  it("maps the curated content tools to anthropic", () => {
    for (const id of ["generate-blog", "blog-outline", "content-brief", "schema-markup"]) {
      expect(toolProvider(id)).toBe("anthropic");
    }
  });

  it("maps any catalog skill (skill:<name>) to anthropic", () => {
    expect(toolProvider("skill:seo-page")).toBe("anthropic");
    expect(toolProvider("skill:blog-write")).toBe("anthropic");
    expect(toolProvider("skill:wiki")).toBe("anthropic");
  });

  it("returns null for unknown tools (so they stay client-only)", () => {
    expect(toolProvider("does-not-exist")).toBeNull();
  });
});
