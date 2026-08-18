import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { makeReportToken, verifyReportToken, reportTokenHash } from "@/server/report-token.server";

// Teilbare Kunden-Reports (Searchable-Nachbau, 2026-08-03).
// POST  { clientId, days? }  (eingeloggt, owner/admin) -> { url } signierter Link
// GET   ?token=...           (ÖFFENTLICH)              -> Read-only-Reportdaten
// Token = base64url(clientId|exp|hmac) mit ADMIN_AUTOMATION_SECRET signiert —
// kein neues Secret nötig, das Token selbst enthält kein Geheimnis. Ablauf
// Standard 30 Tage. Es werden AUSSCHLIESSLICH aivis-Reportdaten des einen
// Kunden ausgeliefert (kein Org-Kontext, keine Kosten, keine Rohantworten).

async function requireOrgAdmin(request: Request): Promise<{ ok: true; userId: string; organizationId: string } | { ok: false; status: number; error: string }> {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return { ok: false, status: 503, error: "Server not configured" };
  const sb = createClient(url, anon, { global: { headers: { Authorization: request.headers.get("authorization") ?? "" } } });
  const { data } = await sb.auth.getUser();
  if (!data.user) return { ok: false, status: 401, error: "Unauthorized" };
  const { data: m } = await (supabaseAdmin as any).from("app_users").select("role, organization_id").eq("user_id", data.user.id)
    .order("role", { ascending: true }).limit(1).maybeSingle();
  const role = (m?.role as string) || "viewer";
  if ((role !== "owner" && role !== "admin") || !m?.organization_id)
    return { ok: false, status: 403, error: "Nur Admins können Report-Links erstellen" };
  return { ok: true, userId: data.user.id, organizationId: m.organization_id as string };
}

