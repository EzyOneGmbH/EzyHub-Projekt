// Gemeinsamer Team-Guard (Security-Hardening 18.08.2026): Organisation und
// Rolle werden SERVERSEITIG aus app_users ermittelt — nie aus dem Request.
// Genutzt von den Agent-Proxy-Routen (/api/agent/agents, /api/agent/approvals).
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const RANG: Record<string, number> = { owner: 3, admin: 2, member: 1, viewer: 0 };

/** Pure Rollenpruefung (vitest-getestet): viewer kommt NIE durch. */
export function rolleErlaubt(role: string | null | undefined, min: "member" | "admin"): boolean {
  return (RANG[String(role || "")] ?? 0) >= (min === "admin" ? 2 : 1);
}

export type TeamKontext = { userId: string; organizationId: string; role: string };

export async function requireTeamRole(
  request: Request,
  min: "member" | "admin",
): Promise<TeamKontext | Response> {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anon)
    return Response.json({ ok: false, error: "Server not configured" }, { status: 503 });
  const sb = createClient(url, anon, {
    global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
  });
  const { data } = await sb.auth.getUser();
  if (!data.user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { data: m } = await (supabaseAdmin as any)
    .from("app_users")
    .select("role, organization_id")
    .eq("user_id", data.user.id)
    .order("role", { ascending: true })
    .limit(1)
    .maybeSingle();
  const role = (m?.role as string) || "viewer";
  if (!m?.organization_id || !rolleErlaubt(role, min))
    return Response.json(
      { ok: false, error: min === "admin" ? "Nur Owner/Admin" : "Kein Team-Zugriff" },
      { status: 403 },
    );
  return { userId: data.user.id, organizationId: m.organization_id as string, role };
}
