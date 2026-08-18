import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { gtmAccounts, gtmContainers, gtmLiveTags, gtmResolveDefault } from "@/server/gtm.server";

// Machine-triggerable Google Tag Manager (read-only) for autonomous agents.
// Verifies conversion tracking: discover account/container + read live tags.
// Secret-gated (ADMIN_AUTOMATION_SECRET). Stored in clients.metadata.gtm.

const Body = z.object({
  clientId: z.string().uuid().optional(),
  clientName: z.string().optional(),
  action: z.enum(["discover", "tags"]),
});

export const Route = createFileRoute("/api/admin/gtm")({
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
          return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });
        const d = parsed.data;

        let clientId = d.clientId || null;
        let metadata: any = {};
        let clientDomain = "";
        if (clientId) {
          const { data } = await supabaseAdmin
            .from("clients")
            .select("id, metadata, domain")
            .eq("id", clientId)
            .maybeSingle();
          metadata = data?.metadata || {};
          clientDomain = data?.domain || "";
        } else if (d.clientName) {
          const { data } = await supabaseAdmin
            .from("clients")
            .select("id, metadata, domain")
            .ilike("name", d.clientName)
            .limit(1)
            .maybeSingle();
          clientId = data?.id || null;
          metadata = data?.metadata || {};
          clientDomain = data?.domain || "";
        }
        if (!clientId)
          return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });

        try {
          if (d.action === "discover") {
            const acc = await gtmAccounts(clientId);
            if (!("accounts" in acc) || !acc.ok)
              return Response.json({
                ok: false,
                error: (acc as any).error,
                hint: "Tag Manager API aktiviert? Google mit Scope tagmanager.readonly neu verbinden?",
              });
            const all: any[] = [];
            for (const a of acc.accounts || []) {
              const c = await gtmContainers(clientId, a.path);
              if ((c as any).ok)
                for (const x of (c as any).containers || [])
                  all.push({ ...x, accountPath: a.path });
            }
            const def = await gtmResolveDefault(clientId, clientDomain);
            return Response.json({
              ok: true,
              accounts: acc.accounts,
              containers: all,
              matched: def.ok
                ? {
                    publicId: def.publicId,
                    containerPath: def.containerPath,
                    matchedBy: def.matchedBy,
                  }
                : null,
            });
          }

          // tags: resolve container (stored or auto via domain-match), read live tags.
          let containerPath = metadata?.gtm?.containerPath as string | undefined;
          let matchedBy: string | undefined;
          if (!containerPath) {
            const def = await gtmResolveDefault(clientId, clientDomain);
            if (!def.ok)
              return Response.json({
                ok: false,
                error: def.error,
                hint: "Tag Manager API aktiviert + Google neu verbinden (Scope tagmanager.readonly)?",
              });
            containerPath = def.containerPath;
            matchedBy = def.matchedBy;
            // Persist only a CONFIDENT match (site/name) — a fallback could be the
            // wrong client's container, so leave it unsaved for manual confirmation.
            if (def.matchedBy === "site" || def.matchedBy === "name") {
              const newMeta = {
                ...metadata,
                gtm: {
                  accountPath: def.accountPath,
                  containerPath: def.containerPath,
                  publicId: def.publicId,
                },
              };
              await supabaseAdmin.from("clients").update({ metadata: newMeta }).eq("id", clientId);
            }
          }
          const r = await gtmLiveTags(clientId, containerPath!);
          return Response.json(
            r.ok ? { ...r, ok: true, matchedBy } : { ok: false, error: (r as any).error },
          );
        } catch (e) {
          return Response.json({
            ok: false,
            error: String((e as Error)?.message || e).slice(0, 300),
          });
        }
      },
    },
  },
});
