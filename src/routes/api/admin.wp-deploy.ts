import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getWpConnection, wpFetch } from "@/server/wordpress.server";

// Machine-triggerable technical-SEO deploy for autonomous (scheduled) agents.
// Generic allowlisted passthrough to the EzyHub Connector plugin. Secret-gated
// (ADMIN_AUTOMATION_SECRET). All changes are reversible (WP options / postmeta).

// action -> { method, plugin path, allowed body fields }
const ACTIONS: Record<string, { method: "GET" | "POST"; path: string; fields: string[] }> = {
  status: { method: "GET", path: "/ezyhub/v1/status", fields: [] },
  purge: { method: "POST", path: "/ezyhub/v1/purge", fields: [] },
  head: { method: "POST", path: "/ezyhub/v1/head", fields: ["key", "html"] },
  "llms-txt": { method: "POST", path: "/ezyhub/v1/llms-txt", fields: ["content"] },
  "robots-txt": { method: "POST", path: "/ezyhub/v1/robots-txt", fields: ["content"] },
  "page-meta": {
    method: "POST",
    path: "/ezyhub/v1/page-meta",
    fields: ["postId", "seoTitle", "seoDescription", "canonical", "noindex"],
  },
  "alt-text": { method: "POST", path: "/ezyhub/v1/alt-text", fields: ["attachmentId", "alt"] },
  "images-missing-alt": { method: "GET", path: "/ezyhub/v1/images-missing-alt", fields: ["limit"] },
  "elementor-headings": {
    method: "GET",
    path: "/ezyhub/v1/elementor/headings",
    fields: ["postId"],
  },
  "elementor-set-heading": {
    method: "POST",
    path: "/ezyhub/v1/elementor/set-heading",
    // "title" seit Connector v1.9.12 (Widget-Map): erlaubt H1-Text-Korrekturen
    fields: ["postId", "widgetId", "tag", "title"],
  },
  "elementor-text-widgets": {
    method: "GET",
    path: "/ezyhub/v1/elementor/text-widgets",
    fields: ["postId"],
  },
  "elementor-set-text": {
    method: "POST",
    path: "/ezyhub/v1/elementor/set-text",
    fields: ["postId", "widgetId", "html"],
  },
  "elementor-backups": { method: "GET", path: "/ezyhub/v1/elementor/backups", fields: ["postId"] },
  "elementor-restore": {
    method: "POST",
    path: "/ezyhub/v1/elementor/restore",
    fields: ["postId", "ts"],
  },
  "perf-status": { method: "GET", path: "/ezyhub/v1/perf/status", fields: [] },
  "perf-litespeed": { method: "POST", path: "/ezyhub/v1/perf/litespeed", fields: ["settings"] },
  "elementor-fix-encoding": {
    method: "POST",
    path: "/ezyhub/v1/elementor/fix-encoding",
    fields: ["postId"],
  },
  "plugin-self-update": {
    method: "POST",
    path: "/ezyhub/v1/plugin/self-update",
    fields: ["contentB64"],
  },
  // WP-core endpoints (not the connector): install/activate a wordpress.org
  // plugin by slug, and toggle its active state. Used for autonomous
  // performance fixes (caching, image/WebP optimization).
  "plugin-install": { method: "POST", path: "/wp/v2/plugins", fields: ["slug", "status"] },
  "plugins-list": { method: "GET", path: "/wp/v2/plugins", fields: ["search"] },
  "ewww-config": { method: "POST", path: "/ezyhub/v1/ewww/config", fields: ["webp", "maxw", "maxh"] },
  "ewww-bulk": { method: "POST", path: "/ezyhub/v1/ewww/bulk", fields: ["limit"] },
  // Code-snippet locate/replace (header/footer scripts, plugin settings, etc.)
  "code-locate": { method: "POST", path: "/ezyhub/v1/code-locate", fields: ["needle"] },
  "code-write": {
    method: "POST",
    path: "/ezyhub/v1/code-write",
    fields: ["where", "id", "metaKey", "optionName", "content"],
  },
  // Theme-file editor (sandboxed to wp-content/themes, backup + php -l + restore)
  "theme-file-locate": {
    method: "POST",
    path: "/ezyhub/v1/theme-file-locate",
    fields: ["needle"],
  },
  "theme-file-read": { method: "POST", path: "/ezyhub/v1/theme-file-read", fields: ["file"] },
  "theme-file-write": {
    method: "POST",
    path: "/ezyhub/v1/theme-file-write",
    fields: ["file", "oldString", "newString", "content"],
  },
  "theme-file-restore": {
    method: "POST",
    path: "/ezyhub/v1/theme-file-restore",
    fields: ["file", "backup"],
  },
  // Activate/deactivate an already-installed allowlisted plugin. Path is built
  // from the slug in the handler (per-plugin WP-core endpoint).
  "plugin-toggle": { method: "POST", path: "/wp/v2/plugins", fields: ["slug", "status"] },
};

// Only reputable, reversible performance/SEO plugins may be installed via the
// bridge. Installing a plugin is a real change to a live client site, so the
// surface is kept deliberately narrow.
const PLUGIN_SLUG_ALLOWLIST = new Set([
  "litespeed-cache",
  "ewww-image-optimizer",
  "autoptimize",
  "webp-converter-for-media",
  "ezyhub-connector", // our own connector (activate remotely if only deactivated)
]);

