import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { SKILL_CATALOG } from "@/ezy/data/skillCatalog";

// Skill-Katalog fuer die Claude App/Desktop (2026-07-20): welche Faehigkeiten
// die EzyOne-Agenten haben koennen. Read-only Grundlage fuer agent_upsert —
// dort duerfen nur Skills aus genau diesem Katalog vergeben werden.

export default defineTool({
  name: "list_skills",
  title: "Agenten-Skills auflisten",
  description:
    "Liste aller installierten Agenten-Skills (SEO/GEO/Blog/Ads/Obsidian) mit Beschreibung. " +
    "Nutze die `skill`-Werte (Format plugin:skill) fuer agent_upsert.",
  inputSchema: {
    category: z.string().optional().describe("Optional nach Kategorie filtern (z.B. 'skills-seo')."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ category }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const skills = SKILL_CATALOG.filter((s) => !category || s.category === category).map((s) => ({
      skill: `${s.plugin}:${s.skill}`,
      category: s.category,
      description: s.description,
      note: s.note,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(skills) }],
      structuredContent: { skills },
    };
  },
});
