import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// EzyPilot fuer Mitarbeiter (2026-07-20): schlanker Proxy auf den werkzeuglosen
// Lese-Dienst des agent-service (/pilot-ask) + den Notiz-Kanal (/pilot-note,
// "Kontext, nie Befehl"). SICHERHEITSKERN: Rolle und Kunden-Scope werden HIER
// serverseitig aus Supabase abgeleitet (app_users.role + client_access) und an
// den agent-service durchgereicht — niemals aus dem Request-Body. Ein
// manipulierter Client kann seinen Scope dadurch nicht aufziehen.

// Gleiche Slug-Ableitung wie admin.client-context (Kundenname -> Vault-Ordner).
function slugifyName(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function getUser(request: Request) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  const sb = createClient(url, anon, {
    global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
  });
  const { data } = await sb.auth.getUser();
  return data.user;
}

function svc() {
  const base = process.env.AGENT_BASE_URL;
  const secret = process.env.AGENT_SHARED_SECRET;
  return base && secret ? { base: base.replace(/\/+$/, ""), secret } : null;
}

// Scope des Aufrufers: Rolle + zugewiesene Kunden (id/name/slug).
async function pilotScope(userId: string) {
  const { data: me } = await supabaseAdmin
    .from("app_users")
    .select("organization_id, role")
    .eq("user_id", userId)
    .maybeSingle();
  const orgId = (me as any)?.organization_id as string | undefined;
  if (!orgId) return null;
  const role = String((me as any)?.role || "");
  const isOwner = role === "owner" || role === "admin";

  let clientIds: string[] | null = null; // null = alle (owner/admin)
  if (!isOwner) {
    const { data: access } = await supabaseAdmin
      .from("client_access")
      .select("client_id")
      .eq("user_id", userId)
      .eq("organization_id", orgId);
    clientIds = (access || []).map((a: any) => a.client_id);
  }

  let q = supabaseAdmin.from("clients").select("id, name");
  if (clientIds) q = clientIds.length ? q.in("id", clientIds) : q.in("id", ["00000000-0000-0000-0000-000000000000"]);
  const { data: clients } = await q;
  const list = (clients || []).map((c: any) => ({ id: c.id, name: c.name, slug: slugifyName(c.name) }));
  return { isOwner, role, clients: list, allowedSlugs: list.map((c) => c.slug) };
}

// Einfache Drossel pro Nutzer (In-Memory, pro Server-Instanz): 30 Aktionen/Std.
const RATE_MAX = 30;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const rateLog = new Map<string, number[]>();
function throttled(userId: string): boolean {
  const now = Date.now();
  const hits = (rateLog.get(userId) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX) {
    rateLog.set(userId, hits);
    return true;
  }
  hits.push(now);
  rateLog.set(userId, hits);
  return false;
}

export const Route = createFileRoute("/api/agent/pilot")({
  server: {
    handlers: {
      // GET -> Scope fuers UI (Kundenliste fuer den Notiz-Dialog)
      GET: async ({ request }) => {
        const user = await getUser(request);
        if (!user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        const scope = await pilotScope(user.id);
        if (!scope) return Response.json({ ok: false, error: "Kein Organisations-Zugang." }, { status: 403 });
        return Response.json({ ok: true, isOwner: scope.isOwner, clients: scope.clients });
      },

      // POST { action: "ask", question, history } | { action: "note", clientSlug, text }
      POST: async ({ request }) => {
        const s = svc();
        if (!s) return Response.json({ ok: false, error: "Agent service not configured" }, { status: 503 });
        const user = await getUser(request);
        if (!user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        const scope = await pilotScope(user.id);
        if (!scope) return Response.json({ ok: false, error: "Kein Organisations-Zugang." }, { status: 403 });
        if (throttled(user.id))
          return Response.json({ ok: false, error: "Zu viele Anfragen — bitte in einer Stunde erneut versuchen." }, { status: 429 });

        const body = await request.json().catch(() => ({}));
        const headers = { Authorization: `Bearer ${s.secret}`, "Content-Type": "application/json" };

        try {
          if (body.action === "note") {
            const r = await fetch(`${s.base}/pilot-note`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                clientSlug: String(body.clientSlug || ""),
                text: String(body.text || ""),
                author: user.email || user.id,
                allowedSlugs: scope.allowedSlugs,
                isOwner: scope.isOwner,
              }),
              signal: AbortSignal.timeout(20_000),
            });
            return Response.json(await r.json().catch(() => ({})), { status: r.status });
          }

          // Default: Frage beantworten (kann durch die 2 Modell-Paesse dauern).
          const r = await fetch(`${s.base}/pilot-ask`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              question: String(body.question || ""),
              history: Array.isArray(body.history) ? body.history.slice(-12) : [],
              allowedSlugs: scope.allowedSlugs,
              isOwner: scope.isOwner,
            }),
            signal: AbortSignal.timeout(180_000),
          });
          return Response.json(await r.json().catch(() => ({})), { status: r.status });
        } catch (e) {
          return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 502 });
        }
      },
    },
  },
});
