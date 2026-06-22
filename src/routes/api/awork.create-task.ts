import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// AWORK create new task

const AWORK_BASE = "https://api.awork.com/api/v1";

async function aworkFetch<T = any>(
  path: string,
  key: string,
  options?: { method?: string; body?: any }
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  const res = await fetch(`${AWORK_BASE}${path}`, {
    method: options?.method || "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, status: res.status, data: null, error: text.slice(0, 300) };
  }
  const data = await res.json().catch(() => null);
  return { ok: true, status: res.status, data: data as T };
}

const CreateTaskBody = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  taskStatusId: z.string().optional(),
  dueOn: z.string().nullable().optional(),
  assigneeIds: z.array(z.string()).optional(),
  listId: z.string().optional(),
  isPrio: z.boolean().optional(),
});

export const Route = createFileRoute("/api/awork/create-task")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const supabaseUrl = process.env.SUPABASE_URL!;
          const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!;
          const sb = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
          });
          const { data: { user } } = await sb.auth.getUser();
          if (!user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

          const body = await request.json().catch(() => ({}));
          const parsed = CreateTaskBody.safeParse(body);
          if (!parsed.success) {
            return Response.json({ ok: false, error: "Invalid input", details: parsed.error.issues }, { status: 400 });
          }

          const key = process.env.AWORK_API_KEY;
          if (!key) return Response.json({ ok: false, error: "AWORK_API_KEY nicht konfiguriert" });

          // Get default status if not provided
          let taskStatusId = parsed.data.taskStatusId;
          if (!taskStatusId) {
            const statusRes = await aworkFetch<any[]>(`/projects/${parsed.data.projectId}/taskstatuses`, key);
            const statuses = statusRes.data || [];
            const defaultStatus = statuses.find((s: any) => s.type === "todo" || s.order === 0) || statuses[0];
            taskStatusId = defaultStatus?.id;
          }

          // Create the task
          const taskBody: any = {
            name: parsed.data.name,
            projectId: parsed.data.projectId,
            taskStatusId,
          };

          if (parsed.data.description) taskBody.description = parsed.data.description;
          if (parsed.data.dueOn) taskBody.dueOn = parsed.data.dueOn;
          if (parsed.data.isPrio) taskBody.isPrio = true;
          if (parsed.data.listId) taskBody.lists = [{ id: parsed.data.listId }];

          const createRes = await aworkFetch<any>("/tasks", key, { method: "POST", body: taskBody });
          if (!createRes.ok) {
            return Response.json({ ok: false, error: `Task erstellen fehlgeschlagen: ${createRes.error}` }, { status: createRes.status });
          }

          const task = createRes.data;

          // Add assignees if provided
          if (parsed.data.assigneeIds?.length) {
            for (const userId of parsed.data.assigneeIds) {
              await aworkFetch(`/tasks/${task.id}/users/${userId}`, key, { method: "POST" });
            }
          }

          return Response.json({
            ok: true,
            task: {
              id: task.id,
              name: task.name,
              projectId: task.projectId,
            },
          });
        } catch (e) {
          return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 });
        }
      },
    },
  },
});
