import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptSecret } from "@/server/secretbox.server";
import { buildOpenAiEvent, sendConversionEvents } from "@/server/openai-ads.server";

// ChatGPT Ads — Conversion-Ingest (26.08.2026, Muster ai-crawler-ingest).
// Nimmt Conversions von Kunden-Websites/CRM entgegen, speichert sie lokal
// (eigenes Reporting) und leitet sie an die OpenAI Conversions API weiter.
// Auth: Bearer OPENAI_ADS_INGEST_SECRET (liegt in den Website-Snippets —
// bewusst NICHT das Admin-Secret) oder ADMIN_AUTOMATION_SECRET.
// Body: {
//   domain: "kunde.ch" ODER clientId: "<uuid>",
//   event: { id?, type, oppref?, obref?, amount_cents?, currency?,
//            source_url?, action_source?, user?, data?, contents? }
// }
// Deduplication: (client_id, event_id) unique — Doppel-Einlieferungen sind ok
// und werden als { ok: true, dedup: true } beantwortet.

export const Route = createFileRoute("/api/admin/openai-ads-ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") || "";
        const ingest = process.env.OPENAI_ADS_INGEST_SECRET;
        const admin = process.env.ADMIN_AUTOMATION_SECRET;
        const okAuth =
          (ingest && auth === `Bearer ${ingest}`) || (admin && auth === `Bearer ${admin}`);
        if (!okAuth) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        let body: any;
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, error: "Body ungültig" }, { status: 400 });
        }
        const ev = body?.event;
        if (!ev || typeof ev !== "object" || !ev.type)
          return Response.json({ ok: false, error: "event.type erforderlich" }, { status: 400 });

        // Kunde aufloesen: clientId direkt oder Domain-Match (wie Crawler-Ingest).
        const sb = supabaseAdmin as any;
        let client: any = null;
        if (/^[0-9a-f-]{36}$/i.test(String(body?.clientId || ""))) {
          const { data } = await sb
            .from("clients")
            .select("id, organization_id")
            .eq("id", body.clientId)
            .maybeSingle();
          client = data;
        } else if (body?.domain) {
          const domain = String(body.domain)
            .toLowerCase()
            .replace(/^https?:\/\//, "")
            .replace(/^www\./, "")
            .replace(/\/.*$/, "");
          const { data: clients } = await sb.from("clients").select("id, organization_id, domain");
          client = (clients || []).find((c: any) => {
            const d = String(c.domain || "")
              .toLowerCase()
              .replace(/^https?:\/\//, "")
              .replace(/^www\./, "")
              .replace(/\/.*$/, "");
            return d && (d === domain || domain.endsWith("." + d) || d.endsWith("." + domain));
          });
        }
        if (!client)
          return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });

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

        // payload: nur definierte Zusatzfelder aufbewahren (user nur gehashte
        // Felder — buildOpenAiEvent filtert beim Senden nochmals).
        const payload: Record<string, unknown> = {};
        if (ev.user && typeof ev.user === "object") payload.user = ev.user;
        if (ev.data && typeof ev.data === "object") payload.data = ev.data;
        if (Array.isArray(ev.contents)) payload.contents = ev.contents.slice(0, 50);

        const row = {
          organization_id: client.organization_id,
          client_id: client.id,
          event_id: String(ev.id || `evt_${crypto.randomUUID()}`).slice(0, 120),
          event_type: String(ev.type).slice(0, 60),
          oppref: ev.oppref ? String(ev.oppref).slice(0, 500) : null,
          obref: ev.obref ? String(ev.obref).slice(0, 120) : null,
          amount_cents: Number.isFinite(Number(ev.amount_cents)) ? Number(ev.amount_cents) : null,
          currency: ev.currency ? String(ev.currency).slice(0, 8).toUpperCase() : null,
          source_url: ev.source_url ? String(ev.source_url).slice(0, 500) : null,
          action_source: String(ev.action_source || "web").slice(0, 20),
          payload: Object.keys(payload).length ? payload : null,
        };

        const { data: inserted, error } = await sb
          .from("openai_ads_events")
          .insert(row)
          .select("id, created_at")
          .maybeSingle();
        if (error) {
          // Unique-Verletzung = Doppel-Einlieferung -> Dedup, kein Fehler.
          if (String(error.code) === "23505") return Response.json({ ok: true, dedup: true });
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
