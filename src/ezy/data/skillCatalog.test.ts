import { describe, it, expect } from "vitest";
import { SKILL_CATALOG } from "./skillCatalog";

// Beim Aufnehmen eines neuen Plugins in den Katalog hier mitpflegen.
const VALID_CATEGORIES = [
  "skills-seo",
  "skills-blog",
  "skills-obsidian",
  "skills-ads",
  "skills-reaktivierung",
];
const VALID_PLUGINS = [
  "claude-seo",
  "claude-blog",
  "claude-obsidian",
  "claude-ads",
  "ezy-reaktivierung",
];

describe("SKILL_CATALOG", () => {
  it("is non-empty", () => {
    expect(SKILL_CATALOG.length).toBeGreaterThan(0);
  });

  it("has unique ids, all prefixed with skill:", () => {
    const ids = SKILL_CATALOG.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith("skill:")).toBe(true);
  });

  it("each id matches skill:<skill>", () => {
    for (const s of SKILL_CATALOG) expect(s.id).toBe(`skill:${s.skill}`);
  });

  it("each entry has valid category and plugin and a non-empty description", () => {
    for (const s of SKILL_CATALOG) {
      expect(VALID_CATEGORIES).toContain(s.category);
      expect(VALID_PLUGINS).toContain(s.plugin);
      expect(typeof s.description).toBe("string");
      expect(s.description.length).toBeGreaterThan(0);
    }
  });
});
