import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Client-Context fuer die Zero-Input-Discovery (Global-Aktivierung 2026-07-15):
// liefert je Kunde alles, was EzyHub schon weiss — der agent-service holt es
// hier ab statt selbst auf Google zuzugreifen. KEINE neuen Google-Calls:
// domain aus der GSC-Property (autoritativ, Fallback clients.domain),
// brandTerms aus clients.brand_terms (Fallback Domain-Stamm),
// gscTopNonbrandQueries aus der letzten gsc_queries-Zeile (bereits nonbrand-
// klassifiziert), hasGa4 aus ga4_traffic-Praesenz. Secret-gated, read-only.

function normDomain(s: string): string {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/^sc-domain:/, "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

function slugifyName(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const Route = createFileRoute("/api/admin/client-context")({
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

        const { data: clients } = await supabaseAdmin
          .from("clients")
          .select("id, name, domain, brand_terms, client_type, gsc_property");
        const { data: runs } = await supabaseAdmin
          .from("audit_runs")
          .select("client_id, audit_type, result, created_at")
          .in("audit_type", ["gsc_queries", "ga4_traffic"])
          .eq("status", "succeeded")
          .order("created_at", { ascending: false });

        const latestByClient: Record<string, { gsc?: any; ga4?: boolean }> = {};
        for (const r of runs || []) {
          const e = (latestByClient[(r as any).client_id] ??= {});
          if ((r as any).audit_type === "gsc_queries" && !e.gsc) e.gsc = (r as any).result;
          if ((r as any).audit_type === "ga4_traffic") e.ga4 = true;
        }

        const out = (clients || []).map((c: any) => {
          const slug = slugifyName(c.name);
          const domainFromGsc = normDomain(c.gsc_property || "");
          const domain = domainFromGsc || normDomain(c.domain || "");
          const stem = domain.split(".")[0] || slug;
          const brandTerms =
            Array.isArray(c.brand_terms) && c.brand_terms.length
              ? c.brand_terms
              : [...new Set([stem.replace(/-/g, " "), stem.replace(/-/g, ""), stem])].filter(
                  Boolean,
                );
          const ctx = latestByClient[c.id] || {};
          const gscTopNonbrandQueries = (ctx.gsc?.topNonbrandQueries || [])
            .map((q: any) => ({
              query: String(q.query || ""),
              clicks: Number(q.clicks || 0),
              impressions: Number(q.impressions || 0),
            }))
            .filter((q: any) => q.query);
          return {
            slug,
            name: c.name,
            domain: domain || null,
            domainSource: domainFromGsc ? "gsc-property" : c.domain ? "clients-config" : "none",
            brandTerms,
            brandTermsSource:
              Array.isArray(c.brand_terms) && c.brand_terms.length ? "clients" : "fallback",
            clientType: c.client_type || "generic",
            gscTopNonbrandQueries,
            hasGa4: !!ctx.ga4,
          };
        });
        return Response.json({ ok: true, clients: out });
      },
    },
  },
});
