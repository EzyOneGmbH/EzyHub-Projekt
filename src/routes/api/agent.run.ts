import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isProviderEnabled, canRunAudits } from "@/server/integrations.server";

// Bridges the app to the EzyOne Agent Service, which runs real Claude Code
// plugin skills (claude-seo / claude-blog / claude-obsidian) server-side via
// the Claude Agent SDK. Configure AGENT_BASE_URL + AGENT_SHARED_SECRET.

const Body = z.object({
  clientId: z.string().uuid(),
  // a plugin skill name, e.g. "seo-page", "blog-write", "seo-schema"
  skill: z.string().min(2).max(80).optional(),
  // free-text task for the skill; or a raw prompt when no skill is given
  input: z.string().max(20000).optional(),
  prompt: z.string().max(20000).optional(),
  model: z.string().max(80).optional(),
  maxTurns: z.number().int().min(1).max(80).optional(),
  // optional label used only for audit/content bookkeeping
  title: z.string().max(300).optional(),
});

function redact(input: unknown, secrets: Array<string | undefined>): string {
  let s =
    typeof input === "string" ? input : input instanceof Error ? input.message : String(input);
  for (const v of secrets) {
    if (!v || v.length < 4) continue;
    s = s.split(v).join("***REDACTED***");
  }
  s = s.replace(/Bearer\s+[A-Za-z0-9\-_.=]+/gi, "Bearer ***REDACTED***");
  s = s.replace(/sk-ant-[A-Za-z0-9\-_]+/g, "***REDACTED***");
  return s.slice(0, 500);
}

export const Route = createFileRoute("/api/agent/run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const baseUrl = process.env.AGENT_BASE_URL;
        const agentSecret = process.env.AGENT_SHARED_SECRET;
        const secrets = [agentSecret];
        if (!baseUrl || !agentSecret) {
          return Response.json({ error: "Agent service not configured" }, { status: 503 });
        }

        const supabaseUrl = process.env.SUPABASE_URL;
        const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
        if (!supabaseUrl || !anonKey) {
          return Response.json({ error: "Server not configured" }, { status: 503 });
        }

        const authHeader = request.headers.get("authorization") ?? "";
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        const {
          data: { user },
        } = await userClient.auth.getUser();
        if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

        let raw: unknown = {};
        try {
          raw = await request.json();
        } catch {
          /* empty */
        }
        const parsed = Body.safeParse(raw);
        if (!parsed.success) {
          return Response.json(
            { error: "Invalid input", issues: parsed.error.issues },
            { status: 400 },
          );
        }
        const d = parsed.data;
        if (!d.skill && !d.input && !d.prompt) {
          return Response.json(
            { error: "Provide `skill` + `input`, or `prompt`." },
            { status: 400 },
          );
        }

        const { data: client, error: clientErr } = await userClient
          .from("clients")
          .select("id, domain, organization_id")
          .eq("id", d.clientId)
          .maybeSingle();
        if (clientErr || !client) {
          return Response.json({ error: "Client not found or access denied" }, { status: 404 });
        }
        if (!(await canRunAudits(user.id, client.organization_id))) {
          return Response.json(
            { error: "Keine Berechtigung für Audit-Läufe (viewer/read-only)." },
            { status: 403 },
          );
        }
        if (!(await isProviderEnabled(client.id, "anthropic"))) {
          return Response.json(
            { error: "Claude/Anthropic für diesen Kunden deaktiviert." },
            { status: 403 },
          );
        }

        // Forward to the agent service.
        let payload: { ok?: boolean; result?: string; error?: string; costUsd?: number } = {};
        let httpOk = false;
        let errorMsg = "";
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8 * 60 * 1000);
        try {
          const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/run-skill`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${agentSecret}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              skill: d.skill,
              input: d.input,
              prompt: d.prompt,
              model: d.model,
              maxTurns: d.maxTurns,
            }),
            signal: ctrl.signal,
          });
          httpOk = res.ok;
          payload = (await res.json().catch(() => ({}))) as typeof payload;
          if (!res.ok) errorMsg = redact(payload?.error || `HTTP ${res.status}`, secrets);
        } catch (e) {
          errorMsg = redact(e, secrets);
        } finally {
          clearTimeout(t);
        }

        const ok = httpOk && payload?.ok !== false;
        const content = payload?.result ?? "";

        await supabaseAdmin.from("audit_runs").insert({
          client_id: client.id,
          organization_id: client.organization_id,
          triggered_by: user.id,
          audit_type: `skill_${(d.skill ?? "freeform").replace(/[^a-z0-9_-]/gi, "_")}`,
          status: ok && content ? "succeeded" : "failed",
          input: { skill: d.skill ?? null, title: d.title ?? null },
          result: ok ? ({ content, costUsd: payload?.costUsd ?? null } as never) : null,
          error: ok ? null : errorMsg || "Agent-Lauf fehlgeschlagen",
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
        });

        if (!ok) {
          return Response.json(
            { ok: false, error: errorMsg || "Agent-Lauf fehlgeschlagen" },
            { status: 502 },
          );
        }

        return Response.json(
          { ok: true, skill: d.skill ?? null, content, costUsd: payload?.costUsd ?? null },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
