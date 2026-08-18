import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Onboarding-Snapshot-Ingest (Ausbau 2026-07-15, Modul 1): der agent-service
// baut aus einer Domain einen VORSCHLAG (Keyword-Universum, organische + lokale
// Wettbewerber, Kundentyp) und pusht einen schlanken Snapshot hierher. Diese
// Route schreibt eine audit_runs-Zeile type 'onboarding_scan'. Idempotenz: genau
// EIN aktueller Vorschlag je Kunde -> Upsert auf (client_id, audit_type). Rein
// Vorschlag; nichts wird scharf geschaltet. Secret-gated wie rank-snapshot.

const Kw = z.object({
  kw: z.string(),
  position: z.number().nullable().optional(),
  searchVolume: z.number().nullable().optional(),
  etv: z.number().nullable().optional(),
  url: z.string().nullable().optional(),
  intent: z.string().nullable().optional(),
});

const Body = z.object({
  client: z.string().min(1), // slug
  scannedAt: z.string(),
  counts: z.object({
    ranked: z.number().int(),
    ideas: z.number().int(),
    organicCompetitors: z.number().int(),
    localCompetitors: z.number().int(),
  }),
  topRanked: z.array(Kw).default([]),
  topOrganicCompetitors: z.array(z.any()).default([]),
  topLocalCompetitors: z.array(z.any()).default([]),
  suggestions: z.object({
    brandTerms: z.array(z.string()).default([]),
    moneyKeywordCandidates: z.array(z.string()).default([]),
    clientType: z.string().default("generic"),
    clientTypeReason: z.string().default(""),
  }),
  changes: z.any().nullable().optional(),
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

export const Route = createFileRoute("/api/admin/onboarding-snapshot")({
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
          scannedAt: d.scannedAt,
          counts: d.counts,
          topRanked: d.topRanked,
          topOrganicCompetitors: d.topOrganicCompetitors,
          topLocalCompetitors: d.topLocalCompetitors,
          suggestions: d.suggestions,
          changes: d.changes ?? null,
        };

        // Upsert je Kunde: genau EINE onboarding_scan-Zeile (nicht je Datum).
        const { data: existing } = await supabaseAdmin
          .from("audit_runs")
          .select("id")
          .eq("client_id", target.id)
          .eq("audit_type", "onboarding_scan")
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const now = new Date().toISOString();
        if (existing?.id) {
          const { error } = await supabaseAdmin
            .from("audit_runs")
            .update({ result, status: "succeeded", finished_at: now, started_at: now } as never)
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
            audit_type: "onboarding_scan",
            status: "succeeded",
            input: { client: d.client, scannedAt: d.scannedAt },
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
