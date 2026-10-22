import { createFileRoute } from "@tanstack/react-router";
import { heuteYmdZuerich } from "@/lib/date-range";
import {
  istMonat,
  istYmd,
  monatInZukunft,
  monatsEnde,
  periodenFuerMonat,
  periodenFuerZeitraum,
  tageZwischen,
  type Perioden,
} from "@/lib/seoReport";
import {
  berechneSeoReport,
  echteQuellen,
  ladeSeoKunde,
  ladeSnapshot,
  speichereSnapshot,
  zeitraumUnvollstaendig,
} from "@/server/seo-report.server";

// SEO-Report eines Kunden (21.10.2026, Spezifikation «EzyHub Endpoint:
// SEO-Report-Daten»; Daten aus EzyHub, GSC, GA4 — kein Sistrix). Nur lesend;
// schreibt einzig Monats-Snapshots in seo_report_snapshots.
// Aufrufer: n8n-Unter-Workflow pro Kunde am 3. des Monats. Schutz wie
// /api/admin/ads-clients.
// GET ?client=<id> | ?awork=<projekt-id>
//     &month=YYYY-MM                      Kalendermonat (Vormonat, Vorjahresmonat)
//     &from=YYYY-MM-DD&to=YYYY-MM-DD      freier Zeitraum (22.10.2026): gleich
//                                         lange Vorperiode, gleicher Zeitraum Vorjahr
//     [&refresh=true]
// Snapshots nur für vollständige Monate (meta.cached:true beim zweiten Aufruf).
// Unvollständige Zeiträume (Ende innerhalb der letzten 3 Tage) → meta.partial,
// kein Snapshot. Freie Zeiträume werden nie gespeichert.

const MAX_TAGE = 400;

function periodeAus(sp: URLSearchParams, heute: string): Perioden | string {
  const from = sp.get("from");
  const to = sp.get("to");
  if (from || to) {
    if (!istYmd(from) || !istYmd(to) || from > to || to > heute)
      return "Ungültiger Zeitraum (from/to als YYYY-MM-DD, from ≤ to, nicht in der Zukunft)";
    if (tageZwischen(from, to) + 1 > MAX_TAGE) return `Zeitraum länger als ${MAX_TAGE} Tage`;
    return periodenFuerZeitraum(from, to);
  }
  const monat = sp.get("month") || "";
  if (!istMonat(monat) || monatInZukunft(monat, heute))
    return "Ungültiger Monat (YYYY-MM, nicht in der Zukunft) — oder from/to angeben";
  return periodenFuerMonat(monat);
}

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
        const heute = heuteYmdZuerich();
        const periode = periodeAus(sp, heute);
        if (typeof periode === "string")
          return Response.json({ ok: false, error: periode }, { status: 400 });
        const monat = periode.monat;
        // Snapshot nur für vollständige Kalendermonate
        const speicherbar = !!monat && !zeitraumUnvollstaendig(monatsEnde(monat), heute);
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

          if (speicherbar && monat && sp.get("refresh") !== "true") {
            const snap = await ladeSnapshot(kunde.id, monat);
            if (snap?.meta)
              return Response.json({
                ...snap,
                meta: { ...snap.meta, cached: true, dataforseo_cost: 0 },
              });
          }

          const report = await berechneSeoReport(kunde, periode, echteQuellen(kunde, monat), {
            heute,
          });
          if (speicherbar && monat) await speichereSnapshot(kunde.id, monat, report);
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
