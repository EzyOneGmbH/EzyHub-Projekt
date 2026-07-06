import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadConfig } from "@/server/google-ads-autopilot.server";
import { addNegativeKeyword, setCampaignBudget } from "@/server/google-ads-mutate.server";

// Approve (and execute) or reject a queued Autopilot action. Called by n8n when
// a human clicks Approve/Reject. Server-to-server, ADMIN_AUTOMATION_SECRET.
// Identify the action by approvalId OR (runId + actionId).

const Body = z
  .object({
    approvalId: z.string().uuid().optional(),
    runId: z.string().optional(),
    actionId: z.string().optional(),
    decision: z.enum(["approve", "reject"]).default("approve"),
    decidedBy: z.string().optional(),
  })
  .refine((b) => b.approvalId || (b.runId && b.actionId), {
    message: "approvalId oder runId+actionId noetig",
  });

export const Route = createFileRoute("/api/admin/ads-autopilot-execute")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret)
          return Response.json({ ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" }, { status: 503 });
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });
        const { approvalId, runId, actionId, decision, decidedBy } = parsed.data;

        // Load the approval.
        let q = supabaseAdmin.from("ads_approvals").select("*");
        q = approvalId ? q.eq("id", approvalId) : q.eq("run_id", runId!).eq("action_id", actionId!);
        const { data: appr, error: loadErr } = await q.maybeSingle();
        if (loadErr) return Response.json({ ok: false, error: loadErr.message }, { status: 500 });
        if (!appr) return Response.json({ ok: false, error: "Approval nicht gefunden" }, { status: 404 });
        if (appr.status !== "pending")
          return Response.json({ ok: false, error: `Approval bereits '${appr.status}'` }, { status: 409 });
        if (appr.expires_at && new Date(appr.expires_at).getTime() < Date.now()) {
          await supabaseAdmin.from("ads_approvals").update({ status: "expired" }).eq("id", appr.id);
          return Response.json({ ok: false, error: "Approval abgelaufen" }, { status: 410 });
        }

        const decidedAt = new Date().toISOString();

        if (decision === "reject") {
          await supabaseAdmin
            .from("ads_approvals")
            .update({ status: "rejected", decided_by: decidedBy ?? null, decided_at: decidedAt })
            .eq("id", appr.id);
          if (appr.changelog_id)
            await supabaseAdmin.from("ads_changelog").update({ status: "rejected", approved_by: decidedBy ?? null }).eq("id", appr.changelog_id);
          return Response.json({ ok: true, decision: "reject", approvalId: appr.id });
        }

        // Approve -> execute the mutation from the stored payload.
        const { data: client } = await supabaseAdmin
          .from("clients")
          .select("id, google_ads_customer")
          .eq("id", appr.client_id)
          .maybeSingle();
        if (!client) return Response.json({ ok: false, error: "Client not found" }, { status: 404 });
        const cfg = await loadConfig(appr.client_id);
        const payload = (appr.payload && typeof appr.payload === "object" ? appr.payload : {}) as Record<string, any>;

        let result: { ok: boolean; error?: string; skipped?: string };
        if (payload.kind === "budget") {
          result = await setCampaignBudget({
            clientId: appr.client_id, googleAdsCustomer: client.google_ads_customer,
            campaignName: payload.campaign, dailyChf: Number(payload.dailyChf),
            dryRun: false, noTouch: cfg.no_touch_campaigns,
          });
        } else if (payload.kind === "negative") {
          result = await addNegativeKeyword({
            clientId: appr.client_id, googleAdsCustomer: client.google_ads_customer,
            campaignName: payload.campaign, term: payload.term,
            dryRun: false, noTouch: cfg.no_touch_campaigns,
          });
        } else {
          return Response.json({ ok: false, error: `Kein ausfuehrbarer payload (kind=${payload.kind ?? "?"})` }, { status: 422 });
        }

        const status = result.ok ? "executed" : "failed";
        await supabaseAdmin
          .from("ads_approvals")
          .update({ status, decided_by: decidedBy ?? null, decided_at: decidedAt })
          .eq("id", appr.id);
        if (appr.changelog_id)
          await supabaseAdmin
            .from("ads_changelog")
            .update({ status, approved_by: decidedBy ?? null })
            .eq("id", appr.changelog_id);

        return Response.json({ ok: result.ok, decision: "approve", status, error: result.error, skipped: result.skipped });
      },
    },
  },
});
