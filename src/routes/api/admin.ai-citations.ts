import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// AI-Zitations-Ingest (Ausbau 2026-07-15, Modul 2): der agent-service misst
// woechentlich via DataForSEO LLM-Mentions, ob die Kundendomain in KI-Antworten
// (Stadt-/Kategorie-Queries) zitiert wird, und pusht das Ergebnis hierher. Diese
// Route schreibt eine audit_runs-Zeile type 'ai_citations' (Upsert je client+date).
// Rein Beobachtung/Signal. Secret-gated wie rank-snapshot.

const Query = z.object({
  query: z.string(),
  corpusId: z.string().optional(), // Dual-Korpus 2026-07-16; fehlt = int-en (alt)
  isPrimary: z.boolean().optional(),
  totalMentions: z.number().optional(),
  clientCited: z.boolean().optional(),
  clientRank: z.number().nullable().optional(),
  clientMentions: z.number().optional(),
  clientShare: z.number().optional(),
  noData: z.boolean().optional(),
  error: z.string().optional(),
  topCitedDomains: z.array(z.object({ domain: z.string(), mentions: z.number() })).optional(),
});

const Body = z.object({
  client: z.string().min(1), // slug
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().optional(), // kundenspezifischer UI-Hinweis (z.B. Campagnola/Tessin)
  queries: z.array(Query).default([]),
  aggregate: z.object({
    queriesTracked: z.number().int(),
    queriesCited: z.number().int(),
    avgClientShare: z.number(),
    citedDelta7: z.string().nullable().optional(),
  }),
});

function slugifyName(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const Route = createFileRoute("/api/admin/ai-citations")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret)
          return Response.json({ ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" }, { status: 503 });
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Invalid input", details: parsed.error.issues }, { status: 400 });
        const d = parsed.data;

        const { data: clients } = await supabaseAdmin
          .from("clients")
          .select("id, name, domain, organization_id");
        const target = (clients || []).find(
          (c: any) =>
            slugifyName(c.name) === d.client ||
            slugifyName(String(c.domain || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split(".")[0]) === d.client,
        );
        if (!target)
          return Response.json({ ok: false, error: `Kunde '${d.client}' nicht gefunden` }, { status: 404 });

        const { data: users } = await supabaseAdmin
          .from("app_users")
          .select("user_id, role")
          .eq("organization_id", target.organization_id)
          .limit(20);
        const owner =
          (users || []).find((u: any) => ["owner", "admin"].includes(u.role)) || (users || [])[0];
        if (!owner)
          return Response.json({ ok: false, error: "Kein Org-User fuer triggered_by" }, { status: 500 });

        const result: Record<string, unknown> = {
          client: d.client,
          date: d.date,
          queries: d.queries,
          aggregate: d.aggregate,
          ...(d.note ? { note: d.note } : {}),
        };

        // Upsert je client+date: bestehende ai_citations-Zeile desselben Tages updaten.
        const { data: existing } = await supabaseAdmin
          .from("audit_runs")
          .select("id")
          .eq("client_id", target.id)
          .eq("audit_type", "ai_citations")
          .eq("input->>date", d.date)
          .limit(1)
          .maybeSingle();

        const now = new Date().toISOString();
        if (existing?.id) {
          const { error } = await supabaseAdmin
            .from("audit_runs")
            .update({ result, status: "succeeded", finished_at: now } as never)
            .eq("id", existing.id);
          if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
          return Response.json({ ok: true, id: existing.id, upserted: true });
        }
        const { data: created, error } = await supabaseAdmin
          .from("audit_runs")
          .insert({
            client_id: target.id,
            organization_id: target.organization_id,
            triggered_by: (owner as any).user_id,
            audit_type: "ai_citations",
            status: "succeeded",
            input: { date: d.date, client: d.client },
            result,
            started_at: now,
            finished_at: now,
          } as never)
          .select("id")
          .single();
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        return Response.json({ ok: true, id: created?.id, upserted: false });
      },
    },
  },
});
