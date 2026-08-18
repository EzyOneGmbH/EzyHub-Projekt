import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  MAX_AGE_DAYS,
  isAuthorized,
  parseStaleMinutes,
  withConnected,
  type ClaudeSessionRow,
} from "@/server/claude-sessions";

// Heartbeat-Registry fuer Remote-Claude-Code-Sessions (iPhone-Widget).
// POST: eine Session meldet sich (Hook in der Claude-Code-Umgebung, siehe
//       scripts/claude-session-heartbeat.mjs).
// GET:  das Scriptable-Widget liest, welche Sessions verbunden sind.
// Auth fuer beides: Bearer CLAUDE_SESSIONS_TOKEN (Deployment-Env, kein User-Login,
// damit das Widget ohne Supabase-Session auskommt). Tabelle ist RLS-dicht; Zugriff
// ausschliesslich hier ueber die Service-Role.

const HeartbeatBody = z.object({
  session_id: z.string().min(8).max(200),
  label: z.string().max(200).optional(),
  source: z.string().max(100).optional(),
  status: z.enum(["active", "ended"]).optional(),
});

function adminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

function unauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

export const Route = createFileRoute("/api/claude-sessions")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (
          !isAuthorized(request.headers.get("authorization"), process.env.CLAUDE_SESSIONS_TOKEN)
        ) {
          return unauthorized();
        }
        const supabase = adminClient();
        if (!supabase) return Response.json({ error: "Server not configured" }, { status: 503 });

        const staleMinutes = parseStaleMinutes(
          new URL(request.url).searchParams.get("stale_minutes"),
        );
        const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
        const { data, error } = await supabase
          .from("claude_sessions")
          .select("session_id, label, source, status, started_at, last_seen_at")
          .gte("last_seen_at", cutoff)
          .order("last_seen_at", { ascending: false })
          .limit(50);
        if (error) {
          // z.B. Migration noch nicht angewendet — sauber degradieren statt 500.
          return Response.json({ error: "claude_sessions not available" }, { status: 503 });
        }

        const sessions = withConnected(
          (data ?? []) as ClaudeSessionRow[],
          Date.now(),
          staleMinutes,
        );
        return new Response(
          JSON.stringify({
            generated_at: new Date().toISOString(),
            stale_minutes: staleMinutes,
            connected_count: sessions.filter((s) => s.connected).length,
            sessions,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          },
        );
      },

      POST: async ({ request }) => {
        if (
          !isAuthorized(request.headers.get("authorization"), process.env.CLAUDE_SESSIONS_TOKEN)
        ) {
          return unauthorized();
        }
        const supabase = adminClient();
        if (!supabase) return Response.json({ error: "Server not configured" }, { status: 503 });

        const parsed = HeartbeatBody.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json({ error: "Invalid body" }, { status: 400 });
        }
        const { session_id, label, source, status } = parsed.data;

        const { error } = await supabase.from("claude_sessions").upsert(
          {
            session_id,
            ...(label !== undefined ? { label } : {}),
            ...(source !== undefined ? { source } : {}),
            status: status ?? "active",
            last_seen_at: new Date().toISOString(),
          },
          { onConflict: "session_id" },
        );
        if (error) {
          return Response.json({ error: "claude_sessions not available" }, { status: 503 });
        }
        return Response.json({ ok: true });
      },
    },
  },
});
