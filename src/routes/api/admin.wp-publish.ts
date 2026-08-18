import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getWpConnection, wpFetch } from "@/server/wordpress.server";

// Machine-triggerable WordPress publish for autonomous (scheduled) agents.
// Protected by ADMIN_AUTOMATION_SECRET (same as /api/admin/populate) — no user
// session. Lets a scheduled agent in the agent-service publish content to a
// client's connected WordPress site. Defaults to DRAFT for a safe review step.

const Body = z.object({
  clientId: z.string().uuid().optional(),
  clientName: z.string().optional(), // resolve by name if no id
  type: z.enum(["posts", "pages"]).default("posts"),
  title: z.string().min(1),
  content: z.string().optional(), // HTML
  markdown: z.string().optional(), // converted to HTML if content not given
  excerpt: z.string().optional(),
  status: z.enum(["draft", "publish", "pending", "private"]).default("draft"),
  slug: z.string().optional(),
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
});

// Minimal Markdown → HTML (block-level) for agents that send markdown.
function mdToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  const out: string[] = [];
  let list: string | null = null;
  const close = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };
  for (const raw of String(md || "").split("\n")) {
    const line = raw.trimEnd();
    if (/^### (.+)/.test(line)) {
      close();
      out.push(`<h3>${inline(line.slice(4))}</h3>`);
    } else if (/^## (.+)/.test(line)) {
      close();
      out.push(`<h2>${inline(line.slice(3))}</h2>`);
    } else if (/^# (.+)/.test(line)) {
      close();
      out.push(`<h1>${inline(line.slice(2))}</h1>`);
    } else if (/^- (.+)/.test(line)) {
      if (list !== "ul") {
        close();
        out.push("<ul>");
        list = "ul";
      }
      out.push(`<li>${inline(line.slice(2))}</li>`);
    } else if (/^\d+\. (.+)/.test(line)) {
      if (list !== "ol") {
        close();
        out.push("<ol>");
        list = "ol";
      }
      out.push(`<li>${inline(line.replace(/^\d+\. /, ""))}</li>`);
    } else if (line.trim() === "") {
      close();
    } else {
      close();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  close();
  return out.join("\n");
}

export const Route = createFileRoute("/api/admin/wp-publish")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret)
          return Response.json(
            { ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" },
            { status: 503 },
          );
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json(
            { ok: false, error: "Invalid input", details: parsed.error.issues },
            { status: 400 },
          );
        const d = parsed.data;

        // Resolve client by id or name.
        let clientId = d.clientId || null;
        if (!clientId && d.clientName) {
          const { data } = await supabaseAdmin
            .from("clients")
            .select("id, name")
            .ilike("name", d.clientName)
            .limit(1)
            .maybeSingle();
          clientId = data?.id || null;
        }
        if (!clientId)
          return Response.json(
            { ok: false, error: "Kunde nicht gefunden (clientId/clientName)" },
            { status: 404 },
          );

        const conn = await getWpConnection(clientId);
        if (!conn)
          return Response.json({
            ok: false,
            error: "Keine WordPress-Verbindung für diesen Kunden",
          });

        // Detect SEO plugin from stored scopes.
        const { data: connRow } = await supabaseAdmin
          .from("oauth_connections")
          .select("scopes")
          .eq("client_id", clientId)
          .eq("provider", "wordpress")
          .maybeSingle();
        const scopes: string[] = Array.isArray(connRow?.scopes)
          ? (connRow!.scopes as string[])
          : [];
        const seoPlugin = scopes.find((s) => s.startsWith("seo:"))?.split(":")[1] || null;

        const html = d.content ?? (d.markdown ? mdToHtml(d.markdown) : "");
        const payload: any = { status: d.status, title: d.title, content: html };
        if (d.excerpt) payload.excerpt = d.excerpt;
        if (d.slug) payload.slug = d.slug;
        const meta: Record<string, string> = {};
        if (seoPlugin === "yoast") {
          if (d.seoTitle) meta._yoast_wpseo_title = d.seoTitle;
          if (d.seoDescription) meta._yoast_wpseo_metadesc = d.seoDescription;
        } else if (seoPlugin === "rankmath") {
          if (d.seoTitle) meta.rank_math_title = d.seoTitle;
          if (d.seoDescription) meta.rank_math_description = d.seoDescription;
        }
        if (Object.keys(meta).length) payload.meta = meta;

        const r = await wpFetch<any>(conn, `/wp/v2/${d.type}`, { method: "POST", body: payload });
        if (!r.ok) return Response.json({ ok: false, error: r.error });
        return Response.json({
          ok: true,
          post: { id: r.data?.id, link: r.data?.link, status: r.data?.status },
          seoApplied: Object.keys(meta).length ? seoPlugin : null,
        });
      },
    },
  },
});
