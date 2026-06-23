import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Machine-triggerable daily change-log note for autonomous agents. Creates (or
// appends to) ONE "note" content item per client per day, titled
// "Agent-Änderungen <YYYY-MM-DD>", so every autonomous change is traceable under
// Content/Notes. Secret-gated (ADMIN_AUTOMATION_SECRET).

const Body = z.object({
  clientId: z.string().uuid().optional(),
  clientName: z.string().optional(),
  date: z.string().optional(), // YYYY-MM-DD; defaults to today (server TZ)
  agent: z.string().optional(),
  entry: z.string().min(1), // markdown of what changed
  keywords: z.array(z.string()).optional(),
});

export const Route = createFileRoute("/api/admin/content-note")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret) return Response.json({ ok: false, error: "ADMIN_AUTOMATION_SECRET not configured" }, { status: 503 });
        if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`)
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) return Response.json({ ok: false, error: "Invalid input", details: parsed.error.issues }, { status: 400 });
        const d = parsed.data;

        // Resolve client (id or name) + its organization.
        let clientId = d.clientId || null;
        let orgId: string | null = null;
        if (clientId) {
          const { data } = await supabaseAdmin.from("clients").select("id, organization_id").eq("id", clientId).maybeSingle();
          orgId = data?.organization_id || null;
        } else if (d.clientName) {
          const { data } = await supabaseAdmin.from("clients").select("id, organization_id").ilike("name", d.clientName).limit(1).maybeSingle();
          clientId = data?.id || null;
          orgId = data?.organization_id || null;
        }
        if (!clientId || !orgId) return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });

        // created_by must be a real user — use an owner/admin of the org.
        const { data: member } = await supabaseAdmin
          .from("app_users")
          .select("user_id, role")
          .eq("organization_id", orgId)
          .in("role", ["owner", "admin", "member"])
          .limit(1)
          .maybeSingle();
        const createdBy = member?.user_id;
        if (!createdBy) return Response.json({ ok: false, error: "Kein Org-Benutzer für created_by gefunden" }, { status: 500 });

        const date = (d.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
        const title = `Agent-Änderungen ${date}`;
        const stamp = new Date().toISOString().slice(11, 16);
        const block = `\n\n---\n**${stamp}${d.agent ? ` · ${d.agent}` : ""}**\n${d.entry.trim()}`;

        // Find today's note for this client (append) or create it.
        const { data: existing } = await supabaseAdmin
          .from("content_items")
          .select("id, body")
          .eq("client_id", clientId)
          .eq("content_type", "note")
          .eq("title", title)
          .limit(1)
          .maybeSingle();

        if (existing?.id) {
          await supabaseAdmin
            .from("content_items")
            .update({ body: String(existing.body || "") + block })
            .eq("id", existing.id);
          return Response.json({ ok: true, noteId: existing.id, appended: true });
        }

        const header = `# Agent-Änderungen ${date}\n\nAutomatisch protokollierte Änderungen der Agenten an diesem Tag.`;
        const { data: created, error } = await supabaseAdmin
          .from("content_items")
          .insert({
            client_id: clientId,
            created_by: createdBy,
            title,
            body: header + block,
            content_type: "note",
            status: "published",
            keywords: d.keywords ?? [],
          })
          .select("id")
          .single();
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        return Response.json({ ok: true, noteId: created?.id, appended: false });
      },
    },
  },
});
