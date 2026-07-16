import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// LLM-Antworten-Ingest (Modul 3, 2026-07-16): der agent-service stellt monatlich
// EINEN plattformweiten Prompt-Satz gegen 4 LLM-Provider (Portfolio-Monitor,
// OVERALL) und pusht das Ergebnis hierher. Sentinel client "__overall__":
// audit_runs.client_id ist NOT NULL, daher haengt die Zeile technisch am
// Agentur-Kunden (Ezy One); result.client bleibt "__overall__" und die Seite
// "LLM-Ueberblick" liest rein ueber audit_type. Upsert je Datum. Secret-gated.

const Body = z.object({
  client: z.literal("__overall__"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  providers: z.array(z.string()).default([]),
  resolvedModels: z.record(z.string(), z.string().nullable()).default({}),
  providerErrors: z.record(z.string(), z.string()).optional(),
  landscape: z.any(),
  prompts: z.array(z.any()).default([]),
  clientSummary: z.array(z.any()).default([]),
});

export const Route = createFileRoute("/api/admin/llm-responses")({
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

        // Traeger-Kunde: die Agentur selbst (Ezy One) — Portfolio-Sicht.
        const { data: clients } = await supabaseAdmin
          .from("clients")
          .select("id, name, organization_id");
        const target = (clients || []).find((c: any) => /ezy[ -]?one/i.test(String(c.name))) || (clients || [])[0];
        if (!target)
          return Response.json({ ok: false, error: "kein Traeger-Kunde gefunden" }, { status: 500 });

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
          client: "__overall__",
          date: d.date,
          providers: d.providers,
          resolvedModels: d.resolvedModels,
          providerErrors: d.providerErrors || {},
          landscape: d.landscape,
          prompts: d.prompts,
          clientSummary: d.clientSummary,
        };

        const { data: existing } = await supabaseAdmin
          .from("audit_runs")
          .select("id")
          .eq("audit_type", "llm_responses")
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
            audit_type: "llm_responses",
            status: "succeeded",
            input: { date: d.date, client: "__overall__" },
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
