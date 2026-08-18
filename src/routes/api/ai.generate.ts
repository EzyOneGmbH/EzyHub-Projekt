import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isProviderEnabled, canRunAudits } from "@/server/integrations.server";
import { generateViaSubscription } from "@/server/claude-generate.server";
import { recordApiCost } from "@/server/api-cost.server";

const Body = z.object({
  clientId: z.string().uuid(),
  kind: z.enum(["blog", "obsidian", "summary", "content-brief", "outline", "meta", "schema"]),
  // shared / blog
  topic: z.string().max(500).optional(),
  tone: z.string().max(100).optional(),
  length: z.string().max(100).optional(),
  language: z.string().max(50).optional(),
  keywords: z.string().max(2000).optional(),
  keyword: z.string().max(200).optional(),
  audience: z.string().max(300).optional(),
  // obsidian / summary / schema
  title: z.string().max(300).optional(),
  content: z.string().max(20000).optional(),
  tags: z.string().max(300).optional(),
  text: z.string().max(20000).optional(),
  schemaType: z.string().max(60).optional(),
});

// Modell per ENV überschreibbar. Aktuelle IDs: https://docs.claude.com/en/docs/about-claude/models
// (sonnet-4-20250514 wurde von der API zurückgezogen -> 404 not_found_error)
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";

function redact(input: unknown, secrets: Array<string | undefined>): string {
  let s =
    typeof input === "string" ? input : input instanceof Error ? input.message : String(input);
  for (const v of secrets) {
    if (!v || v.length < 4) continue;
    s = s.split(v).join("***REDACTED***");
  }
  s = s.replace(/Bearer\s+[A-Za-z0-9\-_.=]+/gi, "Bearer ***REDACTED***");
  s = s.replace(/sk-ant-[A-Za-z0-9\-_]+/g, "***REDACTED***");
  return s.slice(0, 500);
}

function lengthToWords(l?: string): number {
  if (!l) return 1200;
  if (l.includes("600")) return 600;
  if (l.includes("2500")) return 2500;
  if (l.includes("5000")) return 5000;
  return 1200;
}

const CH_RULE =
  "Verwende schweizerische Rechtschreibung (ss statt ß). Antworte direkt, ohne Vorrede.";

function buildPrompt(d: z.infer<typeof Body>): {
  system: string;
  user: string;
  maxTokens: number;
} {
  const lang = d.language ?? "Deutsch";
  switch (d.kind) {
    case "blog": {
      const words = lengthToWords(d.length);
      return {
        system: `Du bist ein erfahrener SEO- und GEO-Texter für eine Schweizer Agentur. Schreibe vollständig SEO- und GEO-optimierte Artikel: klare H2/H3-Struktur, FAQ-Sektion, natürliche Keyword-Integration, kurze Absätze. ${CH_RULE}`,
        user: `Schreibe einen Blog-Artikel.
Thema/Keyword: ${d.topic ?? ""}
Tonalität: ${d.tone ?? "Professionell"}
Sprache: ${lang}
Ziel-Länge: ca. ${words} Wörter.`,
        maxTokens: Math.min(8000, Math.ceil(words * 2.2)),
      };
    }
    case "obsidian":
      return {
        system: `Du konvertierst Inhalte in eine saubere Obsidian-Note: YAML-Frontmatter (title, tags, date), klare Markdown-Struktur, sinnvolle [[Wikilinks]] und #tags. ${CH_RULE}`,
        user: `Titel: ${d.title ?? ""}
Tags: ${d.tags ?? ""}
Inhalt:
${d.content ?? ""}`,
        maxTokens: 4000,
      };
    case "content-brief":
      return {
        system: `Du bist SEO-Stratege. Erstelle ein strukturiertes Content-Brief auf ${lang} in Markdown mit: Suchintention, primärem + sekundären Keywords, empfohlener H2/H3-Gliederung, abzudeckenden Entities, internen/externen Link-Ideen, 5 FAQ-Fragen, empfohlener Wortzahl, sowie Vorschlag für Meta-Title (≤60 Zeichen) und Meta-Description (≤155 Zeichen). ${CH_RULE}`,
        user: `Thema/Keyword: ${d.topic ?? ""}
Zielgruppe: ${d.audience ?? "nicht angegeben"}`,
        maxTokens: 3000,
      };
    case "outline":
      return {
        system: `Du bist SEO-Content-Stratege. Erstelle eine detaillierte Artikel-Gliederung auf ${lang} in Markdown: H1-Vorschlag, H2/H3-Struktur mit je 2-4 Stichpunkten zum Inhalt, plus eine FAQ-Sektion mit 4-6 Fragen. ${CH_RULE}`,
        user: `Thema: ${d.topic ?? ""}
Keywords:
${d.keywords ?? ""}`,
        maxTokens: 2500,
      };
    case "meta":
      return {
        system: `Du bist SEO-Texter. Liefere auf ${lang} jeweils 3 Varianten: SEO-Title (≤60 Zeichen) und Meta-Description (≤155 Zeichen), plus 1 Open-Graph-Title und -Description. Gib das als Markdown-Tabelle mit Zeichenzahl pro Eintrag aus. ${CH_RULE}`,
        user: `Thema/Seite: ${d.topic ?? d.title ?? ""}
Haupt-Keyword: ${d.keyword ?? ""}`,
        maxTokens: 1200,
      };
    case "schema":
      return {
        system: `Du generierst valides Schema.org JSON-LD. Gib AUSSCHLIESSLICH ein einziges \`\`\`json Codeblock mit korrektem JSON-LD (inkl. @context und @type) aus — keine Erklärung. Wähle sinnvolle Felder anhand der Angaben.`,
        user: `Schema-Typ: ${d.schemaType ?? "Article"}
Angaben:
${d.content ?? ""}`,
        maxTokens: 1500,
      };
    case "summary":
    default:
      return {
        system: `Du fasst Texte präzise und prägnant auf ${lang} zusammen, klar strukturiert. ${CH_RULE}`,
        user: d.text ?? d.content ?? "",
        maxTokens: 1500,
      };
  }
}

