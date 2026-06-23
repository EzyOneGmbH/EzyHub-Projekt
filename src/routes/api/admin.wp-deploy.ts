import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getWpConnection, wpFetch } from "@/server/wordpress.server";

// Machine-triggerable technical-SEO deploy for autonomous (scheduled) agents.
// Pushes <head> snippets / llms.txt / page-meta to the EzyHub Connector plugin
// on the client's WordPress site. Secret-gated (ADMIN_AUTOMATION_SECRET).
// All changes are reversible (stored in WP options by the plugin).

const Body = z.object({
  clientId: z.string().uuid().optional(),
  clientName: z.string().optional(),
  // exactly one action per call
  action: z.enum(["status", "head", "llms-txt", "page-meta"]),
  key: z.string().optional(),           // head snippet name
  html: z.string().optional(),          // head snippet html
  content: z.string().optional(),       // llms.txt content
  postId: z.number().int().optional(),
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
});

export const Route = createFileRoute("/api/admin/wp-deploy")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret) return Response.json({ ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" }, { status: 503 });
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) return Response.json({ ok: false, error: "Invalid input", details: parsed.error.issues }, { status: 400 });
        const d = parsed.data;

        let clientId = d.clientId || null;
        if (!clientId && d.clientName) {
          const { data } = await supabaseAdmin
            .from("clients").select("id").ilike("name", d.clientName).limit(1).maybeSingle();
          clientId = data?.id || null;
        }
        if (!clientId) return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });

        const conn = await getWpConnection(clientId);
        if (!conn) return Response.json({ ok: false, error: "Keine WordPress-Verbindung" });

        // Probe the connector plugin first (clear error if not installed).
        const status = await wpFetch<any>(conn, "/ezyhub/v1/status");
        if (!status.ok) {
          return Response.json({
            ok: false,
            error: "EzyHub-Connector-Plugin nicht gefunden. Bitte einmalig auf der WordPress-Seite installieren & aktivieren.",
            pluginMissing: true,
          });
        }
        if (d.action === "status") return Response.json({ ok: true, status: status.data });

        let res;
        if (d.action === "head") {
          if (!d.key) return Response.json({ ok: false, error: "key erforderlich" }, { status: 400 });
          res = await wpFetch<any>(conn, "/ezyhub/v1/head", { method: "POST", body: { key: d.key, html: d.html ?? "" } });
        } else if (d.action === "llms-txt") {
          res = await wpFetch<any>(conn, "/ezyhub/v1/llms-txt", { method: "POST", body: { content: d.content ?? "" } });
        } else if (d.action === "page-meta") {
          if (!d.postId) return Response.json({ ok: false, error: "postId erforderlich" }, { status: 400 });
          res = await wpFetch<any>(conn, "/ezyhub/v1/page-meta", { method: "POST", body: { postId: d.postId, seoTitle: d.seoTitle, seoDescription: d.seoDescription } });
        }
        if (!res || !res.ok) return Response.json({ ok: false, error: res?.error || "Deploy fehlgeschlagen" });
        return Response.json({ ok: true, result: res.data });
      },
    },
  },
});
