import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Deterministischer Lauf-Nachweis: der agent-service postet nach JEDEM Agent-Lauf
// (auch bei 0 Aenderungen) einen kompakten Eintrag in agent_runs -> sichtbar als
// "Agent-Laeufe" pro Kunde. Getrennt vom Aenderungs-Log (content-note), damit man
// auch an ruhigen Tagen sieht, dass die Agenten liefen. Secret-gated (ADMIN_AUTOMATION_SECRET).

const Body = z.object({
  clientId: z.string().uuid().optional(),
  clientName: z.string().optional(),
  agentName: z.string().min(1),
  status: z.enum(["ok", "fehler", "partial"]).optional(),
  healthScore: z.number().int().min(0).max(100).nullable().optional(),
  deployCount: z.number().int().min(0).optional(),
  summary: z.string().max(2000).optional(),
  errorMessage: z.string().max(2000).optional(),
  runAt: z.string().optional(), // ISO 8601; default = jetzt
  durationMs: z.number().int().min(0).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export const Route = createFileRoute("/api/admin/agent-run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret) return Response.json({ ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" }, { status: 503 });
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) return Response.json({ ok: false, error: "Invalid input", details: parsed.error.issues }, { status: 400 });
        const d = parsed.data;

        // Resolve client (id or name) + its organization.
        let clientId = d.clientId || null;
        let orgId: string | null = null;
        if (clientId) {
          const { data } = await supabaseAdmin.from("clients").select("id, organization_id").eq("id", clientId).maybeSingle();
          orgId = data?.organization_id || null;
          clientId = data?.id || null;
        } else if (d.clientName) {
          const { data } = await supabaseAdmin.from("clients").select("id, organization_id").ilike("name", d.clientName).limit(1).maybeSingle();
          clientId = data?.id || null;
          orgId = data?.organization_id || null;
        }
        if (!clientId || !orgId) return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });

        const runAt = d.runAt && !Number.isNaN(Date.parse(d.runAt)) ? new Date(d.runAt).toISOString() : new Date().toISOString();

        const { data: created, error } = await supabaseAdmin
          .from("agent_runs")
          .insert({
            organization_id: orgId,
            client_id: clientId,
            agent_name: d.agentName,
            status: d.status || "ok",
            health_score: d.healthScore ?? null,
            deploy_count: d.deployCount ?? 0,
            summary: d.summary ?? null,
            error_message: d.errorMessage ?? null,
            run_at: runAt,
            duration_ms: d.durationMs ?? null,
            metadata: (d.metadata ?? {}) as any,
          })
          .select("id, created_at")
          .single();

        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        return Response.json({ ok: true, id: created?.id, createdAt: created?.created_at });
      },
    },
  },
});
