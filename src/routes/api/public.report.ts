import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Teilbare Kunden-Reports (Searchable-Nachbau, 2026-08-03).
// POST  { clientId, days? }  (eingeloggt, owner/admin) -> { url } signierter Link
// GET   ?token=...           (ÖFFENTLICH)              -> Read-only-Reportdaten
// Token = base64url(clientId|exp|hmac) mit ADMIN_AUTOMATION_SECRET signiert —
// kein neues Secret nötig, das Token selbst enthält kein Geheimnis. Ablauf
// Standard 30 Tage. Es werden AUSSCHLIESSLICH aivis-Reportdaten des einen
// Kunden ausgeliefert (kein Org-Kontext, keine Kosten, keine Rohantworten).

const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64u = (s: string) => Buffer.from(s, "base64url").toString("utf8");
const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("base64url");

function makeToken(clientId: string, days: number, secret: string): string {
  const exp = Date.now() + days * 864e5;
  const payload = `${clientId}|${exp}`;
  return b64u(`${payload}|${sign(payload, secret)}`);
}
function verifyToken(token: string, secret: string): string | null {
  try {
    const raw = unb64u(token);
    const i = raw.lastIndexOf("|");
    const payload = raw.slice(0, i);
    const mac = raw.slice(i + 1);
    const want = sign(payload, secret);
    if (mac.length !== want.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
    const [clientId, expStr] = payload.split("|");
    if (!clientId || Number(expStr) < Date.now()) return null;
    return clientId;
  } catch { return null; }
}

async function requireOrgAdmin(request: Request): Promise<{ ok: boolean; status: number; error?: string }> {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return { ok: false, status: 503, error: "Server not configured" };
  const sb = createClient(url, anon, { global: { headers: { Authorization: request.headers.get("authorization") ?? "" } } });
  const { data } = await sb.auth.getUser();
  if (!data.user) return { ok: false, status: 401, error: "Unauthorized" };
  const { data: m } = await sb.from("app_users").select("role").eq("user_id", data.user.id)
    .order("role", { ascending: true }).limit(1).maybeSingle();
  const role = (m?.role as string) || "viewer";
  if (role !== "owner" && role !== "admin") return { ok: false, status: 403, error: "Nur Admins können Report-Links erstellen" };
  return { ok: true, status: 200 };
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
        const days = Math.min(365, Math.max(1, Number(body?.days || 30)));
        const token = makeToken(clientId, days, secret);
        return Response.json({ ok: true, url: `/r/${token}`, days });
      },
      GET: async ({ request }) => {
        const secret = process.env.ADMIN_AUTOMATION_SECRET;
        if (!secret) return Response.json({ ok: false, error: "Server not configured" }, { status: 503 });
        const token = new URL(request.url).searchParams.get("token") || "";
        const clientId = verifyToken(token, secret);
        if (!clientId) return Response.json({ ok: false, error: "Link ungültig oder abgelaufen" }, { status: 401 });
        const sb = supabaseAdmin as any;
        const { data: client } = await sb.from("clients").select("id, name, domain").eq("id", clientId).maybeSingle();
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
    },
  },
});
