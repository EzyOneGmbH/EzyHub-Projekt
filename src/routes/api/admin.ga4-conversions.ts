import { createFileRoute } from "@tanstack/react-router";
import { zeitraum, ga4DateRange } from "@/lib/date-range";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken, getGoogleAccessTokenForScope } from "@/server/google-tokens.server";
import { ga4CoverageSammler, ga4RunReportUrl } from "@/server/ga4.server";

// GA4-Conversions je Kunde für den Admin-Bereich (05.08.2026).
//
// GET  ?client=<uuid>  → Key-Events der verbundenen GA4-Property (Admin API)
//                        + 30-Tage-Zählung und GA4-eigene Werte (Data API)
//                        + hinterlegte manuelle Werte (client_conversion_values)
//                        + Setup-Erkennung (dl_value-Custom-Dimension vorhanden?)
// POST {client, values:[{event, value, currency}]} → Werte hinterlegen;
//                        value <= 0 löscht den Eintrag wieder.
// POST {client, conversionEvents:[{event, on}]} → «Zaehlt als Conversion»
//                        (client_conversion_events): Ereignis zaehlt in der
//                        KI-Attribution mit eventCount statt keyEvents — auch
//                        RUECKWIRKEND (23.09.2026). GET liefert dafuer auch
//                        Roh-Ereignisse (eventCount, ohne Grundrauschen) mit.
// POST {client, keyEvent:{event, countingMethod?}} → Event in GA4 als Key Event
//                        markieren (Admin API keyEvents.create; 23.09.2026).
//                        Braucht analytics.edit — siehe getGoogleAccessTokenForScope.
//                        Zusaetzlich mit Bearer ADMIN_AUTOMATION_SECRET nutzbar.
//
// Die manuellen Werte wirken in der Attribution als letzte Stufe der
// Betrags-Kaskade (dl_value > totalRevenue > eventValue > manuell) — damit
// bekommen auch Nicht-E-Commerce-Kunden (Formular-Conversions) Beträge,
// ohne dass im GA4 des Kunden etwas umgebaut werden muss.
//
// Auth: eingeloggter EzyHub-User; welche Kunden er sehen darf, entscheidet
// die RLS des User-Clients (can_access_client). Schreibzugriff läuft danach
// über supabaseAdmin (Tabelle hat RLS ohne Policies = nur service_role).

async function requireUser(request: Request): Promise<{ userClient: any } | Response> {
  const admin = process.env.ADMIN_AUTOMATION_SECRET;
  const auth = request.headers.get("authorization") || "";
  // Automations-Secret → Kundensuche ueber supabaseAdmin (userClient = null).
  if (admin && auth === `Bearer ${admin}`) return { userClient: null };
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anon)
    return Response.json({ ok: false, error: "Server not configured" }, { status: 503 });
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
  });
  const { data } = await userClient.auth.getUser();
  if (!data.user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return { userClient };
}

// RLS-gefilterte Sicht: liefert den Kunden nur, wenn der User ihn sehen darf.
async function visibleClient(userClient: any, clientId: string) {
  const { data } = await userClient
    .from("clients")
    .select("id, name, ga4_property")
    .eq("id", clientId)
    .maybeSingle();
  return data ?? null;
}

// GA4-Grundrauschen, das nie eine Conversion ist — bleibt aus der Auswahl.
const NOISE_EVENTS = new Set([
  "page_view",
  "scroll",
  "session_start",
  "first_visit",
  "user_engagement",
  "view_search_results",
  "video_start",
  "video_progress",
  "video_complete",
  "form_start",
  "click",
  "(not set)",
]);

const KeyEventBody = z.object({
  client: z.string().uuid(),
  keyEvent: z.object({
    event: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/, "GA4-Eventname: Buchstaben/Ziffern/_ , max. 40"),
    countingMethod: z.enum(["ONCE_PER_EVENT", "ONCE_PER_SESSION"]).default("ONCE_PER_EVENT"),
  }),
});

const PostBody = z.object({
  client: z.string().uuid(),
  values: z
    .array(
      z.object({
        event: z.string().min(1).max(200),
        value: z.number().min(0).max(10_000_000),
        currency: z
          .string()
          .regex(/^[A-Z]{3}$/)
          .default("CHF"),
      }),
    )
    .max(100)
    .default([]),
  conversionEvents: z
    .array(z.object({ event: z.string().min(1).max(200), on: z.boolean() }))
    .max(100)
    .default([]),
});

