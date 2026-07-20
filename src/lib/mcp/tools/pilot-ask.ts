import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { pilotScope, pilotThrottled, pilotAskUpstream } from "@/server/pilot.server";

// EzyPilot in der Claude App/Desktop (2026-07-20): stellt eine Frage an das
// EzyOne-Firmen-Gedaechtnis (Obsidian-Vault). Antwortet ausschliesslich aus
// den Vault-Auszuegen, die der SERVER fuer den angemeldeten Nutzer freigibt
// (owner/admin = alles; Mitarbeitende = nur zugewiesene Kunden + kundenneutrale
// Doku). Der Dienst ist werkzeuglos und rein lesend.

export default defineTool({
  name: "pilot_ask",
  title: "EzyPilot fragen",
  description:
    "Frage das EzyOne-Firmen-Gedaechtnis (Kunden-Status, laufende SEO/GEO-Massnahmen, interne Ablaeufe). " +
    "Antwortet nur aus dem Vault, mit Quellen-Dateipfaden; sagt es klar, wenn nichts dokumentiert ist. " +
    "mode 'kunden' (Default) = deine zugewiesenen Kunden + neutrale Firmen-Doku; " +
    "mode 'allgemein' = bewusst NUR kundenunabhaengige Unternehmens-Doku. " +
    "Rein lesend — kann nichts aendern oder deployen.",
  inputSchema: {
    question: z.string().min(3).max(2000).describe("Die Frage auf Deutsch."),
    mode: z.enum(["kunden", "allgemein"]).optional().describe("Default: kunden."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ question, mode }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const userId = ctx.getUserId();
    if (!userId) return { content: [{ type: "text", text: "Kein Nutzer im Token." }], isError: true };
    const scope = await pilotScope(userId);
    if (!scope) return { content: [{ type: "text", text: "Kein Organisations-Zugang." }], isError: true };
    if (pilotThrottled(userId)) {
      return { content: [{ type: "text", text: "Zu viele Anfragen — bitte in einer Stunde erneut versuchen." }], isError: true };
    }
    const out = await pilotAskUpstream({ question, mode, scope });
    if (!out.ok) {
      return { content: [{ type: "text", text: `Fehler: ${out.error || `HTTP ${out.status}`}` }], isError: true };
    }
    const sources = (out.sources || []) as string[];
    const text = sources.length ? `${out.answer}\n\nQuellen: ${sources.join(", ")}` : String(out.answer || "");
    return {
      content: [{ type: "text", text }],
      structuredContent: { answer: out.answer, sources },
    };
  },
});
