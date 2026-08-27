import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  deployToGa4,
  revokeFromGa4,
  crossDomainGroundwork,
} from "@/server/ga4-conversion-deploy.server";

// Conversion-Scout — Freigabe-Liste (Pilot FIH, 26.08.2026).
//
// GET  ?client=<uuid> → Kandidaten (pending zuerst) + letzter Scan-Lauf.
// POST {client, id, action, value?, currency?}:
//   approve → Wert speichern + GA4 scharfschalten (Event Create Rule + Key
//             Event); erst NACH GA4-Erfolg wird status='approved' gesetzt.
//   ignore  → Kandidat ausblenden (kein GA4-Deploy noetig/vorhanden).
//   revoke  → Freigabe entziehen: GA4-Objekte loeschen, Refs leeren,
//             status='ignored' (Iron Rule: Historie bleibt, kein Row-Delete).
//   reopen  → ignored → pending (zurueck in die Pruefliste).
//   value   → nur Wert/Waehrung eines pending-Kandidaten aktualisieren.
//
// NUR ORGANIC: Key Events dienen der organischen Messung — bewusst keine
// Google-Ads-Anbindung. Auth wie ga4-conversions: eingeloggter User, Kunden-
// Sichtbarkeit via RLS (can_access_client); Tabellen selbst sind
// service-role-only.

async function requireUser(
  request: Request,
): Promise<{ userClient: any; userId: string } | Response> {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anon)
    return Response.json({ ok: false, error: "Server not configured" }, { status: 503 });
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
  });
  const { data } = await userClient.auth.getUser();
  if (!data.user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return { userClient, userId: data.user.id };
}

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
  id: z.string().uuid(),
  action: z.enum(["approve", "ignore", "revoke", "reopen", "value"]),
  value: z.number().min(0).max(10_000_000).optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
});

export const Route = createFileRoute("/api/admin/conversion-candidates")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const clientId = new URL(request.url).searchParams.get("client") || "";
        if (!/^[0-9a-f-]{36}$/i.test(clientId))
          return Response.json({ ok: false, error: "client (uuid) erforderlich" }, { status: 400 });
        const client = await visibleClient(auth.userClient, clientId);
        if (!client)
          return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });

        const SB = supabaseAdmin as any;
        const [{ data: candidates }, { data: lastRun }] = await Promise.all([
          SB.from("conversion_candidates")
            .select(
              "id, candidate_type, raw_value, label, source_url, first_seen_at, last_seen_at, status, conversion_value, conversion_currency, ga4_destination_event",
            )
            .eq("client_id", clientId)
            .order("status", { ascending: false }) // pending > ignored > approved alphab. — UI sortiert selbst
            .order("last_seen_at", { ascending: false })
            .limit(300),
          SB.from("conversion_scan_runs")
            .select(
              "id, started_at, finished_at, resolved_target_url, pages_crawled, status, error_message, new_candidates_count, seen_candidates_count",
            )
            .eq("client_id", clientId)
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        return Response.json({
          ok: true,
          hasGa4: Boolean(client.ga4_property),
          candidates: candidates ?? [],
          lastRun: lastRun ?? null,
        });
      },

      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const parsed = PostBody.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Ungueltige Eingabe" }, { status: 400 });
        const { client: clientId, id, action, value, currency } = parsed.data;
        const client = await visibleClient(auth.userClient, clientId);
        if (!client)
          return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });

        const SB = supabaseAdmin as any;
        const { data: cand } = await SB.from("conversion_candidates")
          .select("*")
          .eq("id", id)
          .eq("client_id", clientId)
          .maybeSingle();
        if (!cand)
          return Response.json({ ok: false, error: "Kandidat nicht gefunden" }, { status: 404 });

        const decided = {
          decided_at: new Date().toISOString(),
          decided_by: auth.userId,
        };
        let groundwork: string[] | undefined;

        try {
          if (action === "value") {
            await SB.from("conversion_candidates")
              .update({
                conversion_value: value ?? null,
                conversion_currency: currency || cand.conversion_currency || "CHF",
              })
              .eq("id", id);
          } else if (action === "ignore") {
            await SB.from("conversion_candidates")
              .update({ status: "ignored", ...decided })
              .eq("id", id);
          } else if (action === "reopen") {
            await SB.from("conversion_candidates")
              .update({ status: "pending", ...decided })
              .eq("id", id);
          } else if (action === "approve") {
            if (!client.ga4_property)
              return Response.json(
                { ok: false, error: "Keine GA4-Property beim Kunden hinterlegt" },
                { status: 409 },
              );
            const merged = {
              ...cand,
              conversion_value: value ?? cand.conversion_value,
              conversion_currency: currency || cand.conversion_currency || "CHF",
            };
            const refs = await deployToGa4(clientId, client.ga4_property, merged);
            await SB.from("conversion_candidates")
              .update({
                status: "approved",
                conversion_value: merged.conversion_value,
                conversion_currency: merged.conversion_currency,
                ga4_destination_event: refs.destinationEvent,
                ga4_event_create_rule: refs.ruleName,
                ga4_key_event: refs.keyEventName,
                ...decided,
              })
              .eq("id", id);
            // Cross-Domain: die Klick-Absicht ist jetzt scharf; fuer den echten
            // Purchase mit Betrag braucht es zwei einmalige manuelle Schritte.
            if (cand.candidate_type === "crossdomain")
              groundwork = crossDomainGroundwork(cand.raw_value);
          } else if (action === "revoke") {
            await revokeFromGa4(clientId, {
              ruleName: cand.ga4_event_create_rule,
              keyEventName: cand.ga4_key_event,
            });
            await SB.from("conversion_candidates")
              .update({
                status: "ignored",
                ga4_destination_event: null,
                ga4_event_create_rule: null,
                ga4_key_event: null,
                ...decided,
              })
              .eq("id", id);
          }
        } catch (e) {
          return Response.json(
            { ok: false, error: String((e as Error)?.message || e).slice(0, 300) },
            { status: 502 },
          );
        }
        return Response.json({ ok: true, groundwork });
      },
    },
  },
});
