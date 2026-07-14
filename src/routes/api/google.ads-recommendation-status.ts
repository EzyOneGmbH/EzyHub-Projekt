import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { canRunAudits } from "@/server/integrations.server";
import { setRecommendationStatus } from "@/server/google-ads-recommendations.server";

// Phase C: Statuspflege aus der EzyHub-Mini-View (user-authed, RBAC wie die
// Approve/Reject-Route). Schreibt nur Status-Felder, nie ins Ads-Konto.

const Body = z.object({
  clientId: z.string().uuid(),
  id: z.string().uuid(),
  status: z.enum(["implemented", "dismissed"]),
  note: z.string().max(600).optional(),
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

export const Route = createFileRoute("/api/google/ads-recommendation-status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await authedUser(request);
        if (!user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });

        const { data: client } = await supabaseAdmin
          .from("clients")
          .select("id, organization_id")
          .eq("id", parsed.data.clientId)
          .maybeSingle();
        if (!client) return Response.json({ ok: false, error: "Client not found" }, { status: 404 });
        const { data: m } = await supabaseAdmin
          .from("app_users")
          .select("role")
          .eq("user_id", user.id)
          .eq("organization_id", client.organization_id)
          .maybeSingle();
        if (!m) return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
        if (!(await canRunAudits(user.id, client.organization_id)))
          return Response.json({ ok: false, error: "Keine Berechtigung (viewer/read-only)." }, { status: 403 });

        // Empfehlung muss zum Client gehoeren (Guard gegen fremde IDs).
        const { data: rec } = await supabaseAdmin
          .from("ads_recommendations")
          .select("id, client_id")
          .eq("id", parsed.data.id)
          .maybeSingle();
        if (!rec || rec.client_id !== parsed.data.clientId)
          return Response.json({ ok: false, error: "Empfehlung gehoert nicht zu diesem Kunden" }, { status: 403 });

        const r = await setRecommendationStatus({
          id: parsed.data.id,
          status: parsed.data.status,
          by: user.email ?? user.id,
          note: parsed.data.note ?? null,
        });
        return Response.json(r, { status: r.httpStatus });
      },
    },
  },
});
