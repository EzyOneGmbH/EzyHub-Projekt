import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checkAutonomy, type ScoreRow } from "@/server/google-ads-outcome.server";
import { bidWritesEnabled } from "@/server/google-ads-autopilot.server";

// Phase 4: agent scorecard per client (90d window) + hard release criteria
// (limits.md 4.3). The agent reads this for the monthly "Autopilot-Bilanz" and
// may only RECOMMEND autonomy increases; the config change stays human.
// ADMIN_AUTOMATION_SECRET. ?clientId=<uuid> required.

export const Route = createFileRoute("/api/admin/ads-scorecard")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret)
          return Response.json({ ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" }, { status: 503 });
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        const url = new URL(request.url);
        const clientId = url.searchParams.get("clientId");
        if (!clientId) return Response.json({ ok: false, error: "clientId erforderlich" }, { status: 400 });

        // Aggregation in TS (identisch zur SQL-View ads_agent_scorecard, 90d)
        const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
        const { data: rows, error } = await supabaseAdmin
          .from("ads_outcome_reviews")
          .select("action_type, verdict, avoided_waste_chf")
          .eq("client_id", clientId)
          .gte("reviewed_at", since);
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        const agg = new Map<string, ScoreRow>();
        for (const r of rows ?? []) {
          const a = agg.get(r.action_type) ?? {
            action_type: r.action_type, n_total: 0, n_positive: 0, n_neutral: 0,
            n_negative: 0, n_inconclusive: 0, hit_rate: null, avoided_waste_chf_sum: 0,
          };
          a.n_total += 1;
          if (r.verdict === "positive") a.n_positive += 1;
          else if (r.verdict === "neutral") a.n_neutral += 1;
          else if (r.verdict === "negative") a.n_negative += 1;
          else a.n_inconclusive += 1;
          a.avoided_waste_chf_sum += Number(r.avoided_waste_chf ?? 0);
          agg.set(r.action_type, a);
        }
        const scorecard = [...agg.values()].map((a) => {
          const decided = a.n_total - a.n_inconclusive;
          return { ...a, hit_rate: decided > 0 ? Math.round(((a.n_positive + a.n_neutral) / decided) * 10000) / 10000 : null };
        });

        const { data: cfg } = await supabaseAdmin
          .from("ads_autopilot_config")
          .select("autonomy_level, observe_only")
          .eq("client_id", clientId)
          .maybeSingle();

        const autonomy = checkAutonomy(scorecard, bidWritesEnabled());
        return Response.json({
          ok: true,
          clientId,
          windowDays: 90,
          currentAutonomyLevel: cfg?.autonomy_level ?? 0,
          observeOnly: cfg?.observe_only ?? true,
          scorecard,
          release: autonomy,
        });
      },
    },
  },
});
