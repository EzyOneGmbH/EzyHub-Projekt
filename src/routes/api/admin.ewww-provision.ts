// redeploy-marker: ewww cloud-key set+verify — 2026-07-07a
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
  exactdn: z.boolean().default(false), // Easy IO / ExactDN CDN aktivieren (braucht registrierte Zone)
  exactdnDomain: z.string().optional(), // xxxx.exactdn.com aus dem EasyIO-Konto (pro Site)
  reset: z.boolean().default(false), // Done-Marker löschen -> ALLE Bilder neu (nach Key-Verify)
  bulkLimit: z.number().int().min(0).max(1000).default(150),
  maxw: z.number().int().min(0).max(8000).default(2560),
  maxh: z.number().int().min(0).max(8000).default(2560),
  dryRun: z.boolean().optional(),
});

const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ""));

// NUR Kunden mit hinterlegten SEO-Agenten bekommen EWWW (User-Vorgabe). Campagnola
// u.a. ohne Agent bleiben aussen vor. Bei neuem Agenten-Kunden hier ID ergaenzen.
const AGENT_CLIENTS = new Set<string>([
  "0f891a24-08bf-4110-8168-51d7a41dbe36", // Faith in Humanity
  "2281ce0d-6dbe-4bf5-8bdd-f8ef5d6d360c", // Hotel Ava
  "359497da-e13a-44e8-a5f1-0a28a3b67b28", // TIMEOUT Memberclub
  "d5675714-4249-4d82-949f-460b53d64dac", // Ezy Hotel
]);

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
          return Response.json(
            { ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" },
            { status: 503 },
          );
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
          return Response.json(
            { ok: false, error: "Invalid input", details: parsed.error.issues },
            { status: 400 },
          );
        const b = parsed.data;

        // WP-verbundene Kunden ermitteln
        let clientIds: string[] = [];
        if (b.client) {
          let cid = isUuid(b.client) ? b.client : "";
          if (!cid) {
            const { data } = await supabaseAdmin
              .from("clients")
              .select("id")
              .ilike("name", `%${b.client}%`)
              .limit(1)
              .maybeSingle();
            cid = data?.id || "";
          }
          if (cid) clientIds = [cid];
        } else {
          const { data } = await supabaseAdmin
            .from("oauth_connections")
            .select("client_id")
            .eq("provider", "wordpress");
          clientIds = [
            ...new Set((data || []).map((r: any) => r.client_id).filter(Boolean)),
          ] as string[];
        }
        // Gate: nur Agenten-Kunden (SEO-Massnahmen) einrichten.
        clientIds = clientIds.filter((id) => AGENT_CLIENTS.has(id));
        if (!clientIds.length)
          return Response.json(
            {
              ok: false,
              error:
                "Keine WP-verbundenen Agenten-Kunden gefunden (nur Kunden mit SEO-Agent werden eingerichtet)",
            },
            { status: 404 },
          );

        const { data: cRows } = await supabaseAdmin
          .from("clients")
          .select("id, name")
          .in("id", clientIds);
        const nameOf: Record<string, string> = Object.fromEntries(
          (cRows || []).map((c: any) => [c.id, c.name]),
        );

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
            const list = await wpFetch<any[]>(conn, "/wp/v2/plugins", {
              query: { search: "ewww" },
            });
            const installed = hasEwww(list.data);
            const active = ewwwActive(list.data);
            if (b.dryRun) {
              results.push({
                client: name,
                ewwwInstalled: installed,
                ewwwActive: active,
                dryRun: true,
              });
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

            // 3) lazy_load=0 (Memory-Learning gegen LCP-Regression). '0' statt ''
            // (code-write verlangt einen Wert; '0' ist für EWWW falsy = aus).
            const lz = await wpFetch<any>(conn, "/ezyhub/v1/code-write", {
              method: "POST",
              body: { where: "option", optionName: "ewww_image_optimizer_lazy_load", content: "0" },
            });
            steps.lazyLoadOff = lz.ok ? "ok" : lz.error;

            // 4) Config: Cloud-Key SETZEN+VERIFIZIEREN (Connector v1.9.7) + WebP +
            // Dimensionen. Der Connector defaultet danach auf Lossy (Key verifiziert).
            const cfg = await wpFetch<any>(conn, "/ezyhub/v1/ewww/config", {
              method: "POST",
              body: { cloud_key: KEY, webp: 1, maxw: b.maxw, maxh: b.maxh },
            });
            steps.config = cfg.ok
              ? {
                  key: cfg.data?.set?.cloud_key_status,
                  cloud_key: cfg.data?.cloud_key,
                  png_level: cfg.data?.png_level,
                  jpg_level: cfg.data?.jpg_level,
                  backup: cfg.data?.backup_files,
                }
              : cfg.error;

            // 4b) Easy IO / ExactDN CDN aktivieren (Zone bei EasyIO registrieren)
            if (b.exactdn) {
              const ex = await wpFetch<any>(conn, "/ezyhub/v1/ewww/exactdn", {
                method: "POST",
                body: { enable: true, ...(b.exactdnDomain ? { domain: b.exactdnDomain } : {}) },
              });
              // ex.data.needsZone -> Site muss erst im EasyIO-Konto registriert werden.
              steps.exactdn = ex.ok
                ? ex.data?.ok === false
                  ? { needsZone: true, hint: ex.data?.hint }
                  : { enabled: ex.data?.exactdn, domain: ex.data?.domain }
                : ex.error;
            }

            // 5) resumierbarer Bulk (reset=true erzwingt Neu-Optimierung, z.B. nach Key-Verify)
            if (b.bulk) {
              const bulk = await wpFetch<any>(conn, "/ezyhub/v1/ewww/bulk", {
                method: "POST",
                body: { limit: b.bulkLimit, ...(b.reset ? { reset: true } : {}) },
              });
              steps.bulk = bulk.ok ? bulk.data : bulk.error;
            }

            const keyStored = cfg.ok && cfg.data?.cloud_key === true;
            results.push({ client: name, ok: true, keyStored, steps });
          } catch (e: any) {
            results.push({ client: name, error: String(e?.message || e).slice(0, 200), steps });
          }
        }
        return Response.json({ ok: true, clients: clientIds.length, results });
      },
    },
  },
});
