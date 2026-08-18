import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  gbpResolveDefault,
  gbpReviews,
  gbpReplyReview,
  gbpCreatePost,
  gbpAccounts,
  gbpLocations,
} from "@/server/gbp.server";

// Machine-triggerable Google Business Profile actions for autonomous agents.
// Secret-gated (ADMIN_AUTOMATION_SECRET). Reads/answers reviews, creates posts.
// Stored account/location in clients.metadata.gbp = { account, location }.

const Body = z.object({
  clientId: z.string().uuid().optional(),
  clientName: z.string().optional(),
  action: z.enum(["discover", "reviews", "reply-review", "create-post"]),
  reviewId: z.string().optional(),
  comment: z.string().optional(),
  summary: z.string().optional(),
  ctaUrl: z.string().optional(),
  ctaType: z.string().optional(),
});

export const Route = createFileRoute("/api/admin/gbp")({
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

        // Resolve client + its stored GBP location.
        let clientId = d.clientId || null;
        let metadata: any = {};
        if (clientId) {
          const { data } = await supabaseAdmin
            .from("clients")
            .select("id, metadata")
            .eq("id", clientId)
            .maybeSingle();
          metadata = data?.metadata || {};
        } else if (d.clientName) {
          const { data } = await supabaseAdmin
            .from("clients")
            .select("id, metadata")
            .ilike("name", d.clientName)
            .limit(1)
            .maybeSingle();
          clientId = data?.id || null;
          metadata = data?.metadata || {};
        }
        if (!clientId)
          return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });

        try {
          // Discovery: list accounts+locations and persist the first as default.
          if (d.action === "discover") {
            const acc = await gbpAccounts(clientId);
            if (!("accounts" in acc) || !acc.ok)
              return Response.json({
                ok: false,
                error: (acc as any).error || "Keine Accounts",
                hint: "Business Profile API freigeschaltet? Google neu verbinden (Scope business.manage)?",
              });
            const account = acc.accounts[0]?.name;
            const locs = account
              ? await gbpLocations(clientId, account)
              : { ok: false, locations: [] as any[] };
            return Response.json({
              ok: true,
              accounts: acc.accounts,
              locations: (locs as any).locations || [],
            });
          }

          // For actions, need account+location (stored, else auto-discover).
          let account = metadata?.gbp?.account as string | undefined;
          let location = metadata?.gbp?.location as string | undefined;
          if (!account || !location) {
            const def = await gbpResolveDefault(clientId);
            if (!def.ok)
              return Response.json({
                ok: false,
                error: def.error,
                hint: "Business Profile API freigeschaltet? Google mit Scope business.manage neu verbinden?",
              });
            account = def.account;
            location = def.location;
            // Persist discovered default.
            const newMeta = { ...metadata, gbp: { account, location } };
            await supabaseAdmin.from("clients").update({ metadata: newMeta }).eq("id", clientId);
          }

          if (d.action === "reviews") {
            const r = await gbpReviews(clientId, account!, location!);
            return Response.json(
              r.ok ? { ...r, ok: true } : { ok: false, error: (r as any).error },
            );
          }
          if (d.action === "reply-review") {
            if (!d.reviewId || !d.comment)
              return Response.json(
                { ok: false, error: "reviewId + comment erforderlich" },
                { status: 400 },
              );
            const r = await gbpReplyReview(clientId, account!, location!, d.reviewId, d.comment);
            return Response.json(r.ok ? { ok: true } : { ok: false, error: (r as any).error });
          }
          if (d.action === "create-post") {
            if (!d.summary)
              return Response.json({ ok: false, error: "summary erforderlich" }, { status: 400 });
            const r = await gbpCreatePost(clientId, account!, location!, {
              summary: d.summary,
              ctaUrl: d.ctaUrl,
              ctaType: d.ctaType,
            });
            return Response.json(
              r.ok ? { ...r, ok: true } : { ok: false, error: (r as any).error },
            );
          }
          return Response.json({ ok: false, error: "Unbekannte action" }, { status: 400 });
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
