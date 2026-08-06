import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Tech-Stack-Erkennung (06.08.2026, DataForSEO Domain Analytics Technologies):
// GET ?domain=<domain> liefert die auf der Kunden-Website erkannten Technologien
// (CMS, Page-Builder, Server, Analytics …) — fuer Onboarding und Speed-/
// Connector-Empfehlungen (WordPress? Elementor? LiteSpeed?).
// Auth: eingeloggter EzyHub-User oder ADMIN_AUTOMATION_SECRET (Muster llm-traffic).

async function requireUser(request: Request): Promise<true | Response> {
  const admin = process.env.ADMIN_AUTOMATION_SECRET;
  const auth = request.headers.get("authorization") || "";
  if (admin && auth === `Bearer ${admin}`) return true;
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return Response.json({ ok: false, error: "Server not configured" }, { status: 503 });
  const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data } = await userClient.auth.getUser();
  if (!data.user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return true;
}

export const Route = createFileRoute("/api/admin/tech-detect")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth !== true) return auth;
        const u = new URL(request.url);
        const domain = String(u.searchParams.get("domain") || "").trim().toLowerCase()
          .replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
        if (!domain) return Response.json({ ok: false, error: "domain erforderlich" }, { status: 400 });
        const login = process.env.DATAFORSEO_LOGIN, pass = process.env.DATAFORSEO_PASSWORD;
        if (!login || !pass) return Response.json({ ok: false, error: "DataForSEO nicht konfiguriert" }, { status: 503 });
        try {
          const r = await fetch("https://api.dataforseo.com/v3/domain_analytics/technologies/domain_technologies/live", {
            method: "POST",
            headers: {
              Authorization: "Basic " + Buffer.from(`${login}:${pass}`).toString("base64"),
              "Content-Type": "application/json",
            },
            body: JSON.stringify([{ target: domain }]),
            signal: AbortSignal.timeout(30_000),
          });
          const j: any = await r.json().catch(() => ({}));
          const t = j?.tasks?.[0];
          if (j.status_code !== 20000 || !t || t.status_code !== 20000)
            return Response.json({ ok: false, error: `${t?.status_code || j.status_code} ${t?.status_message || ""}`.trim() }, { status: 502 });
          const item = t.result?.[0]?.items?.[0] || {};
          // technologies = { <gruppe>: { <kategorie>: [namen…] } } → flache Liste je Gruppe.
          const groups: Array<{ group: string; items: string[] }> = [];
          for (const [group, cats] of Object.entries(item.technologies || {})) {
            const names = [...new Set(Object.values(cats as Record<string, string[]>).flat())];
            if (names.length) groups.push({ group, items: names });
          }
          return Response.json(
            {
              ok: true, domain, title: item.title || null, description: item.description || null,
              country: item.country_iso_code || null, groups, cost: Number(j.cost || 0),
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch (e: any) {
          return Response.json({ ok: false, error: String(e?.message || e).slice(0, 160) }, { status: 502 });
        }
      },
    },
  },
});
