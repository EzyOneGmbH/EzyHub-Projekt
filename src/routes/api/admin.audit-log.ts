import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Admin-Aenderungsprotokoll lesen (17.08.2026): admin_audit_log wird von
// DB-Triggern gefuellt (siehe Migration 20260817120000) — diese Route ist der
// EINZIGE Lesezugriff (RLS deny-all). Auth: nur owner/admin; organization_id
// wird erzwungen, optional client-Filter. Es stehen nur Whitelist-Felder im
// Log (nie Secrets), zusaetzlich reichern wir Nutzer-E-Mails zur Anzeige an.
//
// GET ?client=<uuid>&limit=50   → { entries: [...] }

async function requireOwnerAdmin(request: Request): Promise<{ organizationId: string } | Response> {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return Response.json({ ok: false, error: "Server not configured" }, { status: 503 });
  const sb = createClient(url, anon, { global: { headers: { Authorization: request.headers.get("authorization") ?? "" } } });
  const { data } = await sb.auth.getUser();
  if (!data.user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { data: m } = await (supabaseAdmin as any)
    .from("app_users").select("role, organization_id")
    .eq("user_id", data.user.id).order("role", { ascending: true }).limit(1).maybeSingle();
  const role = (m?.role as string) || "viewer";
  if ((role !== "owner" && role !== "admin") || !m?.organization_id)
    return Response.json({ ok: false, error: "Nur Owner/Admin" }, { status: 403 });
  return { organizationId: m.organization_id as string };
}

const LABELS: Record<string, string> = {
  app_access: "App-Zugriff (Mitarbeiter)",
  client_app_access: "App-/Feature-Zugriff (Kunde)",
  client_integrations: "Service",
  app_users: "Teamrolle",
  client_access: "Kundenzuweisung",
  ads_autopilot_config: "Autopilot-Konfiguration",
  clients: "Kunden-Konfiguration",
};

export const Route = createFileRoute("/api/admin/audit-log")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = await requireOwnerAdmin(request);
        if (u instanceof Response) return u;
        const sp = new URL(request.url).searchParams;
        const clientId = sp.get("client");
        const limit = Math.max(1, Math.min(Number(sp.get("limit")) || 50, 200));
        let q = (supabaseAdmin as any)
          .from("admin_audit_log")
          .select("id, at, user_id, target_table, target_id, client_id, action, old_value, new_value")
          .eq("organization_id", u.organizationId)
          .order("id", { ascending: false })
          .limit(limit);
        if (clientId && /^[0-9a-f-]{36}$/i.test(clientId)) q = q.eq("client_id", clientId);
        const { data, error } = await q;
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        // E-Mail-Anzeige der handelnden Nutzer (auth.users via Admin-API-View).
        const ids = [...new Set((data ?? []).map((r: any) => r.user_id).filter(Boolean))] as string[];
        const mails: Record<string, string> = {};
        for (const id of ids.slice(0, 25)) {
          try {
            const { data: au } = await (supabaseAdmin as any).auth.admin.getUserById(id);
            if (au?.user?.email) mails[id] = au.user.email;
          } catch { /* Anzeige-only */ }
        }
        return Response.json({
          ok: true,
          entries: (data ?? []).map((r: any) => ({
            ...r,
            bereich: LABELS[r.target_table] || r.target_table,
            userEmail: r.user_id ? mails[r.user_id] || null : null,
          })),
        });
      },
    },
  },
});
