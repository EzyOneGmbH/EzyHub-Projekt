import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Onboarding-Apply-Bruecke (Ausbau 2026-07-15, M1.5): der Browser markiert bei
// "Uebernehmen" die ausgewaehlten Keywords im onboarding_scan-Result
// (result.applied, processed:false) und setzt brand_terms/client_type direkt.
// Der agent-service (localhost, vom Browser NICHT erreichbar) pollt hier die
// offenen Applies (GET), wendet die Keywords auf die BESTEHENDE keyword-setup-
// Route an und markiert danach processed (POST). Secret-gated wie rank-snapshot.

export const Route = createFileRoute("/api/admin/onboarding-pending")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret)
          return Response.json(
            { ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" },
            { status: 503 },
          );
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        // Performance (30.09.2026): nur offene Scans filtern und nur die
        // benoetigten JSON-Teile laden (vorher: alle Scans mit komplettem result,
        // ~1.2 s je Aufruf bei minuetlichem Polling durch den agent-service).
        const { data } = await supabaseAdmin
          .from("audit_runs")
          .select("id, client_id, applied:result->applied, kunde:result->client")
          .eq("audit_type", "onboarding_scan")
          .eq("result->applied->>processed", "false");
        const pending = (data || [])
          .filter((r: any) => r.applied && r.applied.processed === false)
          .map((r: any) => ({
            id: r.id,
            client: r.kunde,
            keywords: r.applied.keywords || [],
            at: r.applied.at,
          }))
          .filter((p: any) => p.client && (p.keywords || []).length);
        return Response.json({ ok: true, pending });
      },
      POST: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret)
          return Response.json(
            { ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" },
            { status: 503 },
          );
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        const parsed = z
          .object({ id: z.string().uuid() })
          .safeParse(await request.json().catch(() => ({})));
        if (!parsed.success)
          return Response.json({ ok: false, error: "id (uuid) erforderlich" }, { status: 400 });
        const { data: row } = await supabaseAdmin
          .from("audit_runs")
          .select("id, result")
          .eq("id", parsed.data.id)
          .maybeSingle();
        if (!row) return Response.json({ ok: false, error: "nicht gefunden" }, { status: 404 });
        const result = (row as any).result || {};
        if (result.applied) result.applied.processed = true;
        const { error } = await supabaseAdmin
          .from("audit_runs")
          .update({ result } as never)
          .eq("id", parsed.data.id);
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        return Response.json({ ok: true });
      },
    },
  },
});
