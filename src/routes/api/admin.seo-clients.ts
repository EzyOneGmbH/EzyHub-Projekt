import { createFileRoute } from "@tanstack/react-router";
import { ladeSeoKunden } from "@/server/seo-report.server";

// Liste aller aktiven EzyRank-Kunden mit Report-Konfiguration (21.10.2026) für
// den n8n-Workflow «SEO Monatspräsentation». Gleicher Schutz wie
// /api/admin/ads-clients (ADMIN_AUTOMATION_SECRET). Nur lesend, keine
// Sistrix-Abfragen. Aktiv = seo_report_config.report_active + App «seo» +
// Kunde nicht pausiert.

export const Route = createFileRoute("/api/admin/seo-clients")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret)
          return Response.json(
            { ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" },
            { status: 503 },
          );
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        try {
          const clients = await ladeSeoKunden();
          return Response.json({ ok: true, count: clients.length, clients });
        } catch (e) {
          return Response.json(
            { ok: false, error: String((e as Error)?.message || e).slice(0, 200) },
            { status: 500 },
          );
        }
      },
    },
  },
});
