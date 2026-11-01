import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { TYP_VON_REC, recVonTyp } from "@/lib/contentMassnahmen";
import {
  erstelleEmpfehlung,
  isProviderEnabled,
  ladeCache,
  ladeKunde,
  luecken,
  speichereCache,
} from "@/server/content-actions.server";

// KI-Empfehlung zu einer Content-Massnahme (01.11.2026) — wie «Mit KI erstellen»
// im Massnahmen-Modal (Live-Artikel + GSC-Suchanfragen der Seite), erweitert um
// die Top 5 Google Schweiz (DataForSEO, Sprache des Artikels) samt Überschriften
// und interne Links nur von starken Seiten derselben Domain (GSC-Klicks).
// Schutz wie /api/admin/seo-report. Schreibt nur content_action_recommendations
// (Cache, 7 Tage). Fehler → { ok:false, error } mit HTTP 200.
// POST { client, url, type, keyword } [?refresh=true]

const Body = z.object({
  client: z.string().uuid(),
  url: z.string().url(),
  type: z.string().min(1),
  keyword: z.string().trim().min(1).max(200),
});

const BUDGET_MS = 140_000; // unter 150 s pro Aufruf

const fehler = (error: string) =>
  Response.json({ ok: false, error }, { headers: { "Cache-Control": "no-store" } });

export const Route = createFileRoute("/api/admin/content-actions/recommendation")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const start = Date.now();
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret)
          return Response.json(
            { ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" },
            { status: 503 },
          );
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return fehler(
            "Ungültige Eingabe: " +
              parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; "),
          );
        const d = parsed.data;
        const rec = recVonTyp(d.type);
        if (!rec) return fehler(`Unbekannter type «${d.type}»`);
        const type = TYP_VON_REC[rec];
        const refresh = new URL(request.url).searchParams.get("refresh") === "true";

        try {
          const kunde = await ladeKunde(d.client);
          if (!kunde) return fehler("Kunde unbekannt");
          if (!(await isProviderEnabled(kunde.id, "anthropic")))
            return fehler("Claude/Anthropic für diesen Kunden deaktiviert");

          if (!refresh) {
            const c = await ladeCache(kunde.id, d.url, type);
            if (c?.payload)
              return Response.json(
                {
                  ok: true,
                  recommendation: c.payload,
                  generated_at: new Date(c.generated_at).toISOString(),
                  cached: true,
                },
                { headers: { "Cache-Control": "no-store" } },
              );
          }

          const { recommendation, hinweise, cost } = await erstelleEmpfehlung({
            kunde,
            url: d.url,
            rec,
            keyword: d.keyword,
            deadline: start + BUDGET_MS,
          });
          const fehlt = luecken(recommendation);
          if (fehlt.length) return fehler(`Empfehlung unvollständig (${fehlt.join(", ")})`);
          const generated_at = new Date().toISOString();
          await speichereCache(kunde.id, d.url, type, d.keyword, recommendation, generated_at);
          return Response.json(
            {
              ok: true,
              recommendation,
              generated_at,
              cached: false,
              meta: {
                dauer_ms: Date.now() - start,
                dataforseo_cost: cost.dataforseo,
                hinweise,
              },
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch (e) {
          return fehler(String((e as Error)?.message || e).slice(0, 200));
        }
      },
    },
  },
});
