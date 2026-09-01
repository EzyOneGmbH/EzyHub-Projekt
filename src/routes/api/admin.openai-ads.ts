import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireTeamRole } from "@/server/team-guard.server";
import { encryptSecret, decryptSecret } from "@/server/secretbox.server";
import { buildOpenAiEvent, sendConversionEvents } from "@/server/openai-ads.server";

// ChatGPT Ads (EzyAI Ads-Modus, 26.08.2026) — Dashboard- und Verwaltungs-Route.
// GET  ?client=<uuid>&start=YYYY-MM-DD&end=YYYY-MM-DD
//      -> { ok, configured, enabled, pixelId, totals, timeseries, events }
//      Auth: eingeloggter User (Kunden-Sichtbarkeit via RLS) oder Admin-Secret.
// POST { action: "config" | "retry" | "test" | "verify-pixel", ... }  — nur owner/admin:
//      verify-pixel: { clientId } — holt die Kunden-Website und prüft die
//              Pixel-Installation (SDK, Pixel-ID, page_viewed, Formular-Hook).
//      config: { clientId, pixelId, apiKey?, enabled } — apiKey leer = behalten;
//              der Key wird Secretbox-verschluesselt gespeichert, nie zurueckgegeben.
//      retry:  { clientId, eventId } — fehlgeschlagenes Event erneut senden.
//      test:   { clientId } — validate_only-Testevent gegen die OpenAI-API.
// Die Events-Tabellen sind service-role-only (RLS ohne Policies) — die Kunden-
// Sichtbarkeit prueft diese Route selbst (RLS-Probe auf clients).

async function requireUser(request: Request): Promise<{ userClient: any | null } | Response> {
  const admin = process.env.ADMIN_AUTOMATION_SECRET;
  const auth = request.headers.get("authorization") || "";
  if (admin && auth === `Bearer ${admin}`) return { userClient: null };
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anon)
    return Response.json({ ok: false, error: "Server not configured" }, { status: 503 });
  const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data } = await userClient.auth.getUser();
  if (!data.user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return { userClient };
}

