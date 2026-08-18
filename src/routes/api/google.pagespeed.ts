import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isProviderEnabled, canRunAudits } from "@/server/integrations.server";

// Core Web Vitals via PageSpeed Insights v5 (CrUX field data + Lighthouse lab).
// Uses the GOOGLE_API_KEY (PageSpeed Insights API + Chrome UX Report API must be enabled).

const Body = z.object({
  clientId: z.string().uuid(),
  url: z.string().url().optional(),
  strategy: z.enum(["mobile", "desktop"]).default("mobile"),
});

function redact(input: unknown, key?: string): string {
  let s = input instanceof Error ? input.message : String(input);
  if (key && key.length > 4) s = s.split(key).join("***");
  return s.slice(0, 400);
}

export const Route = createFileRoute("/api/google/pagespeed")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.GOOGLE_API_KEY;
        if (!apiKey)
          return Response.json(
            { ok: false, error: "GOOGLE_API_KEY not configured" },
            { status: 503 },
          );

        const supabaseUrl = process.env.SUPABASE_URL;
        const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
        if (!supabaseUrl || !anonKey)
          return Response.json({ error: "Server not configured" }, { status: 503 });

        const sb = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
        });
        const {
          data: { user },
        } = await sb.auth.getUser();
        if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

        const parsed = Body.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });

        const { data: client } = await supabaseAdmin
          .from("clients")
          .select("id, domain, organization_id")
          .eq("id", parsed.data.clientId)
          .maybeSingle();
        if (!client)
          return Response.json({ ok: false, error: "Client not found" }, { status: 404 });
        if (!(await canRunAudits(user.id, client.organization_id)))
          return Response.json(
            { ok: false, error: "Keine Berechtigung für Audit-Läufe." },
            { status: 403 },
          );
        if (!(await isProviderEnabled(client.id, "google")))
          return Response.json(
            { ok: false, error: "Google-Integration deaktiviert." },
            { status: 403 },
          );

        const target = parsed.data.url || (client.domain ? `https://${client.domain}` : "");
        if (!target)
          return Response.json({ ok: false, error: "Keine URL/Domain." }, { status: 400 });

        const psi = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
        psi.searchParams.set("url", target);
        psi.searchParams.set("key", apiKey);
        psi.searchParams.set("strategy", parsed.data.strategy);
        psi.searchParams.append("category", "performance");

        let json: any;
        try {
          const res = await fetch(psi.toString(), { signal: AbortSignal.timeout(60_000) });
          json = await res.json().catch(() => ({}));
          if (!res.ok)
            return Response.json({
              ok: false,
              error: redact(json?.error?.message || `PSI HTTP ${res.status}`, apiKey),
            });
        } catch (e) {
          return Response.json({ ok: false, error: redact(e, apiKey) });
        }

        const field = json?.loadingExperience?.metrics ?? {};
        const lab = json?.lighthouseResult?.audits ?? {};
        const num = (v: unknown) => (typeof v === "number" ? v : null);
        const metrics = {
          // Field (CrUX) — null when the URL lacks enough real-user data.
          lcp: num(field?.LARGEST_CONTENTFUL_PAINT_MS?.percentile),
          inp: num(field?.INTERACTION_TO_NEXT_PAINT?.percentile),
          cls:
            typeof field?.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile === "number"
              ? field.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100
              : null,
          // Lab fallback (Lighthouse) for LCP/CLS when field data is missing.
          lcpLab: num(lab?.["largest-contentful-paint"]?.numericValue),
          clsLab: num(lab?.["cumulative-layout-shift"]?.numericValue),
          performanceScore:
            typeof json?.lighthouseResult?.categories?.performance?.score === "number"
              ? Math.round(json.lighthouseResult.categories.performance.score * 100)
              : null,
          strategy: parsed.data.strategy,
          url: target,
        };
        const result = { metrics };

        try {
          await supabaseAdmin.from("audit_runs").insert({
            client_id: client.id,
            organization_id: client.organization_id,
            triggered_by: user.id,
            audit_type: "pagespeed",
            status: "succeeded",
            input: { url: target, strategy: parsed.data.strategy },
            result: result as never,
            started_at: new Date().toISOString(),
            finished_at: new Date().toISOString(),
          });
        } catch {
          /* non-fatal */
        }

        return Response.json({ ok: true, ...result });
      },
    },
  },
});
