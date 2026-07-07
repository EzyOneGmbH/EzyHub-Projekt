import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getWpConnection, wpFetch } from "@/server/wordpress.server";

// Autonome EWWW-Einrichtung über ALLE WP-verbundenen Kunden (oauth_connections
// provider=wordpress). Pro Kunde idempotent:
//   1. ewww-image-optimizer installieren + aktivieren (WP-core, App-Passwort)
//   2. Connector vorhanden? (für Key/Config/Bulk nötig) -> sonst needsConnector
//   3. Shared Cloud-Key hinterlegen (code-write ewww_image_optimizer_cloud_key)
//   4. lazy_load=0 (Memory-Learning: doppelt sonst mit LiteSpeed -> LCP-Bremse)
//   5. ewww/config (WebP + max-Dimensionen; Connector defaultet auf Lossy, da
//      der Key jetzt gesetzt ist -> echte Verkleinerung, lokales Backup an)
//   6. resumierbaren Bulk-Lauf starten (zeitbegrenzt, markiert erledigte Bilder)
// ExactDN/CDN wird NICHT autonom aktiviert (delikat: URL-Rewriting/Caching/
// Audit-Bot) -> bewusst separater Opt-in. Secret-gated (ADMIN_AUTOMATION_SECRET).
// Key kommt aus EWWW_CLOUD_KEY (Server-Env), nie aus dem Request.

const Body = z.object({
  client: z.string().optional(), // nur ein Kunde (Name ilike / uuid); sonst alle
  bulk: z.boolean().default(true),
  bulkLimit: z.number().int().min(0).max(1000).default(150),
  maxw: z.number().int().min(0).max(8000).default(2560),
  maxh: z.number().int().min(0).max(8000).default(2560),
  dryRun: z.boolean().optional(),
});

const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ""));

const hasEwww = (plugins: any): boolean =>
  Array.isArray(plugins) &&
  plugins.some(
    (p: any) =>
      String(p.plugin || "").includes("ewww-image-optimizer") ||
      String(p.textdomain || "") === "ewww-image-optimizer",
  );
const ewwwActive = (plugins: any): boolean =>
  Array.isArray(plugins) &&
  plugins.some(
    (p: any) => String(p.plugin || "").includes("ewww-image-optimizer") && p.status === "active",
  );

export const Route = createFileRoute("/api/admin/ewww-provision")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret)
          return Response.json({ ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" }, { status: 503 });
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        const KEY = process.env.EWWW_CLOUD_KEY;
        if (!KEY)
          return Response.json(
            { ok: false, error: "EWWW_CLOUD_KEY nicht in der Server-Env gesetzt (Lovable)" },
            { status: 503 },
          );

        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Invalid input", details: parsed.error.issues }, { status: 400 });
        const b = parsed.data;

        // WP-verbundene Kunden ermitteln
        let clientIds: string[] = [];
        if (b.client) {
          let cid = isUuid(b.client) ? b.client : "";
          if (!cid) {
            const { data } = await supabaseAdmin
              .from("clients").select("id").ilike("name", `%${b.client}%`).limit(1).maybeSingle();
            cid = data?.id || "";
          }
          if (cid) clientIds = [cid];
        } else {
          const { data } = await supabaseAdmin
            .from("oauth_connections").select("client_id").eq("provider", "wordpress");
          clientIds = [...new Set((data || []).map((r: any) => r.client_id).filter(Boolean))] as string[];
        }
        if (!clientIds.length)
          return Response.json({ ok: false, error: "Keine WP-verbundenen Kunden gefunden" }, { status: 404 });

        const { data: cRows } = await supabaseAdmin.from("clients").select("id, name").in("id", clientIds);
        const nameOf: Record<string, string> = Object.fromEntries((cRows || []).map((c: any) => [c.id, c.name]));

        const results: any[] = [];
        for (const clientId of clientIds) {
          const name = nameOf[clientId] || clientId;
          const conn = await getWpConnection(clientId);
          if (!conn) {
            results.push({ client: name, skipped: "keine WP-Verbindung" });
            continue;
          }
          const steps: Record<string, any> = {};
          try {
            // 1) EWWW-Status
            const list = await wpFetch<any[]>(conn, "/wp/v2/plugins", { query: { search: "ewww" } });
            const installed = hasEwww(list.data);
            const active = ewwwActive(list.data);
            if (b.dryRun) {
              results.push({ client: name, ewwwInstalled: installed, ewwwActive: active, dryRun: true });
              continue;
            }
            // 1b) installieren + aktivieren, falls nötig
            if (!active) {
              const inst = await wpFetch<any>(conn, "/wp/v2/plugins", {
                method: "POST",
                body: { slug: "ewww-image-optimizer", status: "active" },
              });
              steps.install = inst.ok ? "installiert+aktiviert" : inst.error;
            } else steps.install = "schon aktiv";

            // 2) Connector vorhanden? (für Key/Config/Bulk nötig)
            const status = await wpFetch<any>(conn, "/ezyhub/v1/status");
            if (!status.ok) {
              results.push({
                client: name,
                steps,
                needsConnector: true,
                note: "EWWW installiert, aber EzyHub-Connector fehlt -> Key/Config/Bulk manuell/nach Connector-Install",
              });
              continue;
            }

            // 3) Cloud-Key hinterlegen
            const keySet = await wpFetch<any>(conn, "/ezyhub/v1/code-write", {
              method: "POST",
              body: { where: "option", optionName: "ewww_image_optimizer_cloud_key", content: KEY },
            });
            steps.key = keySet.ok ? "gesetzt" : keySet.error;

            // 4) lazy_load=0 (Memory-Learning gegen LCP-Regression)
            const lz = await wpFetch<any>(conn, "/ezyhub/v1/code-write", {
              method: "POST",
              body: { where: "option", optionName: "ewww_image_optimizer_lazy_load", content: "" },
            });
            steps.lazyLoadOff = lz.ok ? "ok" : lz.error;

            // 5) Config (WebP + Dimensionen; Connector defaultet Lossy da Key da)
            const cfg = await wpFetch<any>(conn, "/ezyhub/v1/ewww/config", {
              method: "POST",
              body: { webp: 1, maxw: b.maxw, maxh: b.maxh },
            });
            steps.config = cfg.ok
              ? { cloud_key: cfg.data?.cloud_key, png_level: cfg.data?.png_level, jpg_level: cfg.data?.jpg_level, backup: cfg.data?.backup_files }
              : cfg.error;

            // 6) resumierbarer Bulk
            if (b.bulk) {
              const bulk = await wpFetch<any>(conn, "/ezyhub/v1/ewww/bulk", {
                method: "POST",
                body: { limit: b.bulkLimit },
              });
              steps.bulk = bulk.ok ? bulk.data : bulk.error;
            }

            const keyOk = cfg.ok && cfg.data?.cloud_key === true;
            results.push({ client: name, ok: true, keyActive: keyOk, steps });
          } catch (e: any) {
            results.push({ client: name, error: String(e?.message || e).slice(0, 200), steps });
          }
        }
        return Response.json({ ok: true, clients: clientIds.length, results });
      },
    },
  },
});
