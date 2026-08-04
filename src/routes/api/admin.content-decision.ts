import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Read-Bridge für den content-fix-playbook-Skill (agent-service): liefert die
// Refresh-Empfehlungen je Kunde aus der content_decision-View. Grund: die RPC
// get_content_dashboard ist SECURITY DEFINER + auth-gated (can_access_client →
// auth.uid()) und daher für den Agenten (kein User-JWT) NICHT nutzbar. Hier
// server-seitig mit service_role (RLS-Bypass), read-only, secret-gated
// (ADMIN_AUTOMATION_SECRET) — gleiche Architektur wie content-sync/aivis-sync.
// Die View ist bereits blog-only + published (content_type='blog').

const ACTIONABLE = ["not_indexed", "tech_fix", "ctr_fix", "push_expand", "refresh_decay", "consolidate", "ceiling_new_kw", "low_visibility"];
// Dringlichkeit: Indexstatus zuerst (ohne Index wirkt KEINE andere Massnahme),
// dann Technik/Kannibalisierung, dann Decay, dann Ausbau/CTR.
const ORDER: Record<string, number> = { not_indexed: 0, tech_fix: 1, consolidate: 2, refresh_decay: 3, push_expand: 4, ctr_fix: 5, ceiling_new_kw: 6, low_visibility: 7 };

export const Route = createFileRoute("/api/admin/content-decision")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret)
          return Response.json({ ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" }, { status: 503 });
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

        const url = new URL(request.url);
        const clientIdParam = url.searchParams.get("clientId") || "";
        const clientName = url.searchParams.get("clientName") || "";
        const actionableOnly = url.searchParams.get("actionable") === "1";

        let cid = clientIdParam;
        if (!cid && clientName) {
          const { data } = await supabaseAdmin
            .from("clients").select("id").ilike("name", `%${clientName}%`).limit(1).maybeSingle();
          cid = data?.id || "";
        }
        if (!cid)
          return Response.json({ ok: false, error: "Kunde nicht gefunden (clientId oder clientName angeben)" }, { status: 404 });

        const { data, error } = await supabaseAdmin
          .from("content_decision").select("*").eq("client_id", cid);
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        let rows = (data || []) as any[];
        if (actionableOnly) rows = rows.filter((r) => ACTIONABLE.includes(r.recommendation));
        rows.sort((a, b) => (ORDER[a.recommendation] ?? 9) - (ORDER[b.recommendation] ?? 9));

        return Response.json(
          {
            ok: true,
            clientId: cid,
            count: rows.length,
            actionable: rows.filter((r) => ACTIONABLE.includes(r.recommendation)).length,
            rows,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
      // Write-Back: markiert einen Artikel als aufgefrischt (schließt den §7-Loop).
      // Nur Lifecycle-Feld last_refresh_at — NIE Zeitreihen/Metriken (die kommen aus
      // content-sync). content_item_id = content_items.id.
      POST: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret)
          return Response.json({ ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" }, { status: 503 });
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        const body = (await request.json().catch(() => ({}))) as { contentItemId?: string };
        const id = String(body.contentItemId || "");
        if (!id) return Response.json({ ok: false, error: "contentItemId fehlt" }, { status: 400 });
        const { error } = await supabaseAdmin
          .from("content_items")
          .update({ last_refresh_at: new Date().toISOString() })
          .eq("id", id);
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        return Response.json({ ok: true, contentItemId: id, marked: "last_refresh_at" });
      },
    },
  },
});
