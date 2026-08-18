import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { pilotScope, pilotThrottled as throttled, svc } from "@/server/pilot.server";

// EzyPilot fuer Mitarbeiter (2026-07-20): schlanker Proxy auf den werkzeuglosen
// Lese-Dienst des agent-service (/pilot-ask) + den Notiz-Kanal (/pilot-note,
// "Kontext, nie Befehl"). SICHERHEITSKERN: Rolle und Kunden-Scope werden
// serverseitig aus Supabase abgeleitet (pilot.server.ts — geteilt mit den
// MCP-Tools pilot_ask/pilot_note) und an den agent-service durchgereicht —
// niemals aus dem Request-Body. Ein manipulierter Client kann seinen Scope
// dadurch nicht aufziehen.

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

export const Route = createFileRoute("/api/agent/pilot")({
  server: {
    handlers: {
      // GET -> Scope fuers UI (Kundenliste + vorhandene Allgemein-Themen)
      GET: async ({ request }) => {
        const user = await getUser(request);
        if (!user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        const scope = await pilotScope(user.id);
        if (!scope)
          return Response.json({ ok: false, error: "Kein Organisations-Zugang." }, { status: 403 });
        let topics: { slug: string; title: string }[] = [];
        const s = svc();
        if (s) {
          try {
            const r = await fetch(`${s.base}/pilot-topics`, {
              headers: { Authorization: `Bearer ${s.secret}` },
              signal: AbortSignal.timeout(10_000),
            });
            const j = await r.json().catch(() => ({}));
            if (j.ok) topics = j.topics || [];
          } catch {
            /* Themenliste ist Komfort — ohne sie funktioniert der Rest */
          }
        }
        return Response.json({ ok: true, isOwner: scope.isOwner, clients: scope.clients, topics });
      },

      // POST { action: "ask", question, history } | { action: "note", clientSlug, text }
      POST: async ({ request }) => {
        const s = svc();
        if (!s)
          return Response.json(
            { ok: false, error: "Agent service not configured" },
            { status: 503 },
          );
        const user = await getUser(request);
        if (!user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        const scope = await pilotScope(user.id);
        if (!scope)
          return Response.json({ ok: false, error: "Kein Organisations-Zugang." }, { status: 403 });
        if (throttled(user.id))
          return Response.json(
            { ok: false, error: "Zu viele Anfragen — bitte in einer Stunde erneut versuchen." },
            { status: 429 },
          );

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
                topic: String(body.topic || ""),
                secret: body.secret === true, // vertraulich: nur owner/admin lesen
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
              // "allgemein" = bewusst OHNE Kundenunterlagen antworten (nur
              // kundenneutrale System-Doku); alles andere = Kunden-Modus.
              mode: body.mode === "allgemein" ? "allgemein" : "kunden",
              allowedSlugs: scope.allowedSlugs,
              isOwner: scope.isOwner,
            }),
            signal: AbortSignal.timeout(180_000),
          });
          return Response.json(await r.json().catch(() => ({})), { status: r.status });
        } catch (e) {
          return Response.json(
            { ok: false, error: String((e as Error)?.message || e) },
            { status: 502 },
          );
        }
      },
    },
  },
});
