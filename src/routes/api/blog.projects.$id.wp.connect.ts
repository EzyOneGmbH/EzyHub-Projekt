import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { blogEvent, requireBlogProject } from "@/server/blog-autopilot.server";
import { encryptSecret } from "@/server/secretbox.server";
import { normalizeSiteUrl } from "@/server/wordpress.server";
import { EZR_KEY_RE, schluesselVerwerfen, testeVerbindung } from "@/server/ezyrank-wp.server";

// POST /api/blog/projects/:id/wp/connect {siteUrl, key} (Kap. 6A Schritt 6, Kap. 8):
// testet die Verbindung (/health, /capabilities, /test) und speichert den
// Schlüssel verschlüsselt. Ein Schlüssel, der sicher nutzlos ist (falsch,
// Plugin fehlt, Seite nicht erreichbar), wird nicht gespeichert. Der
// Klartext-Schlüssel wird nie zurückgegeben oder geloggt.

const Body = z.object({
  siteUrl: z.string().min(4).max(300),
  key: z.string().trim().regex(EZR_KEY_RE, "Schlüssel hat nicht das Format ezr_…"),
});

export const Route = createFileRoute("/api/blog/projects/$id/wp/connect")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const r = await requireBlogProject(request, params.id);
        if (r instanceof Response) return r;
        const { ctx, project } = r;

        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json(
            { ok: false, error: parsed.error.issues[0]?.message || "Ungültige Eingabe" },
            { status: 400 },
          );
        const siteUrl = normalizeSiteUrl(parsed.data.siteUrl);
        if (!/^https:\/\//i.test(siteUrl))
          return Response.json(
            {
              ok: false,
              error_code: "ezr_https_required",
              error: "Die Site-URL muss mit https:// beginnen",
            },
            { status: 400 },
          );

        const test = await testeVerbindung({ siteUrl, key: parsed.data.key });
        const jetzt = new Date().toISOString();

        if (!test.ok && schluesselVerwerfen(test.error_code)) {
          await blogEvent(
            project.id,
            "onboarding.wp_test_failed",
            { error_code: test.error_code, dauer_ms: test.dauer_ms },
            ctx.userId,
          );
          return Response.json({ ok: false, gespeichert: false, test });
        }

        const zeile = {
          project_id: project.id,
          site_url: siteUrl,
          key_enc: encryptSecret(parsed.data.key),
          scopes: test.scopes.length ? test.scopes : ["read", "draft"],
          plugin_version: test.plugin_version,
          capabilities: test.capabilities,
          status: test.ok ? "verbunden" : "aktion_noetig",
          last_error_code: test.error_code,
          last_checked_at: jetzt,
        };
        const { error } = await (supabaseAdmin as any)
          .from("wp_connections")
          .upsert(zeile, { onConflict: "project_id" });
        if (error)
          return Response.json(
            { ok: false, error: "Verbindung konnte nicht gespeichert werden" },
            { status: 500 },
          );

        await blogEvent(
          project.id,
          test.ok ? "wp.connected" : "onboarding.wp_test_failed",
          {
            error_code: test.error_code,
            plugin_version: test.plugin_version,
            scopes: zeile.scopes,
            dauer_ms: test.dauer_ms,
          },
          ctx.userId,
        );
        return Response.json({
          ok: test.ok,
          gespeichert: true,
          test,
          wordpress: {
            site_url: siteUrl,
            status: zeile.status,
            scopes: zeile.scopes,
            plugin_version: zeile.plugin_version,
            last_error_code: zeile.last_error_code,
            last_checked_at: jetzt,
          },
        });
      },
    },
  },
});