export const Route = createFileRoute("/api/public/report")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret) return Response.json({ ok: false, error: "Server not configured" }, { status: 503 });
        const gate = await requireOrgAdmin(request);
        if (!gate.ok) return Response.json({ ok: false, error: gate.error }, { status: gate.status });
        let body: any; try { body = await request.json(); } catch { body = {}; }
        const clientId = String(body?.clientId || "");
        if (!/^[0-9a-f-]{36}$/i.test(clientId)) return Response.json({ ok: false, error: "clientId ungültig" }, { status: 400 });
        // Cross-Tenant-Sperre (18.08.): der Kunde MUSS zur Organisation des
        // anfragenden Admins gehoeren — IDs aus dem Request wird nie vertraut.
        const { data: own } = await (supabaseAdmin as any).from("clients").select("id")
          .eq("id", clientId).eq("organization_id", gate.organizationId).maybeSingle();
        if (!own) return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });
        const days = Math.min(365, Math.max(1, Number(body?.days || 30)));
        const token = makeReportToken(clientId, gate.organizationId, days, secret);
        // Audit + Widerrufbarkeit: nur der Token-HASH wird gespeichert.
        const { error: insErr } = await (supabaseAdmin as any).from("public_report_links").insert({
          organization_id: gate.organizationId, client_id: clientId,
          token_hash: reportTokenHash(token), created_by: gate.userId,
          expires_at: new Date(Date.now() + days * 864e5).toISOString(),
        });
        if (insErr) return Response.json({ ok: false, error: insErr.message }, { status: 500 });
        return Response.json({ ok: true, url: `/r/${token}`, days });
      },
      GET: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret) return Response.json({ ok: false, error: "Server not configured" }, { status: 503 });
        const token = new URL(request.url).searchParams.get("token") || "";
        const claims = verifyReportToken(token, secret);
        if (!claims) return Response.json({ ok: false, error: "Link ungültig oder abgelaufen" }, { status: 401 });
        const clientId = claims.clientId;
        const sb = supabaseAdmin as any;
        // Registry: Link muss existieren, unwiderrufen und unabgelaufen sein.
        const { data: link } = await sb.from("public_report_links").select("id, revoked_at, expires_at")
          .eq("token_hash", reportTokenHash(token)).eq("organization_id", claims.organizationId)
          .eq("client_id", clientId).maybeSingle();
        if (!link || link.revoked_at || new Date(link.expires_at).getTime() < Date.now())
          return Response.json({ ok: false, error: "Link ungültig oder widerrufen" }, { status: 401 });
        // Org-Bindung: der Kunde muss zur signierten Organisation gehoeren.
        const { data: client } = await sb.from("clients").select("id, name, domain")
          .eq("id", clientId).eq("organization_id", claims.organizationId).maybeSingle();
        if (!client) return Response.json({ ok: false, error: "Kunde nicht gefunden" }, { status: 404 });
        const { data: rep } = await sb.from("ai_visibility_reports").select("*")
          .eq("client_id", clientId).order("snapshot_date", { ascending: false }).limit(1).maybeSingle();
        if (!rep) return Response.json({ ok: false, error: "Noch kein Report vorhanden" }, { status: 404 });
        const [models, topics, sources, history, sov] = await Promise.all([
          sb.from("ai_visibility_models").select("*").eq("report_id", rep.id),
          sb.from("ai_visibility_topics").select("*").eq("report_id", rep.id).order("visibility", { ascending: false }).limit(30),
          sb.from("ai_visibility_sources").select("domain, mentions, share, urls").eq("report_id", rep.id).order("mentions", { ascending: false }).limit(30),
          sb.from("ai_visibility_reports").select("snapshot_date, score, mentions, citations, cited_pages")
            .eq("client_id", clientId).order("snapshot_date", { ascending: true }).limit(400),
          sb.from("ai_visibility_sov").select("brand, is_self, mentions, share").eq("report_id", rep.id).order("share", { ascending: false }).limit(10),
        ]);
        // Bewusst NICHT ausgeliefert: Prompt-Antworttexte, Attribution/Umsätze,
        // Marken-Check-Rohbefunde, Kosten — der Link ist ein Ergebnis-Report.
        return Response.json({
          ok: true,
          client: client.name, domain: client.domain,
          date: rep.snapshot_date, score: rep.score, scoreDelta: rep.score_delta,
          mentions: rep.mentions, citations: rep.citations, citedPages: rep.cited_pages,
          models: (models.data || []).map((m: any) => ({ name: m.name, mentions: m.mentions, layer: m.layer })),
          topics: (topics.data || []).map((t: any) => ({ topic: t.topic, vis: t.visibility, mentions: t.mentions })),
          sources: sources.data || [],
          sov: (sov.data || []).map((s: any) => ({ brand: s.brand, isSelf: !!s.is_self, share: s.share })),
          history: (history.data || []).map((h: any) => ({ d: h.snapshot_date, score: h.score, mentions: h.mentions, citations: h.citations })),
        }, { headers: { "Cache-Control": "no-store" } });
      },
      // Widerruf (18.08.): Admin der Organisation macht einen geteilten Link ungueltig.
      DELETE: async ({ request }) => {
        const gate = await requireOrgAdmin(request);
        if (!gate.ok) return Response.json({ ok: false, error: gate.error }, { status: gate.status });
        const body: any = await request.json().catch(() => ({}));
        const linkId = String(body?.linkId || "");
        const clientId = String(body?.clientId || "");
        let q = (supabaseAdmin as any).from("public_report_links")
          .update({ revoked_at: new Date().toISOString() })
          .eq("organization_id", gate.organizationId).is("revoked_at", null);
        if (/^[0-9a-f-]{36}$/i.test(linkId)) q = q.eq("id", linkId);
        else if (/^[0-9a-f-]{36}$/i.test(clientId)) q = q.eq("client_id", clientId);
        else return Response.json({ ok: false, error: "linkId oder clientId erforderlich" }, { status: 400 });
        const { data, error } = await q.select("id");
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        return Response.json({ ok: true, widerrufen: (data ?? []).length });
      },
    },
  },
});
