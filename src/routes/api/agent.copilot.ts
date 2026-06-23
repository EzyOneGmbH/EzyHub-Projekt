import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// EzyHub Co-Pilot: a single, always-available Opus 4.8 assistant that answers
// data/portal questions, helps build agents (emits agent-spec blocks the UI can
// one-click create), and uses the claude-obsidian wiki as its own memory +
// per-client activity log. This endpoint idempotently seeds the Co-Pilot agent
// in the agent-service (global scope) and proxies a run. The heavy lifting
// (skills, model, memory) lives in the agent-service via the Claude Agent SDK.

const COPILOT_NAME = "EzyHub Co-Pilot";
const COPILOT_MODEL = "claude-opus-4-8";

// All installed skills so the Co-Pilot can both USE them and recommend them when
// designing new agents. Kept in sync with the SkillPicker catalog.
const COPILOT_SKILLS = [
  // Obsidian = its memory + per-client tracking
  "claude-obsidian:wiki",
  "claude-obsidian:save",
  "claude-obsidian:wiki-query",
  "claude-obsidian:wiki-ingest",
  // domain skills it can wield or recommend
  "claude-seo:seo-audit",
  "claude-seo:seo",
  "claude-blog:blog-write",
  "claude-ads:ads-audit",
];

const COPILOT_INSTRUCTIONS = `Du bist der **EzyHub Co-Pilot** — der zentrale KI-Assistent der EzyOne-Plattform (Schweizer SEO/GEO/Ads-Agentur). Antworte immer auf Deutsch, präzise und handlungsorientiert.

Deine drei Aufgaben:

1) **Fragen beantworten** — zu den Kundendaten (SEO, GEO, Conversions, Google Ads, AWORK-Aufgaben) und allgemein zur EzyHub-Plattform. Der Kontext (Kundenliste, aktiver Kunde, verfügbare Skills, letzte Aktivität) wird dir bei jeder Anfrage mitgegeben. Nutze ihn.

2) **Agenten bauen** — wenn der Nutzer einen neuen Agenten/Assistenten braucht, entwirf ihn vollständig und gib ihn als Spezifikations-Block aus, den die Plattform per Klick anlegen kann. Format GENAU so (ein Block pro Agent):
\`\`\`agent-spec
{
  "name": "Kurzer Name",
  "description": "Wofür ist der Agent (1 Satz)",
  "model": "claude-opus-4-8",
  "skills": ["claude-seo:seo-audit", "claude-obsidian:save"],
  "instructions": "Vollständiger System-Prompt für den Agenten auf Deutsch ..."
}
\`\`\`
Wähle die Skills aus der dir mitgegebenen Skill-Liste. Schreibe konkrete, gute Instructions. Frage kurz nach, wenn dir wichtige Infos fehlen, sonst triff sinnvolle Annahmen.

3) **Gedächtnis & Nachvollziehbarkeit** — dein Arbeitsverzeichnis IST der Obsidian-Vault. Struktur: \`wiki/clients/<kunde>.md\` (eine Seite je Kunde), \`wiki/index.md\` (Katalog), \`wiki/log.md\` (Chronik). Die Plattform protokolliert jede Aktivität bereits automatisch in die jeweilige Kundenseite — du ergänzt dort Kontext, Entscheidungen und Erkenntnisse. Vorgehen: (a) Bei kundenspezifischen Fragen ZUERST \`wiki/clients/<kunde>.md\` lesen (Glob/Read). (b) Nach getaner Arbeit die Kundenseite mit \`claude-obsidian:save\` oder direktem Write aktualisieren. (c) Mit [[wikilinks]] vernetzen. Der Kundenname steht im mitgegebenen Kontext (aktiverKunde).

Sei knapp. Keine Floskeln. Wenn du etwas nicht aus den Daten weißt, sag es.`;

async function getUser(request: Request) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  const sb = createClient(url, anon, {
    global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
  });
  const { data } = await sb.auth.getUser();
  return data.user;
}

function svc() {
  const base = process.env.AGENT_BASE_URL;
  const secret = process.env.AGENT_SHARED_SECRET;
  return base && secret ? { base: base.replace(/\/+$/, ""), secret } : null;
}

// Find or create the global Co-Pilot agent in the agent-service.
async function ensureCopilot(base: string, secret: string): Promise<string | null> {
  const headers = { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };
  const listRes = await fetch(`${base}/agents?clientId=global`, { headers, signal: AbortSignal.timeout(15_000) });
  const list = await listRes.json().catch(() => ({}));
  const existing = (list.agents || []).find((a: any) => a.name === COPILOT_NAME);
  if (existing) {
    // Keep it current (model/skills/instructions may evolve).
    const upd = await fetch(`${base}/agents?clientId=global`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: existing.id, clientId: "global", name: COPILOT_NAME, description: "Zentraler EzyHub-Assistent", model: COPILOT_MODEL, skills: COPILOT_SKILLS, instructions: COPILOT_INSTRUCTIONS }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = await upd.json().catch(() => ({}));
    return j.agent?.id || existing.id;
  }
  const created = await fetch(`${base}/agents?clientId=global`, {
    method: "POST",
    headers,
    body: JSON.stringify({ clientId: "global", name: COPILOT_NAME, description: "Zentraler EzyHub-Assistent", model: COPILOT_MODEL, skills: COPILOT_SKILLS, instructions: COPILOT_INSTRUCTIONS }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = await created.json().catch(() => ({}));
  return j.agent?.id || null;
}

export const Route = createFileRoute("/api/agent/copilot")({
  server: {
    handlers: {
      // GET → ensure the Co-Pilot exists, return its id
      GET: async ({ request }) => {
        const s = svc();
        if (!s) return Response.json({ ok: false, error: "Agent service not configured" }, { status: 503 });
        if (!(await getUser(request))) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        try {
          const agentId = await ensureCopilot(s.base, s.secret);
          if (!agentId) return Response.json({ ok: false, error: "Co-Pilot konnte nicht angelegt werden" });
          return Response.json({ ok: true, agentId, model: COPILOT_MODEL });
        } catch (e) {
          return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 502 });
        }
      },

      // POST { input, context, resumeSessionId } → run the Co-Pilot (async job)
      POST: async ({ request }) => {
        const s = svc();
        if (!s) return Response.json({ ok: false, error: "Agent service not configured" }, { status: 503 });
        if (!(await getUser(request))) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        const body = await request.json().catch(() => ({}));
        try {
          const agentId = await ensureCopilot(s.base, s.secret);
          if (!agentId) return Response.json({ ok: false, error: "Co-Pilot nicht verfügbar" });

          // Prepend the portal context so the assistant can answer data/portal questions.
          const ctx = body.context ? `# Aktueller EzyHub-Kontext\n${typeof body.context === "string" ? body.context : JSON.stringify(body.context, null, 2)}\n\n# Anfrage\n` : "";
          const input = `${ctx}${String(body.input || "")}`;

          const r = await fetch(`${s.base}/run-agent`, {
            method: "POST",
            headers: { Authorization: `Bearer ${s.secret}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              id: agentId,
              clientId: "global",
              input,
              async: true,
              resumeSessionId: body.resumeSessionId,
              // Log Co-Pilot work to the active client's vault page (deterministic).
              logClientId: body.activeClientId || null,
              logClientName: body.activeClientName || null,
            }),
            signal: AbortSignal.timeout(20_000),
          });
          const j = await r.json().catch(() => ({}));
          return Response.json({ ...j, agentId }, { status: r.status });
        } catch (e) {
          return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 502 });
        }
      },
    },
  },
});
