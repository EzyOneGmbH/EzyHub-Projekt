import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { canRunAudits } from "@/server/integrations.server";
import { decideApproval } from "@/server/google-ads-autopilot.server";

// User-authed Approve/Reject for the EzyHub UI. Same execution logic as the
// admin route (n8n), but authorized via the logged-in user + org RBAC instead
// of ADMIN_AUTOMATION_SECRET.

const Body = z.object({
  clientId: z.string().uuid(),
  approvalId: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
});

async function authedUser(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!;
  const sb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
  });
  const { data } = await sb.auth.getUser();
  return data.user;
}

export const Route = createFileRoute("/api/google/ads-autopilot-decide")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await authedUser(request);
        if (!user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });

        const { data: client } = await supabaseAdmin
          .from("clients")
          .select("id, organization_id")
          .eq("id", parsed.data.clientId)
          .maybeSingle();
        if (!client)
          return Response.json({ ok: false, error: "Client not found" }, { status: 404 });
        const { data: m } = await supabaseAdmin
          .from("app_users")
          .select("role")
          .eq("user_id", user.id)
          .eq("organization_id", client.organization_id)
          .maybeSingle();
        if (!m) return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
        if (!(await canRunAudits(user.id, client.organization_id)))
          return Response.json(
            { ok: false, error: "Keine Berechtigung (viewer/read-only)." },
            { status: 403 },
          );

        const r = await decideApproval({
          approvalId: parsed.data.approvalId,
          decision: parsed.data.decision,
          decidedBy: user.id,
          clientId: parsed.data.clientId,
        });
        return Response.json(
          { ok: r.ok, decision: parsed.data.decision, status: r.status, error: r.error },
          { status: r.httpStatus },
        );
      },
    },
  },
});