const Body = z.object({
  clientId: z.string().uuid().optional(),
  clientName: z.string().optional(),
  action: z.string(),
  // free-form payload; only allowlisted fields per action are forwarded
  key: z.string().optional(),
  html: z.string().optional(),
  content: z.string().optional(),
  postId: z.number().int().optional(),
  attachmentId: z.number().int().optional(),
  alt: z.string().optional(),
  widgetId: z.string().optional(),
  tag: z.string().optional(),
  title: z.string().optional(),
  ts: z.string().optional(),
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
  canonical: z.string().optional(),
  noindex: z.boolean().optional(),
  limit: z.number().int().optional(),
  settings: z.record(z.union([z.number(), z.boolean()])).optional(),
  contentB64: z.string().optional(),
  slug: z.string().optional(),
  status: z.string().optional(),
  search: z.string().optional(),
  webp: z.number().int().optional(),
  maxw: z.number().int().optional(),
  maxh: z.number().int().optional(),
  plugin: z.string().optional(),
  // code-locate / code-write
  needle: z.string().optional(),
  where: z.enum(["post", "postmeta", "option"]).optional(),
  id: z.number().int().optional(),
  metaKey: z.string().optional(),
  optionName: z.string().optional(),
  // theme-file editor
  file: z.string().optional(),
  oldString: z.string().optional(),
  newString: z.string().optional(),
  backup: z.string().optional(),
});

export const Route = createFileRoute("/api/admin/wp-deploy")({
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
        const d = parsed.data as Record<string, any>;

        const spec = ACTIONS[d.action];
        if (!spec)
          return Response.json(
            { ok: false, error: `Unbekannte action: ${d.action}` },
            { status: 400 },
          );

        let clientId = d.clientId || null;
        if (!clientId && d.clientName) {
          const { data } = await supabaseAdmin
            .from("clients")
            .select("id")
            .ilike("name", d.clientName)
            .limit(1)
            .maybeSingle();
          clientId = data?.id || null;
        }
        if (!clientId)
          return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });

        const conn = await getWpConnection(clientId);
        if (!conn) return Response.json({ ok: false, error: "Keine WordPress-Verbindung" });

        // WP-core actions (plugin management) use the app-password directly and
        // must NOT require the connector plugin — it may be exactly what we are
        // installing/activating. Only connector (/ezyhub/) actions need the
        // status pre-check.
        const isCoreAction = spec.path.startsWith("/wp/");
        if (!isCoreAction) {
          const status = await wpFetch<any>(conn, "/ezyhub/v1/status");
          if (!status.ok) {
            return Response.json({
              ok: false,
              pluginMissing: true,
              error:
                "EzyHub-Connector-Plugin nicht gefunden/aktiv. Bitte auf der WordPress-Seite installieren & aktivieren (Version ≥ 1.1.0).",
            });
          }
          if (d.action === "status") return Response.json({ ok: true, status: status.data });
        }

        // Guard plugin installs: slug must be on the allowlist; default to
        // installing AND activating in one call.
        if (d.action === "plugin-install") {
          if (!d.slug || !PLUGIN_SLUG_ALLOWLIST.has(String(d.slug)))
            return Response.json(
              { ok: false, error: `Plugin-Slug nicht erlaubt: ${d.slug ?? "(leer)"}` },
              { status: 400 },
            );
          if (d.status === undefined) d.status = "active";
        }

        // Activate/deactivate an installed plugin via the per-plugin endpoint.
        if (d.action === "plugin-toggle") {
          if (!d.slug || !PLUGIN_SLUG_ALLOWLIST.has(String(d.slug)))
            return Response.json(
              { ok: false, error: `Plugin-Slug nicht erlaubt: ${d.slug ?? "(leer)"}` },
              { status: 400 },
            );
          const wanted = d.status === "active" ? "active" : "inactive";
          // Exact plugin identifier (folder/file) may differ from slug/slug;
          // allow passing it explicitly (discovered via plugins-list).
          const plugin = d.plugin ? String(d.plugin) : `${d.slug}/${d.slug}`;
          const r = await wpFetch<any>(conn, `/wp/v2/plugins/${plugin}`, {
            method: "POST",
            body: { status: wanted },
          });
          if (!r.ok) return Response.json({ ok: false, error: r.error });
          return Response.json({ ok: true, result: r.data });
        }

        // Build the forwarded payload from the allowlisted fields only.
        if (spec.method === "GET") {
          const query: Record<string, string | number> = {};
          for (const f of spec.fields) if (d[f] !== undefined) query[f] = d[f];
          const r = await wpFetch<any>(conn, spec.path, { query });
          if (!r.ok) return Response.json({ ok: false, error: r.error });
          return Response.json({ ok: true, result: r.data });
        }
        const body: Record<string, any> = {};
        for (const f of spec.fields) if (d[f] !== undefined) body[f] = d[f];
        // Self-Update schreibt die ganze Plugin-Datei (~85KB) + OPcache/Cache-Purge —
        // auf langsamen Origins (TIMEOUT) dauert das laenger als die 20s-Default.
        const timeoutMs = d.action === "plugin-self-update" ? 180_000 : undefined;
        const r = await wpFetch<any>(conn, spec.path, { method: "POST", body, timeoutMs });
        if (!r.ok) return Response.json({ ok: false, error: r.error });
        return Response.json({ ok: true, result: r.data });
      },
    },
  },
});
