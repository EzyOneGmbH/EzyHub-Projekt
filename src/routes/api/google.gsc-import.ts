import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoogleAccessToken } from "@/server/google-tokens.server";
import { redactSecrets } from "@/server/google-oauth.server";
import { canonryUrl } from "@/lib/canonry-url";
import { isProviderEnabled } from "@/server/integrations.server";

const Body = z.object({
  clientId: z.string().uuid(),
  days: z.number().int().min(1).max(90).default(28),
  rowLimit: z.number().int().min(1).max(500).default(50),
});

async function authedUser(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!;
  const authHeader = request.headers.get("authorization") ?? "";
  const sb = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data } = await sb.auth.getUser();
  return data.user;
}

async function requireMember(userId: string, clientId: string, requireAdmin = false) {
  const { data: client } = await supabaseAdmin
    .from("clients").select("id, organization_id, gsc_property, ga4_property, canonry_project")
    .eq("id", clientId).maybeSingle();
  if (!client) return { error: "Client not found", status: 404 as const };
  const { data: m } = await supabaseAdmin
    .from("app_users").select("role")
    .eq("user_id", userId).eq("organization_id", client.organization_id).maybeSingle();
  if (!m) return { error: "Forbidden", status: 403 as const };
  if (requireAdmin && !["owner", "admin"].includes(m.role)) return { error: "Forbidden", status: 403 as const };
  return { client };
}

export const Route = createFileRoute("/api/google/gsc-import")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const user = await authedUser(request);
          if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
          const body = await request.json().catch(() => ({}));
          const parsed = Body.safeParse(body);
          if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });

          const r = await requireMember(user.id, parsed.data.clientId);
          if ("error" in r) return Response.json({ error: r.error }, { status: r.status });
          const client = r.client;
          if (!client.gsc_property) return Response.json({ ok: false, error: "Kein GSC-Property gesetzt." });
          if (!(await isProviderEnabled(client.id, "google"))) return Response.json({ ok: false, error: "Google-Integration für diesen Kunden deaktiviert." }, { status: 403 });

          const { accessToken } = await getGoogleAccessToken(client.id);
          const end = new Date();
          const start = new Date(end);
          start.setDate(end.getDate() - parsed.data.days);
          const fmt = (d: Date) => d.toISOString().slice(0, 10);

          const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(client.gsc_property)}/searchAnalytics/query`;
          const res = await fetch(url, {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              startDate: fmt(start),
              endDate: fmt(end),
              dimensions: ["query"],
              rowLimit: parsed.data.rowLimit,
              orderBy: [{ field: "clicks", descending: true }],
            }),
          });
          if (!res.ok) {
            const t = await res.text().catch(() => "");
            return Response.json({ ok: false, error: redactSecrets(`GSC HTTP ${res.status}: ${t}`) });
          }
          const json = await res.json() as { rows?: Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }> };
          const keywords = (json.rows ?? []).map(r => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }));

          let canonryStatus: { ok: boolean; count?: number; error?: string } = { ok: false, error: "Canonry not configured" };
          const canonryBase = process.env.CANONRY_BASE_URL;
          const canonryKey = process.env.CANONRY_API_KEY;
          if (!(await isProviderEnabled(client.id, "canonry"))) {
            canonryStatus = { ok: false, error: "Canonry für diesen Kunden deaktiviert." };
          } else if (!client.canonry_project) {
            canonryStatus = { ok: false, error: "Kein Canonry-Projekt-Slug gesetzt." };
          } else if (canonryBase && canonryKey && keywords.length > 0) {
            try {
              const cRes = await fetch(canonryUrl(canonryBase, `/projects/${encodeURIComponent(client.canonry_project)}/keywords`), {
                method: "POST",
                headers: { Authorization: `Bearer ${canonryKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ source: "gsc", property: client.gsc_property, keywords: keywords.map(k => ({ query: k.query, metrics: k })) }),
              });
              if (!cRes.ok) {
                const t = await cRes.text().catch(() => "");
                canonryStatus = { ok: false, error: redactSecrets(`Canonry HTTP ${cRes.status}: ${t}`) };
              } else canonryStatus = { ok: true, count: keywords.length };
            } catch (e) { canonryStatus = { ok: false, error: redactSecrets(e) }; }
          }
          return Response.json({ ok: true, imported: keywords.length, sample: keywords.slice(0, 10), canonry: canonryStatus });
        } catch (e) {
          return Response.json({ ok: false, error: redactSecrets(e) });
        }
      },
    },
  },
});
