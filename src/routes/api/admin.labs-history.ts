import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Labs-History-Ingest (DataForSEO-SEO-Ausbau 2026-08-13): der agent-service
// misst MONATLICH je Kunde die Sichtbarkeits-Historie (Labs
// historical_rank_overview, Sistrix-Ersatz-Kurve) + Traffic-Schaetzung
// (bulk_traffic_estimation) und PUSHT das Ergebnis hierher. Diese Route
// validiert und schreibt eine audit_runs-Zeile type 'labs_history'.
// Idempotenz/Auth exakt wie /api/admin/rank-snapshot (Upsert je client+date,
// ADMIN_AUTOMATION_SECRET).

const MonthRow = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  keywords: z.number(),
  etv: z.number(),
  pos_1: z.number().optional(),
  pos_2_3: z.number().optional(),
  pos_4_10: z.number().optional(),
  pos_11_20: z.number().optional(),
});

const Body = z.object({
  client: z.string().min(1), // slug, z.B. "hotel-ava"
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  domain: z.string().min(1),
  months: z.array(MonthRow),
  traffic: z.object({ etv: z.number().nullable(), keywords: z.number().nullable() }).optional(),
  // Wettbewerber-Traffic (gleicher bulk-Call) — tolerant, optional.
  competitors: z
    .array(
      z.object({ domain: z.string(), etv: z.number().nullable(), keywords: z.number().nullable() }),
    )
    .optional(),
});

function slugifyName(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const Route = createFileRoute("/api/admin/labs-history")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret)
          return Response.json(
            { ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" },
            { status: 503 },
          );
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json(
            { ok: false, error: "Invalid input", details: parsed.error.issues },
            { status: 400 },
          );
        const d = parsed.data;

        const { data: clients } = await supabaseAdmin
          .from("clients")
          .select("id, name, domain, organization_id");
        const target = (clients || []).find(
          (c: any) =>
            slugifyName(c.name) === d.client ||
            slugifyName(
              String(c.domain || "")
                .replace(/^https?:\/\//, "")
                .replace(/^www\./, "")
                .split(".")[0],
            ) === d.client,
        );
        if (!target)
          return Response.json(
            { ok: false, error: `Kunde '${d.client}' nicht gefunden` },
            { status: 404 },
          );

        const { data: users } = await supabaseAdmin
          .from("app_users")
          .select("user_id, role")
          .eq("organization_id", target.organization_id)
          .limit(20);
        const owner =
          (users || []).find((u: any) => ["owner", "admin"].includes(u.role)) || (users || [])[0];
        if (!owner)
          return Response.json(
            { ok: false, error: "Kein Org-User fuer triggered_by" },
            { status: 500 },
          );

        const result: Record<string, unknown> = {
          client: d.client,
          date: d.date,
          domain: d.domain,
          months: d.months,
        };
        if (d.traffic) result.traffic = d.traffic;
        if (d.competitors) result.competitors = d.competitors;

        const { data: existing } = await supabaseAdmin
          .from("audit_runs")
          .select("id")
          .eq("client_id", target.id)
          .eq("audit_type", "labs_history")
          .eq("input->>date", d.date)
          .limit(1)
          .maybeSingle();

        const now = new Date().toISOString();
        if (existing?.id) {
          const { error } = await supabaseAdmin
            .from("audit_runs")
            .update({ result, status: "succeeded", finished_at: now } as never)
            .eq("id", existing.id);
          if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
          return Response.json({ ok: true, id: existing.id, upserted: true });
        }
        const { data: created, error } = await supabaseAdmin
          .from("audit_runs")
          .insert({
            client_id: target.id,
            organization_id: target.organization_id,
            triggered_by: (owner as any).user_id,
            audit_type: "labs_history",
            status: "succeeded",
            input: { date: d.date, client: d.client },
            result,
            started_at: now,
            finished_at: now,
          } as never)
          .select("id")
          .single();
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        return Response.json({ ok: true, id: created?.id, upserted: false });
      },
    },
  },
});
