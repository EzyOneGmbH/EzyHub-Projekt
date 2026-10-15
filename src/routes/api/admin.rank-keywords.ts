import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { redactSecrets } from "@/server/google-oauth.server";
import { requireTeamRole } from "@/server/team-guard.server";

// Gespeicherte Keywords (15.10.2026, Volkan Punkt 7) — NUR Team-Ansicht
// (owner/admin/member; Kundenportal viewer = 403). Leitet an den agent-service
// (/keyword-mark) weiter: track = ins Rank-Tracking übernehmen (Tag «saved»),
// save/unsave = Merkliste (nie rotiert), pin/unpin = Money-Keyword.

const Body = z.object({
  clientId: z.string().uuid(),
  action: z.enum(["track", "save", "unsave", "pin", "unpin"]),
  keywords: z.array(z.string().trim().min(1).max(200)).min(1).max(50),
});

export const Route = createFileRoute("/api/admin/rank-keywords")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const sb = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!,
            { global: { headers: { Authorization: request.headers.get("authorization") ?? "" } } },
          );
          const {
            data: { user },
          } = await sb.auth.getUser();
          if (!user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
          const team = await requireTeamRole(request, "member");
          if (team instanceof Response) return team;
          const parsed = Body.safeParse(await request.json().catch(() => ({})));
          if (!parsed.success)
            return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });
          const { clientId, action, keywords } = parsed.data;
          const { data: sichtbar } = await sb.from("clients").select("id").eq("id", clientId);
          if (!sichtbar?.length)
            return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
          const { data: client } = await supabaseAdmin
            .from("clients")
            .select("id, name")
            .eq("id", clientId)
            .maybeSingle();
          if (!client?.name) return Response.json({ ok: false, error: "Kunde nicht gefunden" });
          const base = process.env.AGENT_BASE_URL?.replace(/\/+$/, "");
          const secret = process.env.AGENT_SHARED_SECRET;
          if (!base || !secret)
            return Response.json({ ok: false, error: "agent-service nicht konfiguriert" });
          const r = await fetch(`${base}/keyword-mark`, {
            method: "POST",
            headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
            body: JSON.stringify({ clientName: client.name, action, keywords }),
            signal: AbortSignal.timeout(90_000),
          });
          const j: any = await r.json().catch(() => ({}));
          if (!r.ok || !j?.ok)
            return Response.json({
              ok: false,
              error: j?.error || `agent-service HTTP ${r.status}`,
            });
          return Response.json({
            ok: true,
            action,
            geaendert: j.geaendert ?? 0,
            hinzugefuegt: j.hinzugefuegt ?? 0,
          });
        } catch (e) {
          return Response.json({ ok: false, error: redactSecrets(e) });
        }
      },
    },
  },
});
