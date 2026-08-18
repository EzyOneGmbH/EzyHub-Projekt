import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getWpConnection, wpFetch } from "@/server/wordpress.server";

// Publish content to WordPress (create or update a post/page) and optionally
// write SEO meta (Yoast or RankMath). Writers only (owner/admin/member).

async function authWrite(request: Request, clientId: string) {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!;
  const sb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
  });
  const {
    data: { user },
  } = await sb.auth.getUser();
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
  if (!m || !["owner", "admin", "member"].includes((m as any).role))
    return { error: "Keine Schreibberechtigung", status: 403 as const };
  return { user };
}

const Body = z.object({
  clientId: z.string().uuid(),
  type: z.enum(["posts", "pages"]).default("posts"),
  postId: z.number().int().optional(), // update if provided, else create
  title: z.string().optional(),
  content: z.string().optional(),
  excerpt: z.string().optional(),
  status: z.enum(["draft", "publish", "pending", "private"]).default("draft"),
  slug: z.string().optional(),
  // SEO meta (applied based on the detected/active plugin)
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
});

export const Route = createFileRoute("/api/wordpress/publish")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        const parsed = Body.safeParse(body);
        if (!parsed.success)
          return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });
        const auth = await authWrite(request, parsed.data.clientId);
        if ("error" in auth)
          return Response.json({ ok: false, error: auth.error }, { status: auth.status });

        const conn = await getWpConnection(parsed.data.clientId);
        if (!conn) return Response.json({ ok: false, error: "Keine WordPress-Verbindung" });

        // Detect SEO plugin from stored scopes (set at connect time): "seo:yoast"/"seo:rankmath".
        const { data: connRow } = await supabaseAdmin
          .from("oauth_connections")
          .select("scopes")
          .eq("client_id", parsed.data.clientId)
          .eq("provider", "wordpress")
          .maybeSingle();
        const scopes: string[] = Array.isArray(connRow?.scopes) ? connRow!.scopes : [];
        const seoPlugin = scopes.find((s) => s.startsWith("seo:"))?.split(":")[1] || null;

        // Build the post payload
        const payload: any = { status: parsed.data.status };
        if (parsed.data.title !== undefined) payload.title = parsed.data.title;
        if (parsed.data.content !== undefined) payload.content = parsed.data.content;
        if (parsed.data.excerpt !== undefined) payload.excerpt = parsed.data.excerpt;
        if (parsed.data.slug) payload.slug = parsed.data.slug;

        // Attach SEO meta in the format the active plugin expects.
        const meta: Record<string, string> = {};
        if (seoPlugin === "yoast") {
          if (parsed.data.seoTitle) meta._yoast_wpseo_title = parsed.data.seoTitle;
          if (parsed.data.seoDescription) meta._yoast_wpseo_metadesc = parsed.data.seoDescription;
        } else if (seoPlugin === "rankmath") {
          if (parsed.data.seoTitle) meta.rank_math_title = parsed.data.seoTitle;
          if (parsed.data.seoDescription) meta.rank_math_description = parsed.data.seoDescription;
        }
        if (Object.keys(meta).length > 0) payload.meta = meta;

        const endpoint = parsed.data.postId
          ? `/wp/v2/${parsed.data.type}/${parsed.data.postId}`
          : `/wp/v2/${parsed.data.type}`;
        const r = await wpFetch<any>(conn, endpoint, { method: "POST", body: payload });
        if (!r.ok) return Response.json({ ok: false, error: r.error });

        return Response.json({
          ok: true,
          post: { id: r.data?.id, link: r.data?.link, status: r.data?.status },
          seoApplied: Object.keys(meta).length > 0 ? seoPlugin : null,
          seoPluginMissing:
            (parsed.data.seoTitle || parsed.data.seoDescription) && !seoPlugin ? true : false,
        });
      },
    },
  },
});
