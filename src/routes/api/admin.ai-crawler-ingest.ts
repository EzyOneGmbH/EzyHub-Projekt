import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// AI-Crawler-Analytics light (Searchable-Nachbau ⑤, 2026-08-03).
// Nimmt Bot-Hits von Kunden-Websites entgegen (WordPress-Snippet o. ä.) und
// schreibt sie in ai_crawler_hits. Auth: Bearer ADMIN_AUTOMATION_SECRET.
// Body: { domain: "kunde.ch", hits: [{ bot, url, status?, at? }] }  (max 500/Call)
// Kunde wird über clients.domain aufgelöst — unbekannte Domains werden
// verworfen (kein Datenmüll von fremden Sendern).

const KNOWN_BOTS = new Set([
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "GoogleOther",
  "Bytespider",
  "Amazonbot",
  "Applebot-Extended",
  "cohere-ai",
  "meta-externalagent",
]);

export const Route = createFileRoute("/api/admin/ai-crawler-ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Dediziertes Ingest-Secret (CRAWLER_INGEST_SECRET): liegt auf den
        // Kunden-Websites im Snippet — darum bewusst NICHT das Admin-Secret.
        // Kann nur Bot-Hits für bekannte Kunden-Domains einliefern, sonst nichts.
        const auth = request.headers.get("authorization") || "";
        const ingest = process.env.CRAWLER_INGEST_SECRET;
        const admin = process.env.ADMIN_AUTOMATION_SECRET;
        const okAuth =
          (ingest && auth === `Bearer ${ingest}`) || (admin && auth === `Bearer ${admin}`);
        if (!okAuth) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        let body: any;
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, error: "Body ungültig" }, { status: 400 });
        }
        const domain = String(body?.domain || "")
          .toLowerCase()
          .replace(/^https?:\/\//, "")
          .replace(/^www\./, "")
          .replace(/\/.*$/, "");
        const hits = Array.isArray(body?.hits) ? body.hits.slice(0, 500) : [];
        if (!domain || !hits.length)
          return Response.json(
            { ok: false, error: "domain und hits erforderlich" },
            { status: 400 },
          );

        const sb = supabaseAdmin as any;
        const { data: clients } = await sb.from("clients").select("id, organization_id, domain");
        const client = (clients || []).find((c: any) => {
          const d = String(c.domain || "")
            .toLowerCase()
            .replace(/^https?:\/\//, "")
            .replace(/^www\./, "")
            .replace(/\/.*$/, "");
          return d && (d === domain || domain.endsWith("." + d) || d.endsWith("." + domain));
        });
        if (!client)
          return Response.json(
            { ok: false, error: `Unbekannte Domain: ${domain}` },
            { status: 404 },
          );

        const rows = hits
          .map((h: any) => ({
            organization_id: client.organization_id,
            client_id: client.id,
            bot: String(h?.bot || "").slice(0, 60),
            url: String(h?.url || "").slice(0, 500),
            status: h?.status != null ? Number(h.status) : null,
            at: h?.at ? new Date(h.at).toISOString() : new Date().toISOString(),
          }))
          .filter((r: any) => r.bot && r.url && KNOWN_BOTS.has(r.bot));
        if (!rows.length)
          return Response.json({ ok: true, inserted: 0, note: "keine bekannten Bots im Batch" });

        const { error } = await sb.from("ai_crawler_hits").insert(rows);
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        return Response.json({ ok: true, inserted: rows.length });
      },
    },
  },
});
