import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authenticateIngest, ladeScopedClient } from "@/server/ingest-auth.server";
import {
  CrawlerIngestBodySchema,
  MAX_BODY_BYTES_CRAWLER,
  hitHash,
  hitZeitpunkt,
  leseJsonBegrenzt,
  zodFehlerText,
} from "@/server/ingest-schemas.server";

// AI-Crawler-Analytics light (Searchable-Nachbau ⑤, 2026-08-03; mandantenfest
// seit 13.09.2026). Nimmt Bot-Hits von Kunden-Websites (Server-Snippet/
// WordPress) entgegen und schreibt sie in ai_crawler_hits.
//
// Auth: Bearer <kundenspezifisches Ingest-Token, purpose ai_crawler> —
// erzeugt im Admin (POST /api/admin/ingest-credentials). Der Kunde ergibt
// sich AUS DEM TOKEN; clientId/domain im Body duerfen nur dazu passen (sonst
// 403). ADMIN_AUTOMATION_SECRET = interner Pfad (dann clientId/domain noetig).
// Das fruehere globale CRAWLER_INGEST_SECRET wird NICHT mehr akzeptiert.
//
// Body (strikt, Zod): { clientId?, domain?, hits: [{ bot, url, status?, at? }] }
//   — 1..500 Hits, nur bekannte Bots, max. 256 KB. Zeitstempel max. 30 Tage
//   alt / 5 Min. Zukunft, sonst verworfen.
// Replay-Schutz: hit_hash = sha256(client|bot|url|at-Sekunde), unique —
// dieselben Hits nochmals eingeliefert = { inserted: 0, dedup: n }.

export const Route = createFileRoute("/api/admin/ai-crawler-ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateIngest(request, "ai_crawler");
        if (!auth.ok) return auth.response;

        const gelesen = await leseJsonBegrenzt(request, MAX_BODY_BYTES_CRAWLER);
        if (!gelesen.ok)
          return Response.json({ ok: false, error: gelesen.error }, { status: gelesen.status });
        const parsed = CrawlerIngestBodySchema.safeParse(gelesen.body);
        if (!parsed.success)
          return Response.json(
            { ok: false, error: `Ungueltige Eingabe: ${zodFehlerText(parsed.error)}` },
            { status: 400 },
          );
        const { clientId, domain, hits } = parsed.data;

        const kunde = await ladeScopedClient(auth.scope, { clientId, domain });
        if (!kunde.ok) return kunde.response;
        const client = kunde.client;

        // Zeilen bauen; Zeitfenster pruefen; innerhalb des Batches deduplizieren.
        const now = Date.now();
        const rowsByHash = new Map<string, Record<string, unknown>>();
        let verworfen = 0;
        for (const h of hits) {
          const at = hitZeitpunkt(h.at, now);
          if (!at) {
            verworfen++;
            continue;
          }
          const hash = hitHash(client.id, h.bot, h.url, at);
          if (rowsByHash.has(hash)) continue;
          rowsByHash.set(hash, {
            organization_id: client.organization_id,
            client_id: client.id,
            bot: h.bot,
            url: h.url,
            status: h.status ?? null,
            at,
            hit_hash: hash,
          });
        }
        const rows = [...rowsByHash.values()];
        if (!rows.length)
          return Response.json({
            ok: true,
            received: hits.length,
            inserted: 0,
            dedup: 0,
            verworfen,
          });

        // Unique auf hit_hash: bereits vorhandene Hits werden ignoriert
        // (idempotente Wiederholung), nur neue Zeilen kommen zurueck.
        const sb = supabaseAdmin as any;
        const { data: inserted, error } = await sb
          .from("ai_crawler_hits")
          .upsert(rows, { onConflict: "hit_hash", ignoreDuplicates: true })
          .select("id");
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        const n = Array.isArray(inserted) ? inserted.length : 0;
        return Response.json({
          ok: true,
          received: hits.length,
          inserted: n,
          dedup: rows.length - n,
          verworfen,
        });
      },
    },
  },
});
