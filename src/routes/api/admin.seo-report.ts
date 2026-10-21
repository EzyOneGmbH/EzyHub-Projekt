import { createFileRoute } from "@tanstack/react-router";
import { heuteYmdZuerich } from "@/lib/date-range";
import { istMonat, monatInZukunft } from "@/lib/seoReport";
import {
  berechneSeoReport,
  echteQuellen,
  ladeSeoKunde,
  ladeSnapshot,
  speichereSnapshot,
} from "@/server/seo-report.server";

// SEO-Monatsreport eines Kunden (21.10.2026, Spezifikation «EzyHub Endpoint:
// SEO-Report-Daten»; Daten aus EzyHub, DataForSEO, GSC, GA4 — kein Sistrix).
// Aufrufer: n8n-Unter-Workflow pro Kunde am 3. des Monats. Schutz wie
// /api/admin/ads-clients.
// GET ?client=<id> | ?awork=<projekt-id>  &month=YYYY-MM  [&refresh=true]
// Gespeicherter Snapshot → meta.cached:true, keine DataForSEO-Kosten.

export const Route = createFileRoute("/api/admin/seo-report")({
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

        const sp = new URL(request.url).searchParams;
        const monat = sp.get("month") || "";
        const heute = heuteYmdZuerich();
        if (!istMonat(monat) || monatInZukunft(monat, heute))
          return Response.json(
            { ok: false, error: "Ungültiger Monat (YYYY-MM, nicht in der Zukunft)" },
            { status: 400 },
          );
        try {
          const kunde = await ladeSeoKunde({
            client: sp.get("client") || undefined,
            awork: sp.get("awork") || undefined,
          });
          if (!kunde || !kunde.domain)
            return Response.json(
              { ok: false, error: "Kunde unbekannt oder ohne EzyRank" },
              { status: 404 },
            );

          if (sp.get("refresh") !== "true") {
            const snap = await ladeSnapshot(kunde.id, monat);
            if (snap?.meta)
              return Response.json({
                ...snap,
                meta: { ...snap.meta, cached: true, dataforseo_cost: 0, ahrefs_units: 0 },
              });
          }

          const report = await berechneSeoReport(kunde, monat, echteQuellen(kunde, monat), {
            heute,
          });
          await speichereSnapshot(kunde.id, monat, report);
          return Response.json(report);
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
