import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getWpConnection, wpFetch } from "@/server/wordpress.server";

// List WordPress posts or pages for a client (read). Used by the Content tab to
// show what already exists on the client's site.

async function getUserOrg(request: Request, clientId: string) {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!;
  const sb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
  });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 as const };
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("organization_id")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return { error: "Client not found", status: 404 as const };
  const { data: m } = await supabaseAdmin
    .from("app_users")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", client.organization_id)
    .maybeSingle();
  if (!m) return { error: "Forbidden", status: 403 as const };
  return { user };
}

const stripHtml = (s: string) => String(s || "").replace(/<[^>]*>/g, "").replace(/&[a-z]+;/gi, " ").trim();

export const Route = createFileRoute("/api/wordpress/posts")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const clientId = url.searchParams.get("clientId") || "";
        const type = url.searchParams.get("type") === "pages" ? "pages" : "posts";
        const search = url.searchParams.get("search") || "";
        if (!clientId) return Response.json({ ok: false, error: "clientId required" }, { status: 400 });

        const auth = await getUserOrg(request, clientId);
        if ("error" in auth) return Response.json({ ok: false, error: auth.error }, { status: auth.status });

        const conn = await getWpConnection(clientId);
        if (!conn) return Response.json({ ok: false, error: "Keine WordPress-Verbindung" });

        const query: Record<string, string | number> = { per_page: 30, context: "edit", orderby: "modified", order: "desc" };
        if (search) query.search = search;
        const r = await wpFetch<any[]>(conn, `/wp/v2/${type}`, { query });
        if (!r.ok) return Response.json({ ok: false, error: r.error });

        const items = (r.data || []).map((p: any) => ({
          id: p.id,
          title: stripHtml(p.title?.rendered ?? p.title?.raw ?? ""),
          status: p.status,
          link: p.link,
          modified: p.modified,
          excerpt: stripHtml(p.excerpt?.rendered ?? "").slice(0, 160),
          type,
        }));
        return Response.json({ ok: true, items, count: items.length });
      },
    },
  },
});
