import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { blogEvent, requireBlogProject } from "@/server/blog-autopilot.server";
import { decryptSecret } from "@/server/secretbox.server";
import { testeVerbindung } from "@/server/ezyrank-wp.server";

// POST /api/blog/projects/:id/wp/test (Kap. 8): testet die gespeicherte
// Verbindung erneut und setzt den Status nicht_verbunden → test_laeuft →
// verbunden | aktion_noetig (Kap. 7.10).

export const Route = createFileRoute("/api/blog/projects/$id/wp/test")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const r = await requireBlogProject(request, params.id);
        if (r instanceof Response) return r;
        const { ctx, project } = r;

        const { data: wp } = await (supabaseAdmin as any)
          .from("wp_connections")
          .select("id, site_url, key_enc")
          .eq("project_id", project.id)
          .maybeSingle();
        if (!wp?.key_enc)
          return Response.json(
            { ok: false, error: "Noch keine WordPress-Verbindung gespeichert" },
            { status: 409 },
          );

        await (supabaseAdmin as any)
          .from("wp_connections")
          .update({ status: "test_laeuft" })
          .eq("id", wp.id);
        const test = await testeVerbindung({
          siteUrl: wp.site_url,
          key: decryptSecret(wp.key_enc),
        });
        const jetzt = new Date().toISOString();
        const status = test.ok ? "verbunden" : "aktion_noetig";
        await (supabaseAdmin as any)
          .from("wp_connections")
          .update({
            status,
            last_error_code: test.error_code,
            last_checked_at: jetzt,
            ...(test.plugin_version ? { plugin_version: test.plugin_version } : {}),
            ...(test.scopes.length ? { scopes: test.scopes } : {}),
            ...(test.capabilities ? { capabilities: test.capabilities } : {}),
          })
          .eq("id", wp.id);
        await blogEvent(
          project.id,
          test.ok ? "wp.test_ok" : "wp.test_failed",
          { error_code: test.error_code, dauer_ms: test.dauer_ms },
          ctx.userId,
        );
        return Response.json({ ok: test.ok, test, wordpress: { status, last_checked_at: jetzt } });
      },
    },
  },
});
