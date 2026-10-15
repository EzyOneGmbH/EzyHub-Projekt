import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { redactSecrets } from "@/server/google-oauth.server";
import { requireTeamRole } from "@/server/team-guard.server";

// Kundenkontext (15.10.2026, Volkan Punkt 8) — NUR Team-Ansicht. Gespeichert
// im agent-service (kundenkontext/<clientId>.json, Kunden-Logins haben keinen
// Zugriff); die Agenten bekommen ihn als Block «KUNDENKONTEXT» in jeden Lauf.

const Kontext = z.object({
  goals: z.string().max(4000).optional(),
  audience: z.string().max(4000).optional(),
  competitors: z.string().max(4000).optional(),
  tone: z.string().max(4000).optional(),
  notes: z.string().max(4000).optional(),
});
const Post = z.object({ clientId: z.string().uuid(), context: Kontext });

async function pruefen(request: Request, clientId: string) {
  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: request.headers.get("authorization") ?? "" } } },
  );
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user)
    return { fehler: Response.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  const team = await requireTeamRole(request, "member");
  if (team instanceof Response) return { fehler: team };
  const { data: sichtbar } = await sb.from("clients").select("id").eq("id", clientId);
  if (!sichtbar?.length)
    return { fehler: Response.json({ ok: false, error: "Forbidden" }, { status: 403 }) };
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, name")
    .eq("id", clientId)
    .maybeSingle();
  const base = process.env.AGENT_BASE_URL?.replace(/\/+$/, "");
  const secret = process.env.AGENT_SHARED_SECRET;
  if (!base || !secret)
    return { fehler: Response.json({ ok: false, error: "agent-service nicht konfiguriert" }) };
  return { user, client, base, secret };
}

export const Route = createFileRoute("/api/admin/client-kontext")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const clientId = new URL(request.url).searchParams.get("clientId") || "";
          if (!z.string().uuid().safeParse(clientId).success)
            return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });
          const p = await pruefen(request, clientId);
          if ("fehler" in p) return p.fehler;
          const r = await fetch(
            `${p.base}/kundenkontext?clientId=${encodeURIComponent(clientId)}`,
            {
              headers: { Authorization: `Bearer ${p.secret}` },
              signal: AbortSignal.timeout(20_000),
            },
          );
          const j: any = await r.json().catch(() => ({}));
          if (!r.ok || !j?.ok)
            return Response.json({ ok: false, error: `agent-service HTTP ${r.status}` });
          const c = j.context || null;
          return Response.json({
            ok: true,
            context: c
              ? {
                  goals: c.goals || "",
                  audience: c.audience || "",
                  competitors: c.competitors || "",
                  tone: c.tone || "",
                  notes: c.notes || "",
                  updatedAt: c.updatedAt || null,
                  updatedBy: c.updatedBy || null,
                }
              : null,
          });
        } catch (e) {
          return Response.json({ ok: false, error: redactSecrets(e) });
        }
      },
      POST: async ({ request }) => {
        try {
          const parsed = Post.safeParse(await request.json().catch(() => ({})));
          if (!parsed.success)
            return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });
          const p = await pruefen(request, parsed.data.clientId);
          if ("fehler" in p) return p.fehler;
          const r = await fetch(`${p.base}/kundenkontext`, {
            method: "POST",
            headers: { Authorization: `Bearer ${p.secret}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              clientId: parsed.data.clientId,
              clientName: p.client?.name || "",
              context: parsed.data.context,
              by: p.user.email || p.user.id,
            }),
            signal: AbortSignal.timeout(20_000),
          });
          const j: any = await r.json().catch(() => ({}));
          if (!r.ok || !j?.ok)
            return Response.json({ ok: false, error: `agent-service HTTP ${r.status}` });
          return Response.json({
            ok: true,
            updatedAt: j.context?.updatedAt || null,
            updatedBy: j.context?.updatedBy || null,
          });
        } catch (e) {
          return Response.json({ ok: false, error: redactSecrets(e) });
        }
      },
    },
  },
});