const AUDIT_TYPE: Record<string, string> = {
  blog: "content_blog",
  obsidian: "content_note",
  "content-brief": "content_brief",
  outline: "content_outline",
  meta: "content_meta",
  schema: "content_schema",
  summary: "content_summary",
};

// Welche Ergebnisse sollen zusätzlich als content_item gespeichert werden?
const SAVE_AS_CONTENT = new Set(["blog", "obsidian", "content-brief", "outline", "schema"]);

export const Route = createFileRoute("/api/ai/generate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        const secrets = [apiKey];
        if (!apiKey) {
          return Response.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 503 });
        }

        const supabaseUrl = process.env.SUPABASE_URL;
        const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
        if (!supabaseUrl || !anonKey) {
          return Response.json({ error: "Server not configured" }, { status: 503 });
        }

        const authHeader = request.headers.get("authorization") ?? "";
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        const {
          data: { user },
        } = await userClient.auth.getUser();
        if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

        let raw: unknown = {};
        try {
          raw = await request.json();
        } catch {
          /* empty */
        }
        const parsed = Body.safeParse(raw);
        if (!parsed.success) {
          return Response.json(
            { error: "Invalid input", issues: parsed.error.issues },
            { status: 400 },
          );
        }
        const d = parsed.data;

        const { data: client, error: clientErr } = await userClient
          .from("clients")
          .select("id, organization_id")
          .eq("id", d.clientId)
          .maybeSingle();
        if (clientErr || !client) {
          return Response.json({ error: "Client not found or access denied" }, { status: 404 });
        }
        if (!(await canRunAudits(user.id, client.organization_id))) {
          return Response.json(
            { error: "Keine Berechtigung für Audit-Läufe (viewer/read-only)." },
            { status: 403 },
          );
        }
        if (!(await isProviderEnabled(client.id, "anthropic"))) {
          return Response.json(
            { error: "Claude/Anthropic für diesen Kunden deaktiviert." },
            { status: 403 },
          );
        }

        const { system, user: userPrompt, maxTokens } = buildPrompt(d);

        let text = "";
        // 1) Bevorzugt über den agent-service (Claude-Subscription) — verbraucht
        //    KEIN API-Guthaben. Nicht erreichbar/leer -> Direktweg unten.
        const viaSub = await generateViaSubscription({
          system,
          prompt: userPrompt,
          model: ANTHROPIC_MODEL,
          clientId: client.id,
          label: `Content: ${d.kind}`,
        });
        if (viaSub?.text) text = viaSub.text.trim();

        if (!text) {
          // 2) Fallback: Direktaufruf über das API-Guthaben — der Verbrauch wird
          //    jetzt in api_cost_daily geloggt (war vorher unsichtbar).
          try {
            const res = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: ANTHROPIC_MODEL,
                max_tokens: maxTokens,
                system,
                messages: [{ role: "user", content: userPrompt }],
              }),
            });
            if (!res.ok) {
              const t = await res.text().catch(() => "");
              return Response.json(
                { ok: false, error: redact(`Anthropic HTTP ${res.status}: ${t}`, secrets) },
                { status: 502 },
              );
            }
            const json = (await res.json()) as {
              content?: Array<{ type: string; text?: string }>;
              usage?: { input_tokens?: number; output_tokens?: number };
            };
            text = (json.content ?? [])
              .filter((b) => b.type === "text")
              .map((b) => b.text ?? "")
              .join("\n")
              .trim();
            const u = json.usage || {};
            await recordApiCost({
              provider: "Claude",
              tokensIn: Number(u.input_tokens || 0),
              tokensOut: Number(u.output_tokens || 0),
            });
          } catch (e) {
            return Response.json({ ok: false, error: redact(e, secrets) }, { status: 500 });
          }
        }

        await supabaseAdmin.from("audit_runs").insert({
          client_id: client.id,
          organization_id: client.organization_id,
          triggered_by: user.id,
          audit_type: AUDIT_TYPE[d.kind] ?? "content_other",
          status: text ? "succeeded" : "failed",
          input: { kind: d.kind, topic: d.topic, title: d.title, schemaType: d.schemaType },
          result: { content: text } as never,
          error: text ? null : "Leere Antwort von Claude",
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
        });

        // Best-effort als content_item ablegen (RLS: content_insert = org-admin → bei member non-fatal).
        if (text && SAVE_AS_CONTENT.has(d.kind)) {
          const title =
            d.kind === "blog"
              ? (d.topic ?? "Blog Post")
              : d.kind === "obsidian"
                ? (d.title ?? "Obsidian Note")
                : d.kind === "content-brief"
                  ? `Brief: ${d.topic ?? ""}`
                  : d.kind === "outline"
                    ? `Outline: ${d.topic ?? ""}`
                    : d.kind === "schema"
                      ? `Schema: ${d.schemaType ?? "Article"}`
                      : (d.topic ?? "Content");
          try {
            await userClient.from("content_items").insert({
              client_id: client.id,
              created_by: user.id,
              title,
              body: text,
              content_type: d.kind === "blog" ? "blog" : "note",
              status: "draft",
              keywords: [],
            });
          } catch {
            /* non-fatal */
          }
        }

        return Response.json(
          { ok: true, kind: d.kind, content: text },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
