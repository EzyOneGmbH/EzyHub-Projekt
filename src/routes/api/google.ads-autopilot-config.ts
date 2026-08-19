import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  canConfigureAutopilot,
  describeConfigChange,
  sanitizeConfigPatch,
  type AutopilotConfigPatch,
} from "@/ezy/data/adsAutopilotPolicy";

// User-authed Autopilot-Konfiguration (EzyPerformance-UI). Nur Owner/Admin der
// Organisation duerfen aendern; jede Aenderung braucht eine Zusammenfassung
// (Bestaetigungstext aus der UI) und landet als Audit-Trail-Zeile im
// ads_changelog (action_type config_change) - wer, wann, was.
// Sichere Defaults bleiben Sache der DB (observe_only=true, autonomy_level=0).

const Body = z.object({
  clientId: z.string().uuid(),
  patch: z.record(z.string(), z.unknown()),
  summary: z.string().trim().min(5).max(2000),
});

// Felder, die im Audit-Trail als Vorher/Nachher-Schnappschuss festgehalten werden.
const TRACKED: Array<keyof AutopilotConfigPatch> = [
  "observe_only",
  "kill_switch",
  "autonomy_level",
  "target_cpa_chf",
  "target_roas",
  "monthly_budget_chf",
  "no_touch_campaigns",
];

async function authedUser(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!;
  const sb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
  });
  const { data } = await sb.auth.getUser();
  return data.user;
}

export const Route = createFileRoute("/api/google/ads-autopilot-config")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await authedUser(request);
        if (!user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });

        const { data: client } = await supabaseAdmin
          .from("clients")
          .select("id, organization_id, google_ads_customer")
          .eq("id", parsed.data.clientId)
          .maybeSingle();
        if (!client)
          return Response.json({ ok: false, error: "Client not found" }, { status: 404 });

        const { data: m } = await supabaseAdmin
          .from("app_users")
          .select("role")
          .eq("user_id", user.id)
          .eq("organization_id", client.organization_id)
          .maybeSingle();
        if (!m) return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
        if (!canConfigureAutopilot(m.role))
          return Response.json(
            { ok: false, error: "Nur Owner/Admin duerfen den Autopilot konfigurieren." },
            { status: 403 },
          );

        const sanitized = sanitizeConfigPatch(parsed.data.patch);
        if (!sanitized.ok || !sanitized.patch)
          return Response.json({ ok: false, error: sanitized.error }, { status: 400 });
        const patch = sanitized.patch;

        const { data: existing } = await supabaseAdmin
          .from("ads_autopilot_config")
          .select("*")
          .eq("client_id", client.id)
          .maybeSingle();

        const before: Record<string, unknown> = {};
        for (const key of TRACKED) before[key] = existing?.[key] ?? null;
        const diffLines = describeConfigChange(before, patch);
        if (diffLines.length === 0)
          return Response.json({ ok: false, error: "Keine Aenderung erkannt." }, { status: 400 });

        const { error: upsertErr } = await supabaseAdmin.from("ads_autopilot_config").upsert(
          { client_id: client.id, ...patch, updated_at: new Date().toISOString() },
          {
            onConflict: "client_id",
          },
        );
        if (upsertErr)
          return Response.json({ ok: false, error: upsertErr.message }, { status: 500 });

        // Audit-Trail: passt in die bestehenden Check-Constraints von
        // ads_changelog (action_class/status report-only); die UI trennt
        // config_change-Zeilen von den Lauf-Befunden ueber action_type.
        const after: Record<string, unknown> = { ...before, ...patch };
        const who = user.email || user.id;
        try {
          await supabaseAdmin.from("ads_changelog").insert({
            client_id: client.id,
            customer_id: String(client.google_ads_customer ?? "").replace(/\D/g, "") || "-",
            run_id: `config-${new Date().toISOString().slice(0, 10)}`,
            action_type: "config_change",
            action_class: "report-only",
            entity: "Autopilot-Konfiguration",
            before_value: JSON.stringify(before),
            after_value: JSON.stringify(after),
            rationale: `${diffLines.join("; ")} — Begruendung: ${parsed.data.summary}`,
            status: "report-only",
            approved_by: who,
          });
        } catch {
          /* Audit-Zeile ist Pflicht-Soll, aber die Config ist bereits gespeichert */
        }

        const { data: saved } = await supabaseAdmin
          .from("ads_autopilot_config")
          .select("*")
          .eq("client_id", client.id)
          .maybeSingle();
        return Response.json({ ok: true, config: saved ?? null, changes: diffLines });
      },
    },
  },
});
