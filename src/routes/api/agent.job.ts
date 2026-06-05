import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Polls an async agent job and finalizes its audit_runs row when the job completes.
// The client only sends the runId; the jobId is read from the stored run (so a user
// can never finalize another org's run — RLS gates the SELECT).

const Query = z.object({ runId: z.string().uuid() });

function redact(input: unknown, secrets: Array<string | undefined>): string {
  let s =
    typeof input === "string" ? input : input instanceof Error ? input.message : String(input);
  for (const v of secrets) {
    if (!v || v.length < 4) continue;
    s = s.split(v).join("***REDACTED***");
  }
  s = s.replace(/Bearer\s+[A-Za-z0-9\-_.=]+/gi, "Bearer ***REDACTED***");
  return s.slice(0, 500);
}

export const Route = createFileRoute("/api/agent/job")({
  server: {
    handlers: {
      GET: async ({ request }) => {
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

        const url = new URL(request.url);
        const parsed = Query.safeParse({ runId: url.searchParams.get("runId") ?? "" });
        if (!parsed.success) {
          return Response.json({ error: "runId is required" }, { status: 400 });
        }
        const { runId } = parsed.data;

        const authHeader = request.headers.get("authorization") ?? "";
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        const {
          data: { user },
        } = await userClient.auth.getUser();
        if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

        // RLS-scoped read: only returns the row if the user is a member of its org.
        const { data: run } = await userClient
          .from("audit_runs")
          .select("id, status, result, error, input")
          .eq("id", runId)
          .maybeSingle();
        if (!run) {
          return Response.json({ error: "Run not found or access denied" }, { status: 404 });
        }

        // Already finalized → return stored result.
        if (run.status !== "running") {
          const stored = (run.result ?? {}) as { content?: string; costUsd?: number };
          return Response.json({
            ok: run.status === "succeeded",
            status: run.status === "succeeded" ? "done" : "error",
            content: stored.content ?? "",
            costUsd: stored.costUsd ?? null,
            error: run.error ?? null,
          });
        }

        const jobId = (run.input as { jobId?: string } | null)?.jobId;
        if (!jobId) {
          return Response.json({ error: "Run has no job reference" }, { status: 409 });
        }

        // Poll the agent service.
        let job: {
          status?: string;
          result?: string;
          costUsd?: number;
          error?: string;
        } = {};
        try {
          const res = await fetch(
            `${baseUrl.replace(/\/+$/, "")}/jobs?id=${encodeURIComponent(jobId)}`,
            {
              headers: { Authorization: `Bearer ${agentSecret}` },
              signal: AbortSignal.timeout(20_000),
            },
          );
          job = (await res.json().catch(() => ({}))) as typeof job;
          if (res.status === 404) {
            // job expired/lost on the agent → mark the run failed so it doesn't hang forever
            await supabaseAdmin
              .from("audit_runs")
              .update({
                status: "failed",
                error: "Agent-Job nicht mehr verfügbar (abgelaufen/Neustart).",
                finished_at: new Date().toISOString(),
              })
              .eq("id", runId);
            return Response.json({ ok: false, status: "error", error: "Job expired" });
          }
        } catch (e) {
          // transient: let the client keep polling
          return Response.json({ ok: true, status: "running", transient: redact(e, secrets) });
        }

        if (job.status === "running") {
          return Response.json({ ok: true, status: "running" });
        }

        // Finalize.
        if (job.status === "done") {
          const content = job.result ?? "";
          const costUsd = typeof job.costUsd === "number" ? job.costUsd : null;
          await supabaseAdmin
            .from("audit_runs")
            .update({
              status: "succeeded",
              result: { content, costUsd } as never,
              finished_at: new Date().toISOString(),
            })
            .eq("id", runId);
          return Response.json({ ok: true, status: "done", content, costUsd });
        }

        // error
        const errMsg = redact(job.error || "Agent-Lauf fehlgeschlagen", secrets);
        await supabaseAdmin
          .from("audit_runs")
          .update({ status: "failed", error: errMsg, finished_at: new Date().toISOString() })
          .eq("id", runId);
        return Response.json({ ok: false, status: "error", error: errMsg });
      },
    },
  },
});
