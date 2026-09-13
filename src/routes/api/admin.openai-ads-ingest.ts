import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptSecret } from "@/server/secretbox.server";
import { buildOpenAiEvent, sendConversionEvents } from "@/server/openai-ads.server";
import { authenticateIngest, ladeScopedClient } from "@/server/ingest-auth.server";
import {
  AdsIngestBodySchema,
  MAX_BODY_BYTES_ADS,
  leseJsonBegrenzt,
  zodFehlerText,
} from "@/server/ingest-schemas.server";

// ChatGPT Ads — Conversion-Ingest (26.08.2026; mandantenfest seit 13.09.2026).
// Nimmt Conversions von Kunden-CRMs/Websites (Server-zu-Server) entgegen,
// speichert sie lokal und leitet sie an die OpenAI Conversions API weiter.
//
// Auth: Bearer <kundenspezifisches Ingest-Token, purpose openai_ads> —
// erzeugt im Admin (POST /api/admin/ingest-credentials). Der Kunde ergibt
// sich AUS DEM TOKEN; clientId/domain im Body duerfen nur dazu passen (sonst
// 403) und koennen nichts erweitern. ADMIN_AUTOMATION_SECRET = interner
// Administrationspfad (dann clientId oder domain noetig). Die frueheren
// globalen Secrets (OPENAI_ADS_INGEST_SECRET) werden NICHT mehr akzeptiert.
//
// Body (strikt, Zod): { clientId?, domain?, event: { id?, type, oppref?,
//   obref?, amount_cents?, currency?, source_url?, action_source?, user?,
//   data?, contents? } } — max. 32 KB, application/json.
// Deduplication: (client_id, event_id) unique — gleiche event.id ist
// idempotent ({ ok: true, dedup: true }). Ohne event.id wird eine zufaellige
// ID erzeugt, d. h. Wiederholungen ohne ID sind NICHT deduplizierbar — CRMs
// sollen ihre eigene stabile ID mitgeben.

export const Route = createFileRoute("/api/admin/openai-ads-ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateIngest(request, "openai_ads");
        if (!auth.ok) return auth.response;

        const gelesen = await leseJsonBegrenzt(request, MAX_BODY_BYTES_ADS);
        if (!gelesen.ok)
          return Response.json({ ok: false, error: gelesen.error }, { status: gelesen.status });
        const parsed = AdsIngestBodySchema.safeParse(gelesen.body);
        if (!parsed.success)
          return Response.json(
            { ok: false, error: `Ungueltige Eingabe: ${zodFehlerText(parsed.error)}` },
            { status: 400 },
          );
        const { clientId, domain, event: ev } = parsed.data;

        const kunde = await ladeScopedClient(auth.scope, { clientId, domain });
        if (!kunde.ok) return kunde.response;
        const client = kunde.client;

        const sb = supabaseAdmin as any;
        const { data: cfg } = await sb
          .from("openai_ads_config")
          .select("pixel_id, api_key_enc, enabled")
          .eq("client_id", client.id)
          .maybeSingle();
        if (!cfg || !cfg.enabled)
          return Response.json(
            { ok: false, error: "ChatGPT Ads für diesen Kunden nicht konfiguriert/aktiv" },
            { status: 409 },
          );

        // payload: nur validierte Zusatzfelder (user = ausschliesslich gehashte
        // bzw. grobe Felder; buildOpenAiEvent filtert beim Senden nochmals).
        const payload: Record<string, unknown> = {};
        if (ev.user && Object.keys(ev.user).length) payload.user = ev.user;
        if (ev.data && Object.keys(ev.data).length) payload.data = ev.data;
        if (ev.contents?.length) payload.contents = ev.contents;

        const row = {
          organization_id: client.organization_id,
          client_id: client.id,
          event_id: ev.id ?? `evt_${crypto.randomUUID()}`,
          event_type: ev.type,
          oppref: ev.oppref ?? null,
          obref: ev.obref ?? null,
          amount_cents: ev.amount_cents ?? null,
          currency: ev.currency ?? null,
          source_url: ev.source_url ?? null,
          action_source: ev.action_source,
          payload: Object.keys(payload).length ? payload : null,
        };

        const { data: inserted, error } = await sb
          .from("openai_ads_events")
          .insert(row)
          .select("id, created_at")
          .maybeSingle();
        if (error) {
          // Unique-Verletzung = Doppel-Einlieferung -> idempotent, kein Fehler.
          if (String(error.code) === "23505")
            return Response.json({ ok: true, dedup: true, eventId: row.event_id });
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }

        // Direkt an OpenAI weiterleiten; Fehler blockieren die Einlieferung
        // nicht (Event bleibt als "failed" sichtbar und ist per Retry sendbar).
        let openaiOk = false;
        let openaiResponse: unknown = null;
        try {
          const apiKey = decryptSecret(cfg.api_key_enc);
          const res = await sendConversionEvents(cfg.pixel_id, apiKey, [
            buildOpenAiEvent({ ...row, created_at: inserted.created_at } as any),
          ]);
          openaiOk = res.ok;
          openaiResponse = res.response;
        } catch (e: any) {
          openaiResponse = { error: String(e?.message || e).slice(0, 500) };
        }
        await sb
          .from("openai_ads_events")
          .update({
            openai_status: openaiOk ? "sent" : "failed",
            openai_response: openaiResponse ?? null,
            sent_at: openaiOk ? new Date().toISOString() : null,
          })
          .eq("id", inserted.id);

        return Response.json({ ok: true, eventId: row.event_id, forwarded: openaiOk });
      },
    },
  },
});
