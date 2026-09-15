import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireTeamRole } from "@/server/team-guard.server";
import { encryptSecret, decryptSecret } from "@/server/secretbox.server";
import { buildOpenAiEvent, sendConversionEvents } from "@/server/openai-ads.server";
import { zeitraumAusParams } from "@/lib/date-range";

// ChatGPT Ads (EzyAI Ads-Modus, 26.08.2026) — Dashboard- und Verwaltungs-Route.
// GET  ?client=<uuid>&start=YYYY-MM-DD&end=YYYY-MM-DD
//      -> { ok, configured, enabled, pixelId, totals, timeseries, events }
//      Auth: eingeloggter User (Kunden-Sichtbarkeit via RLS) oder Admin-Secret.
// POST { action: "config" | "retry" | "test" | "verify-pixel", ... }  — nur owner/admin:
//      readiness / verify-pixel: { clientId, url? } — holt die Kunden-Website
//              und prüft sie gegen developers.openai.com/ads/measurement-pixel:
//              HTTPS, SDK im <head>, init, Pixel-ID (Soll/Ist), page_viewed,
//              Conversion-Events, event_id-Dedup, CSP-Freigaben fuer
//              bzrcdn/bzr.openai.com, Consent-Tool, Tag-Manager, debug-Flag.
//              Antwort: { items[], score, checkedUrl, foundPixels } — `checks`
//              bleibt fuer die alte Snippet-Karte erhalten. url? prueft eine
//              einzelne Seite statt der Startseite.
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

        // Zeitraum (13.09.2026, Vereinheitlichung): exakt + inklusiv, Default
        // 30 Tage; ungueltig/verdreht/Zukunft/zu lang → 400 statt Naeherung.
        let zr;
        try {
          zr = zeitraumAusParams(u.searchParams, { defaultDays: 30, maxDays: 366 });
        } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 400 },
          );
        }
        const { startDate: start, endDate: end } = zr;
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
          range: { from: zr.startDate, to: zr.endDate, days: zr.days },
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
        // Technik-Check (15.09.): prueft die Kunden-Website gegen die
        // Anforderungen aus developers.openai.com/ads/measurement-pixel —
        // Erreichbarkeit, SDK, Pixel-ID, page_viewed, Dedup, CSP, Consent.
        // "verify-pixel" ist der alte Name und liefert weiterhin `checks`.
        if (action === "verify-pixel" || action === "readiness") {
          const { data: vcfg } = await sb
            .from("openai_ads_config")
            .select("pixel_id")
            .eq("client_id", clientId)
            .maybeSingle();
          const wantPixel = String(vcfg?.pixel_id || "");
          const { data: cl } = await sb
            .from("clients")
            .select("domain")
            .eq("id", clientId)
            .maybeSingle();
          // Optionale Einzelseite pruefen (z.B. das Kontaktformular), sonst Startseite.
          const override = String(body?.url || "").trim();
          const domain = String(cl?.domain || "")
            .replace(/^https?:\/\//, "")
            .replace(/\/.*$/, "")
            .trim();
          if (!override && !domain)
            return Response.json(
              { ok: false, error: "Kunde hat keine Domain hinterlegt" },
              { status: 409 },
            );
          if (override && !/^https?:\/\/[^\s]+$/i.test(override))
            return Response.json(
              { ok: false, error: "URL muss mit http:// oder https:// beginnen" },
              { status: 400 },
            );
          // Ein Versuch je Variante, nicht haemmern (Hoster-Rate-Limits).
          const tryUrls = override
            ? [override]
            : domain.startsWith("www.")
              ? [`https://${domain}`]
              : [`https://${domain}`, `https://www.${domain}`];
          let html = "";
          let checkedUrl = "";
          let httpStatus = 0;
          let headers: Headers | null = null;
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
                httpStatus = r.status;
                headers = r.headers;
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

          // --- Auswertung des ausgelieferten HTML -------------------------
          const headEnd = html.search(/<\/head>/i);
          const sdkIdx = html.indexOf("bzrcdn.openai.com/sdk/oaiq.min.js");
          const initRe = /oaiq\(\s*["']init["']\s*,\s*\{([\s\S]{0,400}?)\}\s*\)/g;
          const inits: string[] = [];
          for (let m = initRe.exec(html); m; m = initRe.exec(html)) inits.push(m[1]);
          const pixelIdRe = /pixelId\s*:\s*["']([^"']+)["']/g;
          const foundPixels: string[] = [];
          for (let m = pixelIdRe.exec(html); m; m = pixelIdRe.exec(html)) {
            if (!foundPixels.includes(m[1])) foundPixels.push(m[1]);
          }
          const measureRe =
            /oaiq\(\s*["']measure["']\s*,\s*["']([a-z0-9_]+)["']([\s\S]{0,300}?)\)/g;
          const measured: string[] = [];
          let hasEventId = false;
          for (let m = measureRe.exec(html); m; m = measureRe.exec(html)) {
            if (!measured.includes(m[1])) measured.push(m[1]);
            if (/event_id/.test(m[2])) hasEventId = true;
          }
          const customRe = /custom_event_name\s*:\s*["']([^"']+)["']/g;
          const customEvents: string[] = [];
          for (let m = customRe.exec(html); m; m = customRe.exec(html)) {
            if (!customEvents.includes(m[1])) customEvents.push(m[1]);
          }

          // CSP kann als Header oder als <meta http-equiv> kommen.
          const cspHeader = headers?.get("content-security-policy") || "";
          const cspMeta = (html.match(
            /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]+content=["']([^"']+)["']/i,
          ) || [])[1];
          const csp = cspHeader || cspMeta || "";
          const cspAllows = (directive: string, host: string): boolean => {
            if (!csp) return true;
            const parts = csp
              .split(";")
              .map((p) => p.trim())
              .filter(Boolean);
            const find = (name: string) =>
              parts.find((p) => p.toLowerCase().startsWith(name + " ") || p.toLowerCase() === name);
            const d = find(directive) || find("default-src");
            if (!d) return true; // keine passende Direktive = nicht eingeschraenkt
            const values = d.split(/\s+/).slice(1);
            return values.some(
              (v) =>
                v === "*" ||
                v === "https:" ||
                v.replace(/\/$/, "") === host ||
                (v.startsWith("*.") && host.endsWith(v.slice(1))),
            );
          };

          // Consent-Tools und Tag-Manager erkennen (beides macht den Pixel im
          // Roh-HTML unsichtbar bzw. blockiert ihn bis zur Einwilligung).
          const cmpNames: Array<[string, RegExp]> = [
            ["Cookiebot", /cookiebot/i],
            ["OneTrust", /onetrust|otSDKStub/i],
            ["Usercentrics", /usercentrics/i],
            ["Borlabs Cookie", /borlabs-cookie/i],
            ["Complianz", /complianz|cmplz/i],
            ["CookieYes", /cookieyes|cookie-law-info/i],
            ["Klaro", /klaro/i],
            ["Iubenda", /iubenda/i],
          ];
          const cmp = cmpNames.filter(([, re]) => re.test(html)).map(([n]) => n);
          const gtm = /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/.test(html);

          type Item = {
            id: string;
            label: string;
            status: "ok" | "warn" | "fail" | "info";
            detail: string;
            hint?: string;
          };
          const items: Item[] = [];
          const push = (i: Item) => items.push(i);

          push({
            id: "https",
            label: "Website über HTTPS erreichbar",
            status: checkedUrl.startsWith("https://") ? "ok" : "fail",
            detail: `${checkedUrl} — HTTP ${httpStatus}`,
            hint: checkedUrl.startsWith("https://")
              ? undefined
              : "Das SDK und die Event-Endpunkte laufen nur über HTTPS. Zertifikat einrichten und http auf https umleiten.",
          });

          const sdkStatus: Item["status"] =
            sdkIdx >= 0 ? "ok" : gtm || cmp.length ? "warn" : "fail";
          push({
            id: "sdk",
            label: "Pixel-SDK eingebunden",
            status: sdkStatus,
            detail:
              sdkIdx >= 0
                ? "Loader-Script bzrcdn.openai.com/sdk/oaiq.min.js gefunden"
                : gtm || cmp.length
                  ? `Im ausgelieferten HTML nicht gefunden — ${[gtm ? "Google Tag Manager" : "", ...cmp].filter(Boolean).join(", ")} erkannt, der Pixel wird evtl. erst im Browser nachgeladen`
                  : "Loader-Script nicht gefunden",
            hint:
              sdkIdx >= 0
                ? undefined
                : "Das Snippet aus der Karte «Website-Snippet» einmal im <head> einbauen. Läuft es über einen Tag-Manager, zeigt der Live-Check, ob Events wirklich ankommen.",
          });

          if (sdkIdx >= 0) {
            const inHead = headEnd > 0 && sdkIdx < headEnd;
            push({
              id: "head",
              label: "Snippet steht im <head>",
              status: inHead ? "ok" : "warn",
              detail: inHead ? "Snippet wird vor </head> geladen" : "Snippet steht erst im <body>",
              hint: inHead
                ? undefined
                : "Möglichst weit oben im <head> einbauen, sonst gehen frühe Conversions verloren.",
            });
          }

          push({
            id: "init",
            label: "Pixel initialisiert",
            status: inits.length > 0 ? "ok" : sdkIdx >= 0 ? "fail" : "warn",
            detail:
              inits.length > 0
                ? `oaiq("init", …) ${inits.length}×`
                : 'Kein oaiq("init", …)-Aufruf im HTML',
            hint:
              inits.length > 0 ? undefined : 'Ohne oaiq("init", { pixelId }) misst das SDK nichts.',
          });

          const pixelMatch = !!wantPixel && foundPixels.includes(wantPixel);
          let pixelStatus: Item["status"] = "warn";
          if (wantPixel)
            pixelStatus = pixelMatch ? "ok" : foundPixels.length || sdkIdx >= 0 ? "fail" : "warn";
          push({
            id: "pixelId",
            label: "Pixel-ID stimmt mit EzyHub überein",
            status: pixelStatus,
            detail: !wantPixel
              ? "In EzyHub ist noch keine Pixel-ID hinterlegt" +
                (foundPixels.length ? ` — auf der Website läuft: ${foundPixels.join(", ")}` : "")
              : pixelMatch
                ? wantPixel
                : foundPixels.length
                  ? `Website nutzt ${foundPixels.join(", ")} statt ${wantPixel}`
                  : "Keine Pixel-ID im HTML gefunden",
            hint: !wantPixel
              ? "Pixel-ID unter Einstellungen hinterlegen oder dort ein Pixel anlegen."
              : pixelMatch
                ? undefined
                : "Auf der Website muss dieselbe Pixel-ID stehen, sonst laufen die Conversions in ein fremdes Pixel.",
          });

          if (foundPixels.length > 1)
            push({
              id: "multiplePixels",
              label: "Mehrere Pixel auf der Seite",
              status: "warn",
              detail: foundPixels.join(", "),
              hint: "Mehrere Pixel sind erlaubt, jedes Event geht dann aber an alle. Nur behalten, was gebraucht wird.",
            });

          const pv = measured.includes("page_viewed");
          push({
            id: "pageViewed",
            label: "Seitenaufruf wird gemessen",
            status: pv ? "ok" : sdkIdx >= 0 ? "fail" : "warn",
            detail: pv
              ? 'oaiq("measure", "page_viewed") gefunden'
              : "Kein page_viewed-Aufruf im HTML",
            hint: pv
              ? undefined
              : "Das SDK sendet keinen automatischen Seitenaufruf — page_viewed muss explizit gemessen werden.",
          });

          const convEvents = measured.filter((e) => e !== "page_viewed");
          push({
            id: "conversions",
            label: "Conversion-Events gemessen",
            status: convEvents.length ? "ok" : "warn",
            detail: convEvents.length
              ? convEvents.join(", ") +
                (customEvents.length ? ` (custom: ${customEvents.join(", ")})` : "")
              : "Nur Seitenaufrufe — kein Lead, Kauf oder Termin wird gemeldet",
            hint: convEvents.length
              ? undefined
              : "Ohne Conversion-Event optimiert die Kampagne blind. Mindestens lead_created beim Formular messen.",
          });

          const formHook = html.includes("ezy_event_id");
          push({
            id: "dedup",
            label: "Deduplizierung Browser ↔ Server",
            status: hasEventId ? "ok" : convEvents.length ? "warn" : "info",
            detail: hasEventId
              ? "event_id wird mitgegeben" + (formHook ? " (Ezy-Formular-Hook aktiv)" : "")
              : convEvents.length
                ? "Conversion-Events ohne event_id"
                : "Noch keine Conversion-Events vorhanden",
            hint: hasEventId
              ? undefined
              : "Wird dasselbe Event zusätzlich serverseitig gemeldet, zählt OpenAI es doppelt. Gleiche event_id in Browser und Server verwenden.",
          });

          const cspChecks: Array<[string, string]> = [
            ["script-src", "https://bzrcdn.openai.com"],
            ["connect-src", "https://bzr.openai.com"],
            ["connect-src", "https://bzrcdn.openai.com"],
            ["img-src", "https://bzr.openai.com"],
          ];
          const cspMissing = cspChecks.filter(([d, h]) => !cspAllows(d, h));
          push({
            id: "csp",
            label: "Content-Security-Policy erlaubt die OpenAI-Domains",
            status: !csp ? "info" : cspMissing.length ? "fail" : "ok",
            detail: !csp
              ? "Keine Content-Security-Policy gesetzt — nichts zu tun"
              : cspMissing.length
                ? "Blockiert: " + cspMissing.map(([d, h]) => `${d} ${h}`).join(", ")
                : `Alle vier Direktiven erlaubt (Quelle: ${cspHeader ? "HTTP-Header" : "<meta>"})`,
            hint: cspMissing.length
              ? "Ergänzen: script-src https://bzrcdn.openai.com; connect-src https://bzr.openai.com https://bzrcdn.openai.com; img-src https://bzr.openai.com"
              : undefined,
          });

          const hasConsentCall = /oaiq\(\s*["']consent["']/.test(html);
          push({
            id: "consent",
            label: "Einwilligung / Cookie-Banner",
            status: cmp.length && !hasConsentCall ? "warn" : cmp.length ? "ok" : "info",
            detail: cmp.length
              ? `${cmp.join(", ")} erkannt` +
                (hasConsentCall
                  ? ' — oaiq("consent", …) wird gesetzt'
                  : " — kein consent-Aufruf im HTML")
              : "Kein Consent-Tool erkannt",
            hint:
              cmp.length && !hasConsentCall
                ? 'Der Pixel misst standardmässig sofort. Soll das Banner ihn steuern: oaiq("consent", false) vor dem init, nach Zustimmung oaiq("consent", true).'
                : undefined,
          });

          if (gtm)
            push({
              id: "gtm",
              label: "Google Tag Manager erkannt",
              status: "info",
              detail:
                "Der Pixel kann über den Tag-Manager laufen und ist dann im Roh-HTML unsichtbar",
              hint: "Dann zählt der Live-Check: Kommen bei OpenAI Events an, ist der Einbau in Ordnung.",
            });

          if (inits.some((i) => /debug\s*:\s*true/.test(i)))
            push({
              id: "debug",
              label: "Debug-Modus aktiv",
              status: "warn",
              detail: "init enthält debug: true",
              hint: "Auf der Live-Website abschalten — der Modus schreibt in die Browser-Konsole.",
            });

          const checks = {
            sdkFound: sdkIdx >= 0,
            pixelIdFound: !!wantPixel && html.includes(wantPixel),
            pageViewed: pv,
            formHook,
          };
          const score = {
            ok: items.filter((i) => i.status === "ok").length,
            warn: items.filter((i) => i.status === "warn").length,
            fail: items.filter((i) => i.status === "fail").length,
          };
          return Response.json({
            ok: true,
            checkedUrl,
            pixelId: wantPixel || null,
            foundPixels,
            items,
            score,
            checks,
            passed: score.fail === 0,
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
