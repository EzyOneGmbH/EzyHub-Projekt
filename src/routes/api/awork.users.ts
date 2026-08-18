import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// AWORK users list — for assignee selection dropdown

const AWORK_BASE = "https://api.awork.com/api/v1";

async function aworkFetch<T = any>(
  path: string,
  key: string,
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  const res = await fetch(`${AWORK_BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, status: res.status, data: null, error: text.slice(0, 300) };
  }
  const data = await res.json().catch(() => null);
  return { ok: true, status: res.status, data: data as T };
}

export const Route = createFileRoute("/api/awork/users")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const supabaseUrl = process.env.SUPABASE_URL!;
          const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!;
          const sb = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
          });
          const {
            data: { user },
          } = await sb.auth.getUser();
          if (!user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

          const key = process.env.AWORK_API_KEY;
          if (!key) return Response.json({ ok: false, error: "AWORK_API_KEY nicht konfiguriert" });

          // Get all users from AWORK
          const usersRes = await aworkFetch<any[]>("/users?pageSize=500", key);
          if (!usersRes.ok) {
            return Response.json({
              ok: false,
              error: `Users laden fehlgeschlagen: ${usersRes.error}`,
            });
          }

          const users = (usersRes.data || [])
            .filter((u: any) => !u.isDeactivated)
            .map((u: any) => ({
              id: u.id,
              firstName: u.firstName || "",
              lastName: u.lastName || "",
              name: `${u.firstName || ""} ${u.lastName || ""}`.trim(),
              initials:
                `${(u.firstName || "")[0] || ""}${(u.lastName || "")[0] || ""}`.toUpperCase(),
              email: u.email || "",
              position: u.position || "",
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

          return Response.json({ ok: true, users });
        } catch (e) {
          return Response.json(
            { ok: false, error: String((e as Error)?.message || e) },
            { status: 500 },
          );
        }
      },
    },
  },
});
