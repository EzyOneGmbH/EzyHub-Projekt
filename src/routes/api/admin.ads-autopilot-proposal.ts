import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Phase 2.3: Registers a campaign proposal in the approval queue. Called by the
// agent-service after /ads-autopilot propose has written the full proposal
// document to the vault (proposals/<kunde>/<datum>-<slug>.md). Approving a
// proposal only marks it (decideApproval) — implementation is always manual
// (permanent non-goal: no autonomous campaign creation). ADMIN_AUTOMATION_SECRET.

const Body = z.object({
  clientId: z.string().uuid(),
  title: z.string().min(3).max(200), // z.B. "Non-Brand Destination DE/FR"
  docPath: z.string().min(3).max(400), // Vault-Pfad des Proposal-Dokuments
  summary: z.string().max(2000).optional(), // Kurzfassung fuer die Queue/Zustellung
  estimatedImpact: z.string().max(500).optional(),
  expiresDays: z.number().int().min(1).max(90).default(30),
});

export const Route = createFileRoute("/api/admin/ads-autopilot-proposal")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret)
          return Response.json(
            { ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" },
            { status: 503 },
          );
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });
        const { clientId, title, docPath, summary, estimatedImpact, expiresDays } = parsed.data;

        const { data: client } = await supabaseAdmin
          .from("clients")
          .select("id, name, google_ads_customer")
          .eq("id", clientId)
          .maybeSingle();
        if (!client)
          return Response.json({ ok: false, error: "Client not found" }, { status: 404 });

        // Dedup: gleicher Titel bereits offen -> nicht doppelt einreichen.
        const { data: existing } = await supabaseAdmin
          .from("ads_approvals")
          .select("id")
          .eq("client_id", clientId)
          .eq("type", "campaign_proposal")
          .eq("entity", title)
          .eq("status", "pending")
          .maybeSingle();
        if (existing) return Response.json({ ok: true, deduped: true, approvalId: existing.id });

        const now = new Date();
        const customerId = String(client.google_ads_customer ?? "").replace(/\D/g, "");
        const runId = `${now.toISOString().slice(0, 10)}-proposal-${now.getTime().toString().slice(-4)}`;

        const { data: logRow } = await supabaseAdmin
          .from("ads_changelog")
          .insert({
            client_id: clientId,
            customer_id: customerId || "-",
            run_id: runId,
            action_type: "campaign_proposal",
            action_class: "approval-needed",
            entity: title,
            before_value: "",
            after_value: docPath,
            rationale: summary ?? `Kampagnen-Proposal: ${title}`,
            status: "pending",
          })
          .select("id")
          .maybeSingle();

        const { data: appr, error } = await supabaseAdmin
          .from("ads_approvals")
          .insert({
            client_id: clientId,
            customer_id: customerId || "-",
            run_id: runId,
            action_id: "p-001",
            type: "campaign_proposal",
            entity: title,
            current_value: "",
            proposed_value: docPath,
            rationale: summary ?? null,
            estimated_impact: estimatedImpact ?? null,
            payload: { kind: "proposal", doc: docPath },
            status: "pending",
            expires_at: new Date(now.getTime() + expiresDays * 24 * 3600 * 1000).toISOString(),
            changelog_id: logRow?.id ?? null,
          })
          .select("id")
          .maybeSingle();
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        return Response.json({ ok: true, approvalId: appr?.id, runId });
      },
    },
  },
});