export const Route = createFileRoute("/api/admin/ga4-conversions")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const clientId = new URL(request.url).searchParams.get("client") || "";
        if (!/^[0-9a-f-]{36}$/i.test(clientId))
          return Response.json({ ok: false, error: "client (uuid) erforderlich" }, { status: 400 });
        const client = await visibleClient(auth.userClient ?? (supabaseAdmin as any), clientId);
        if (!client)
          return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });

        // Hinterlegte Werte immer liefern — auch ohne GA4-Verbindung sichtbar.
        const { data: manualRows } = await (supabaseAdmin as any)
          .from("client_conversion_values")
          .select("event_name, value, currency")
          .eq("client_id", clientId);
        const manual = new Map<string, { value: number; currency: string }>(
          (manualRows ?? []).map((m: any) => [
            String(m.event_name),
            { value: Number(m.value), currency: String(m.currency || "CHF") },
          ]),
        );

        const { data: countedRows } = await (supabaseAdmin as any)
          .from("client_conversion_events")
          .select("event_name")
          .eq("client_id", clientId);
        const counted = new Set<string>((countedRows ?? []).map((x: any) => String(x.event_name)));

        if (!client.ga4_property)
          return Response.json({
            ok: true,
            ga4: false,
            events: [...new Set([...manual.keys(), ...counted])].map((name) => ({
              name,
              isKeyEvent: false,
              countsAsConversion: counted.has(name),
              count30d: 0,
              ga4Value: 0,
              manualValue: manual.get(name)?.value ?? 0,
              currency: manual.get(name)?.currency || "CHF",
            })),
            setup: { dlValue: false },
          });

        let token: string;
        try {
          token = (await getGoogleAccessToken(clientId)).accessToken;
        } catch (e) {
          return Response.json(
            { ok: false, error: "Google-Token: " + String((e as any)?.message || e).slice(0, 160) },
            { status: 502 },
          );
        }
        const propertyId = String(client.ga4_property).replace(/^properties\//, "");
        const gaFetch = (url: string, init?: RequestInit) =>
          fetch(url, {
            ...init,
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              ...(init?.headers || {}),
            },
            signal: AbortSignal.timeout(20_000),
          });

        // 1) Key-Events (die in GA4 als Conversion markierten Events) inkl.
        //    dort hinterlegtem Standardwert. 2) 30-Tage-Report je Event.
        //    3) Custom-Dimension-Erkennung (Buchungs-Setup dl_value).
        //    4) Roh-Ereignisse (eventCount) — Auswahl fuer «Zaehlt als Conversion».
        const [keyRes, repRes, dimRes, cntRes] = await Promise.all([
          gaFetch(
            `https://analyticsadmin.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}/keyEvents?pageSize=200`,
          ),
          gaFetch(ga4RunReportUrl(propertyId), {
            method: "POST",
            body: JSON.stringify({
              dateRanges: [ga4DateRange(zeitraum({ days: 30 }))], // 13.09.: genau 30 Tage
              dimensions: [{ name: "eventName" }],
              metrics: [{ name: "keyEvents" }, { name: "eventValue" }, { name: "totalRevenue" }],
              limit: 500,
            }),
          }),
          gaFetch(
            `https://analyticsadmin.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}/customDimensions?pageSize=200`,
          ),
          gaFetch(ga4RunReportUrl(propertyId), {
            method: "POST",
            body: JSON.stringify({
              dateRanges: [ga4DateRange(zeitraum({ days: 30 }))],
              dimensions: [{ name: "eventName" }],
              metrics: [{ name: "eventCount" }],
              orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
              limit: 200,
            }),
          }),
        ]);
        const rawCounts = new Map<string, number>();
        if (cntRes.ok) {
          const j: any = await cntRes.json().catch(() => ({}));
          for (const row of j.rows ?? []) {
            const name = String(row.dimensionValues?.[0]?.value ?? "");
            const n = Number(row.metricValues?.[0]?.value ?? 0);
            if (name && n > 0) rawCounts.set(name, n);
          }
        }

        const keyEvents: Array<{ name: string; defaultValue: number; defaultCurrency: string }> =
          [];
        if (keyRes.ok) {
          const j: any = await keyRes.json().catch(() => ({}));
          for (const k of j.keyEvents ?? [])
            keyEvents.push({
              name: String(k?.eventName || ""),
              defaultValue: Number(k?.defaultValue?.numericValue ?? 0),
              defaultCurrency: String(k?.defaultValue?.currencyCode || ""),
            });
        }
        // GA4-Coverage (21.09.2026): Kuerzung/Sampling der 30-Tage-Zaehlung mitliefern.
        const cov = ga4CoverageSammler();
        const counts = new Map<string, { count: number; gaValue: number }>();
        if (repRes.ok) {
          const j: any = cov.erfasse(await repRes.json().catch(() => ({})));
          for (const row of j.rows ?? []) {
            const name = String(row.dimensionValues?.[0]?.value ?? "");
            const n = Number(row.metricValues?.[0]?.value ?? 0);
            if (!name || n <= 0) continue; // nur Key-Events zählen hier > 0
            counts.set(name, {
              count: n,
              gaValue:
                Number(row.metricValues?.[2]?.value ?? 0) ||
                Number(row.metricValues?.[1]?.value ?? 0),
            });
          }
        }
        let dlValue = false;
        if (dimRes.ok) {
          const j: any = await dimRes.json().catch(() => ({}));
          dlValue = (j.customDimensions ?? []).some(
            (d: any) => d?.scope === "EVENT" && d?.parameterName === "dl_value",
          );
        }

        // Vereinigung: Admin-API-Liste + Report-Namen + bereits hinterlegte
        // + gezaehlte + Roh-Ereignisse ohne Grundrauschen.
        const names = new Set<string>([
          ...keyEvents.map((k) => k.name),
          ...counts.keys(),
          ...manual.keys(),
          ...counted,
          ...[...rawCounts.keys()].filter((n) => !NOISE_EVENTS.has(n)),
        ]);
        const keyByName = new Map(keyEvents.map((k) => [k.name, k]));
        const events = [...names]
          .filter(Boolean)
          .map((name) => ({
            name,
            isKeyEvent: keyByName.has(name),
            countsAsConversion: counted.has(name),
            // Gezaehlte und Nicht-Key-Events zeigen die Rohanzahl (so zaehlt
            // sie auch die Attribution), Key-Events die Key-Event-Anzahl.
            count30d:
              (counted.has(name) || !keyByName.has(name) ? rawCounts.get(name) : undefined) ??
              counts.get(name)?.count ??
              0,
            // Wert, den GA4 selbst schon liefert (Umsatz/value/Key-Event-Standardwert)
            ga4Value: counts.get(name)?.gaValue || keyByName.get(name)?.defaultValue || 0,
            manualValue: manual.get(name)?.value ?? 0,
            currency: manual.get(name)?.currency || keyByName.get(name)?.defaultCurrency || "CHF",
          }))
          .sort(
            (a, b) =>
              Number(b.isKeyEvent || b.countsAsConversion) -
                Number(a.isKeyEvent || a.countsAsConversion) ||
              b.count30d - a.count30d ||
              a.name.localeCompare(b.name),
          );

        return Response.json({
          ok: true,
          ga4: true,
          client: client.name,
          events,
          setup: { dlValue },
          coverage: cov.coverage(),
        });
      },

      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const body = await request.json().catch(() => ({}));
        const lookup = auth.userClient ?? (supabaseAdmin as any);

        const ke = KeyEventBody.safeParse(body);
        if (ke.success) {
          const { client: clientId, keyEvent } = ke.data;
          const client = await visibleClient(lookup, clientId);
          if (!client)
            return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });
          if (!client.ga4_property)
            return Response.json(
              { ok: false, error: "Kein GA4-Property hinterlegt" },
              { status: 400 },
            );
          const propertyId = String(client.ga4_property).replace(/^properties\//, "");
          let tok;
          try {
            tok = await getGoogleAccessTokenForScope(
              clientId,
              "https://www.googleapis.com/auth/analytics.edit",
            );
          } catch (e) {
            return Response.json(
              { ok: false, error: e instanceof Error ? e.message : String(e) },
              { status: 502 },
            );
          }
          const r = await fetch(
            `https://analyticsadmin.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}/keyEvents`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${tok.accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                eventName: keyEvent.event,
                countingMethod: keyEvent.countingMethod,
              }),
              signal: AbortSignal.timeout(15_000),
            },
          );
          const text = await r.text();
          if (r.status === 409 || /ALREADY_EXISTS/.test(text))
            return Response.json({ ok: true, already: true, event: keyEvent.event });
          if (!r.ok)
            return Response.json(
              { ok: false, error: `GA4 ${r.status}: ${text.slice(0, 300)}` },
              { status: 502 },
            );
          const j = text ? JSON.parse(text) : {};
          return Response.json({
            ok: true,
            created: true,
            event: keyEvent.event,
            name: j.name ?? null,
            viaClientId: tok.viaClientId === clientId ? null : tok.viaClientId,
          });
        }

        const parsed = PostBody.safeParse(body);
        if (!parsed.success)
          return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });
        const { client: clientId, values, conversionEvents } = parsed.data;
        const client = await visibleClient(lookup, clientId);
        if (!client)
          return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });

        let counted = 0;
        for (const ce of conversionEvents) {
          if (ce.on) {
            const { error } = await (supabaseAdmin as any)
              .from("client_conversion_events")
              .upsert(
                { client_id: clientId, event_name: ce.event },
                { onConflict: "client_id,event_name", ignoreDuplicates: true },
              );
            if (!error) counted++;
          } else {
            await (supabaseAdmin as any)
              .from("client_conversion_events")
              .delete()
              .eq("client_id", clientId)
              .eq("event_name", ce.event);
          }
        }

        let saved = 0,
          removed = 0;
        for (const v of values) {
          if (v.value > 0) {
            const { error } = await (supabaseAdmin as any).from("client_conversion_values").upsert(
              {
                client_id: clientId,
                event_name: v.event,
                value: v.value,
                currency: v.currency,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "client_id,event_name" },
            );
            if (!error) saved++;
          } else {
            const { error } = await (supabaseAdmin as any)
              .from("client_conversion_values")
              .delete()
              .eq("client_id", clientId)
              .eq("event_name", v.event);
            if (!error) removed++;
          }
        }
        return Response.json({ ok: true, saved, removed, counted });
      },
    },
  },
});
