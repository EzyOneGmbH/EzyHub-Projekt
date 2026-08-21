import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { pilotScope, svc } from "@/server/pilot.server";
import { SKILL_CATALOG } from "@/ezy/data/skillCatalog";

// Agenten-Verwaltung aus der Claude App/Desktop (Volkan-Wunsch 2026-07-20):
// bestehende Agenten einsehen und ihre Skills/Instruktionen erweitern bzw.
// neue Agenten anlegen — wie die agent-spec-Bloecke des Portal-EzyPilots, nur
// direkt als Tool. NUR owner/admin (dieselbe Grenze wie der Portal-Copilot):
// ein Agent ist ein voller Akteur mit Deploy-Faehigkeiten, das ist keine
// Mitarbeiter-Funktion. Skills werden gegen den installierten Katalog
// validiert — es kann nichts "erfunden" werden.

const VALID_SKILLS = new Set(SKILL_CATALOG.map((s) => `${s.plugin}:${s.skill}`));

async function requireAdmin(ctx: any) {
  if (!ctx.isAuthenticated()) return { err: "Not authenticated" };
  const userId = ctx.getUserId();
  if (!userId) return { err: "Kein Nutzer im Token." };
  const scope = await pilotScope(userId);
  if (!scope) return { err: "Kein Organisations-Zugang." };
  if (!scope.isOwner) return { err: "Nur owner/admin duerfen Agenten verwalten." };
  return { scope };
}

export const agentListTool = defineTool({
  name: "agent_list",
  title: "Agenten auflisten",
  description:
    "Liste der eingerichteten EzyOne-Agenten eines Kunden (client_id, Default 'global'): Name, Modell, Skills, Beschreibung. Nur owner/admin.",
  inputSchema: {
    client_id: z.string().max(80).optional().describe("Kunden-ID oder 'global' (Default)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ client_id }, ctx) => {
    const gate = await requireAdmin(ctx);
    if ("err" in gate && gate.err)
      return { content: [{ type: "text", text: gate.err }], isError: true };
    const s = svc();
    if (!s)
      return { content: [{ type: "text", text: "Agent service not configured" }], isError: true };
    const r = await fetch(
      `${s.base}/agents?clientId=${encodeURIComponent(client_id || "global")}&org=${encodeURIComponent(gate.scope!.organizationId)}`,
      {
        headers: { Authorization: `Bearer ${s.secret}` },
        signal: AbortSignal.timeout(15_000),
      },
    );
    const j = await r.json().catch(() => ({}));
    const agents = (j.agents || []).map((a: any) => ({
      id: a.id,
      name: a.name,
      model: a.model,
      skills: a.skills,
      description: a.description,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(agents) }],
      structuredContent: { agents },
    };
  },
});

export const agentUpsertTool = defineTool({
  name: "agent_upsert",
  title: "Agent anlegen/erweitern",
  description:
    "Legt einen EzyOne-Agenten an oder erweitert einen bestehenden (id angeben = Update): Skills hinzufuegen, " +
    "Instruktionen/Modell/Beschreibung aendern. Skills muessen aus list_skills stammen (Format plugin:skill). " +
    "Nur owner/admin. Vor dem Aufruf die geplante Aenderung dem Nutzer zeigen und bestaetigen lassen. " +
    "Hinweis: Der Agent wird dadurch NICHT gestartet — Zeitplaene/Laeufe laufen weiter ueber EzyHub.",
  inputSchema: {
    id: z.string().max(80).optional().describe("Agent-ID fuer Update; weglassen = neu anlegen."),
    client_id: z.string().max(80).optional().describe("Kunden-ID oder 'global' (Default)."),
    name: z.string().min(2).max(80).describe("Name des Agenten."),
    description: z.string().max(300).optional(),
    model: z.string().max(60).optional().describe("Default: claude-sonnet-4-6."),
    skills: z
      .array(z.string())
      .max(24)
      .describe("Skills aus list_skills, z.B. ['claude-seo:seo-audit']."),
    instructions: z
      .string()
      .min(20)
      .max(20000)
      .describe("Vollstaendiger System-Prompt auf Deutsch."),
  },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ id, client_id, name, description, model, skills, instructions }, ctx) => {
    const gate = await requireAdmin(ctx);
    if ("err" in gate && gate.err)
      return { content: [{ type: "text", text: gate.err }], isError: true };
    const invalid = (skills || []).filter((sk: string) => !VALID_SKILLS.has(sk));
    if (invalid.length) {
      return {
        content: [
          {
            type: "text",
            text: `Unbekannte Skills: ${invalid.join(", ")} — gueltige Werte liefert list_skills.`,
          },
        ],
        isError: true,
      };
    }
    const s = svc();
    if (!s)
      return { content: [{ type: "text", text: "Agent service not configured" }], isError: true };
    const clientId = client_id || "global";
    const orgId = gate.scope!.organizationId;
    const r = await fetch(
      `${s.base}/agents?clientId=${encodeURIComponent(clientId)}&org=${encodeURIComponent(orgId)}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${s.secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(id ? { id } : {}),
          clientId,
          name,
          description: description || "",
          model: model || "claude-sonnet-4-6",
          skills,
          instructions,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.agent) {
      return {
        content: [{ type: "text", text: `Fehler: ${j.error || `HTTP ${r.status}`}` }],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: "text",
          text: `Agent "${j.agent.name}" gespeichert (id ${j.agent.id}, ${skills.length} Skills).`,
        },
      ],
      structuredContent: { agent: { id: j.agent.id, name: j.agent.name, skills: j.agent.skills } },
    };
  },
});