const isDayStr = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export const Route = createFileRoute("/api/admin/openai-ads")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const u = new URL(request.url);
        const clientId = u.searchParams.get("client") || "";
        if (!/^[0-9a-f-]{36}$/i.test(clientId))
          return Response.json({ ok: false, error: "client (uuid) erforderlich" }, { status: 400 });
        // Kunden-Sichtbarkeit ueber die RLS des eingeloggten Users pruefen.
        const { data: client } = await (auth.userClient ?? (supabaseAdmin as any))
          .from("clients")
          .select("id, name")
          .eq("id", clientId)
          .maybeSingle();
        if (!client)
          return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });

        const sb = supabaseAdmin as any;
        const { data: cfg } = await sb
          .from("openai_ads_config")
          .select("pixel_id, enabled, updated_at")
          .eq("client_id", clientId)
          .maybeSingle();

        // Zeitraum (Default 30 Tage) — Events in [start, end].
        const qsStart = u.searchParams.get("start");
        const qsEnd = u.searchParams.get("end");
        const end = isDayStr(qsEnd) ? qsEnd : new Date().toISOString().slice(0, 10);
        const start = isDayStr(qsStart)
          ? qsStart
          : new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
        const since = new Date(`${start}T00:00:00`).toISOString();
        const until = new Date(new Date(`${end}T00:00:00`).getTime() + 864e5).toISOString();

        const { data: events } = await sb
          .from("openai_ads_events")
          .select(
            "id, event_id, event_type, oppref, obref, amount_cents, currency, source_url, action_source, openai_status, retry_count, created_at, sent_at",
          )
          .eq("client_id", clientId)
          .gte("created_at", since)
          .lt("created_at", until)
          .order("created_at", { ascending: false })
          .limit(500);

        const rows: any[] = events || [];
        const totals = {
          events: rows.length,
          sent: rows.filter((r) => r.openai_status === "sent").length,
          failed: rows.filter((r) => r.openai_status === "failed").length,
          withOppref: rows.filter((r) => r.oppref).length,
          leads: rows.filter((r) => /lead|signup|contact/i.test(r.event_type)).length,
          orders: rows.filter((r) => r.amount_cents != null).length,
          revenueCents: rows.reduce((a, r) => a + (r.amount_cents || 0), 0),
          currency: rows.find((r) => r.currency)?.currency || "CHF",
        };
        // Tages-Zeitreihe (YYYY-MM-DD -> Anzahl) fuer den Balken-Chart.
        const byDay: Record<string, number> = {};
        for (const r of rows) {
          const k = String(r.created_at).slice(0, 10);
          byDay[k] = (byDay[k] || 0) + 1;
        }

        return Response.json({
          ok: true,
          configured: !!cfg,
          enabled: !!cfg?.enabled,
          pixelId: cfg?.pixel_id || null,
          totals,
          byDay,
          events: rows.slice(0, 100),
        });
      },

      POST: async ({ request }) => {
        // Schreibende Aktionen: nur owner/admin der aktiven Organisation.
        const ctx = await requireTeamRole(request, "admin");
        if (ctx instanceof Response) return ctx;
        let body: any;
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, error: "Body ungültig" }, { status: 400 });
        }
        const action = String(body?.action || "");
        const clientId = String(body?.clientId || "");
        if (!/^[0-9a-f-]{36}$/i.test(clientId))
          return Response.json({ ok: false, error: "clientId ungültig" }, { status: 400 });
        // Cross-Tenant-Sperre: Kunde muss zur Organisation des Admins gehoeren.
        const sb = supabaseAdmin as any;
        const { data: own } = await sb
          .from("clients")
          .select("id, organization_id")
          .eq("id", clientId)
          .eq("organization_id", ctx.organizationId)
          .maybeSingle();
        if (!own)
          return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });

        if (action === "config") {
          const pixelId = String(body?.pixelId || "").trim();
          const apiKey = String(body?.apiKey || "").trim();
          const enabled = body?.enabled !== false;
          if (!pixelId)
            return Response.json({ ok: false, error: "pixelId erforderlich" }, { status: 400 });
          const { data: existing } = await sb
            .from("openai_ads_config")
            .select("api_key_enc")
            .eq("client_id", clientId)
            .maybeSingle();
          if (!apiKey && !existing)
            return Response.json({ ok: false, error: "apiKey erforderlich" }, { status: 400 });
          const api_key_enc = apiKey ? encryptSecret(apiKey) : existing.api_key_enc;
          const { error } = await sb.from("openai_ads_config").upsert(
            {
              client_id: clientId,
              organization_id: own.organization_id,
              pixel_id: pixelId,
              api_key_enc,
              enabled,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "client_id" },
          );
          if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
          return Response.json({ ok: true });
        }

        // Installations-Check (01.09., Volkan): holt die Kunden-Website und
        // prüft, ob das Pixel-Snippet korrekt eingebaut ist — Grundlage, damit
        // die Pixel-Verifikation im OpenAI Ads Manager abgehakt werden kann
        // (OpenAI verifiziert selbst, sobald live Events eingehen; dieser
        // Check bestätigt die Installation, die das auslöst). Kein API-Key
        // nötig. Achtung Einbau via Tag Manager: dort lädt das Snippet erst
        // zur Laufzeit — im HTML nicht sichtbar (Hinweis im UI).
        if (action === "verify-pixel") {
          const { data: vcfg } = await sb
            .from("openai_ads_config")
            .select("pixel_id")
            .eq("client_id", clientId)
            .maybeSingle();
          if (!vcfg?.pixel_id)
            return Response.json(
              { ok: false, error: "Noch keine Pixel-ID konfiguriert" },
              { status: 409 },
            );
          const { data: cl } = await sb
            .from("clients")
            .select("domain")
            .eq("id", clientId)
            .maybeSingle();
          const domain = String(cl?.domain || "")
            .replace(/^https?:\/\//, "")
            .replace(/\/.*$/, "")
            .trim();
          if (!domain)
            return Response.json(
              { ok: false, error: "Kunde hat keine Domain hinterlegt" },
              { status: 409 },
            );
          // Ein Versuch je Variante, nicht hämmern (Hoster-Rate-Limits).
          const tryUrls = domain.startsWith("www.")
            ? [`https://${domain}`]
            : [`https://${domain}`, `https://www.${domain}`];
          let html = "";
          let checkedUrl = "";
          let fetchErr = "";
          for (const u of tryUrls) {
            try {
              const r = await fetch(u, {
                headers: {
                  "User-Agent":
                    "Mozilla/5.0 (compatible; EzyHub-PixelCheck/1.0; +https://ezyhub.ch)",
                },
                signal: AbortSignal.timeout(15_000),
                redirect: "follow",
              });
              if (r.ok) {
                html = await r.text();
                checkedUrl = r.url || u;
                break;
              }
              fetchErr = `HTTP ${r.status}`;
            } catch (e: any) {
              fetchErr = String(e?.message || e);
            }
          }
          if (!html)
            return Response.json(
              { ok: false, error: `Website nicht abrufbar (${fetchErr})` },
              { status: 502 },
            );
          const checks = {
            sdkFound: html.includes("bzrcdn.openai.com/sdk/oaiq.min.js"),
            pixelIdFound: html.includes(String(vcfg.pixel_id)),
            pageViewed: /oaiq\(\s*["']measure["']\s*,\s*["']page_viewed["']/.test(html),
            formHook: html.includes("ezy_event_id"),
          };
          return Response.json({
            ok: true,
            checkedUrl,
            checks,
            passed: checks.sdkFound && checks.pixelIdFound,
          });
        }

        // retry/test brauchen die entschluesselte Config.
        const { data: cfg } = await sb
          .from("openai_ads_config")
          .select("pixel_id, api_key_enc, enabled")
          .eq("client_id", clientId)
          .maybeSingle();
        if (!cfg)
          return Response.json({ ok: false, error: "Noch nicht konfiguriert" }, { status: 409 });
        let apiKey: string;
        try {
          apiKey = decryptSecret(cfg.api_key_enc);
        } catch (e: any) {
          return Response.json(
            { ok: false, error: `Key nicht lesbar: ${String(e?.message || e)}` },
            { status: 500 },
          );
        }

        if (action === "test") {
          const res = await sendConversionEvents(
            cfg.pixel_id,
            apiKey,
            [
              {
                id: `test_${Date.now()}`,
                type: "lead_created",
                timestamp_ms: Date.now(),
                source_url: "https://www.ezyone.ch/test",
                action_source: "web",
                data: { type: "customer_action" },
              },
            ],
            true, // validate_only: prueft, ohne zu speichern
          );
          return Response.json({ ok: res.ok, status: res.status, response: res.response });
        }

        if (action === "retry") {
          const eventId = String(body?.eventId || "");
          if (!/^[0-9a-f-]{36}$/i.test(eventId))
            return Response.json({ ok: false, error: "eventId ungültig" }, { status: 400 });
          const { data: ev } = await sb
            .from("openai_ads_events")
            .select("*")
            .eq("id", eventId)
            .eq("client_id", clientId)
            .maybeSingle();
          if (!ev)
            return Response.json({ ok: false, error: "Event nicht gefunden" }, { status: 404 });
          const res = await sendConversionEvents(cfg.pixel_id, apiKey, [buildOpenAiEvent(ev)]);
          await sb
            .from("openai_ads_events")
            .update({
              openai_status: res.ok ? "sent" : "failed",
              openai_response: res.response ?? null,
              retry_count: (ev.retry_count || 0) + 1,
              sent_at: res.ok ? new Date().toISOString() : ev.sent_at,
            })
            .eq("id", eventId);
          return Response.json({ ok: res.ok, status: res.status, response: res.response });
        }

        return Response.json({ ok: false, error: `Unbekannte action: ${action}` }, { status: 400 });
      },
    },
  },
});
