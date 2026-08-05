import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "@/server/google-tokens.server";

// GA4-Conversions je Kunde für den Admin-Bereich (05.08.2026).
//
// GET  ?client=<uuid>  → Key-Events der verbundenen GA4-Property (Admin API)
//                        + 30-Tage-Zählung und GA4-eigene Werte (Data API)
//                        + hinterlegte manuelle Werte (client_conversion_values)
//                        + Setup-Erkennung (dl_value-Custom-Dimension vorhanden?)
// POST {client, values:[{event, value, currency}]} → Werte hinterlegen;
//                        value <= 0 löscht den Eintrag wieder.
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
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return Response.json({ ok: false, error: "Server not configured" }, { status: 503 });
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

const PostBody = z.object({
  client: z.string().uuid(),
  values: z
    .array(
      z.object({
        event: z.string().min(1).max(200),
        value: z.number().min(0).max(10_000_000),
        currency: z.string().regex(/^[A-Z]{3}$/).default("CHF"),
      }),
    )
    .max(100),
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
        const client = await visibleClient(auth.userClient, clientId);
        if (!client) return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });

        // Hinterlegte Werte immer liefern — auch ohne GA4-Verbindung sichtbar.
        const { data: manualRows } = await (supabaseAdmin as any)
          .from("client_conversion_values")
          .select("event_name, value, currency")
          .eq("client_id", clientId);
        const manual = new Map<string, { value: number; currency: string }>(
          (manualRows ?? []).map((m: any) => [String(m.event_name), { value: Number(m.value), currency: String(m.currency || "CHF") }]),
        );

        if (!client.ga4_property)
          return Response.json({ ok: true, ga4: false, events: [...manual.entries()].map(([name, m]) => ({
            name, isKeyEvent: false, count30d: 0, ga4Value: 0, manualValue: m.value, currency: m.currency,
          })), setup: { dlValue: false } });

        let token: string;
        try {
          token = (await getGoogleAccessToken(clientId)).accessToken;
        } catch (e) {
          return Response.json({ ok: false, error: "Google-Token: " + String((e as any)?.message || e).slice(0, 160) }, { status: 502 });
        }
        const propertyId = String(client.ga4_property).replace(/^properties\//, "");
        const gaFetch = (url: string, init?: RequestInit) =>
          fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) }, signal: AbortSignal.timeout(20_000) });

        // 1) Key-Events (die in GA4 als Conversion markierten Events) inkl.
        //    dort hinterlegtem Standardwert. 2) 30-Tage-Report je Event.
        //    3) Custom-Dimension-Erkennung (Buchungs-Setup dl_value).
        const [keyRes, repRes, dimRes] = await Promise.all([
          gaFetch(`https://analyticsadmin.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}/keyEvents?pageSize=200`),
          gaFetch(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`, {
            method: "POST",
            body: JSON.stringify({
              dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
              dimensions: [{ name: "eventName" }],
              metrics: [{ name: "keyEvents" }, { name: "eventValue" }, { name: "totalRevenue" }],
              limit: 500,
            }),
          }),
          gaFetch(`https://analyticsadmin.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}/customDimensions?pageSize=200`),
        ]);

        const keyEvents: Array<{ name: string; defaultValue: number; defaultCurrency: string }> = [];
        if (keyRes.ok) {
          const j: any = await keyRes.json().catch(() => ({}));
          for (const k of j.keyEvents ?? [])
            keyEvents.push({
              name: String(k?.eventName || ""),
              defaultValue: Number(k?.defaultValue?.numericValue ?? 0),
              defaultCurrency: String(k?.defaultValue?.currencyCode || ""),
            });
        }
        const counts = new Map<string, { count: number; gaValue: number }>();
        if (repRes.ok) {
          const j: any = await repRes.json().catch(() => ({}));
          for (const row of j.rows ?? []) {
            const name = String(row.dimensionValues?.[0]?.value ?? "");
            const n = Number(row.metricValues?.[0]?.value ?? 0);
            if (!name || n <= 0) continue; // nur Key-Events zählen hier > 0
            counts.set(name, {
              count: n,
              gaValue: Number(row.metricValues?.[2]?.value ?? 0) || Number(row.metricValues?.[1]?.value ?? 0),
            });
          }
        }
        let dlValue = false;
        if (dimRes.ok) {
          const j: any = await dimRes.json().catch(() => ({}));
          dlValue = (j.customDimensions ?? []).some((d: any) => d?.scope === "EVENT" && d?.parameterName === "dl_value");
        }

        // Vereinigung: Admin-API-Liste + Report-Namen + bereits hinterlegte.
        const names = new Set<string>([...keyEvents.map((k) => k.name), ...counts.keys(), ...manual.keys()]);
        const keyByName = new Map(keyEvents.map((k) => [k.name, k]));
        const events = [...names].filter(Boolean).map((name) => ({
          name,
          isKeyEvent: keyByName.has(name),
          count30d: counts.get(name)?.count ?? 0,
          // Wert, den GA4 selbst schon liefert (Umsatz/value/Key-Event-Standardwert)
          ga4Value: counts.get(name)?.gaValue || keyByName.get(name)?.defaultValue || 0,
          manualValue: manual.get(name)?.value ?? 0,
          currency: manual.get(name)?.currency || keyByName.get(name)?.defaultCurrency || "CHF",
        }))
        .sort((a, b) => b.count30d - a.count30d || a.name.localeCompare(b.name));

        return Response.json({ ok: true, ga4: true, client: client.name, events, setup: { dlValue } });
      },

      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const parsed = PostBody.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });
        const { client: clientId, values } = parsed.data;
        const client = await visibleClient(auth.userClient, clientId);
        if (!client) return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });

        let saved = 0, removed = 0;
        for (const v of values) {
          if (v.value > 0) {
            const { error } = await (supabaseAdmin as any)
              .from("client_conversion_values")
              .upsert(
                { client_id: clientId, event_name: v.event, value: v.value, currency: v.currency, updated_at: new Date().toISOString() },
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
        return Response.json({ ok: true, saved, removed });
      },
    },
  },
});
