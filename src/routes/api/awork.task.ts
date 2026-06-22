import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// AWORK single task operations: get details, update status/assignees, comments.

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

// Auth helper: verify user has access to the organization
async function verifyAuth(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!;
  const sb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
  });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 };

  // Get user's organizations
  const { data: memberships } = await supabaseAdmin
    .from("app_users")
    .select("organization_id, role")
    .eq("user_id", user.id);

  if (!memberships?.length) return { error: "No organization access", status: 403 };

  return { user, memberships };
}

const TaskIdParam = z.object({ taskId: z.string().min(1) });

const UpdateTaskBody = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  taskStatusId: z.string().optional(),
  dueOn: z.string().nullable().optional(),
  assigneeIds: z.array(z.string()).optional(),
});

const CommentBody = z.object({
  message: z.string().min(1),
});

export const Route = createFileRoute("/api/awork/task")({
  server: {
    handlers: {
      // GET /api/awork/task?taskId=xxx - Get task details with comments
      GET: async ({ request }) => {
        try {
          const auth = await verifyAuth(request);
          if ("error" in auth) return Response.json({ ok: false, error: auth.error }, { status: auth.status });

          const url = new URL(request.url);
          const taskId = url.searchParams.get("taskId");
          if (!taskId) return Response.json({ ok: false, error: "taskId required" }, { status: 400 });

          const key = process.env.AWORK_API_KEY;
          if (!key) return Response.json({ ok: false, error: "AWORK_API_KEY nicht konfiguriert" });

          // Fetch task details and comments in parallel
          const [taskRes, commentsRes] = await Promise.all([
            aworkFetch<any>(`/tasks/${taskId}`, key),
            aworkFetch<any[]>(`/tasks/${taskId}/comments`, key),
          ]);

          if (!taskRes.ok) {
            return Response.json({ ok: false, error: `Task nicht gefunden: ${taskRes.error}` }, { status: taskRes.status });
          }

          const task = taskRes.data;
          const comments = (commentsRes.data || []).map((c: any) => ({
            id: c.id,
            message: c.message || "",
            createdOn: c.createdOn,
            createdBy: c.createdBy ? {
              id: c.createdBy.id,
              name: `${c.createdBy.firstName || ""} ${c.createdBy.lastName || ""}`.trim(),
              initials: `${(c.createdBy.firstName || "")[0] || ""}${(c.createdBy.lastName || "")[0] || ""}`.toUpperCase(),
            } : null,
          }));

          // Get checklist items
          const checklistRes = await aworkFetch<any[]>(`/tasks/${taskId}/checklistitems`, key);
          const checklist = (checklistRes.data || []).map((item: any) => ({
            id: item.id,
            name: item.name,
            isDone: item.isDone || false,
            order: item.order || 0,
          }));

          // Get tags
          const tagsRes = await aworkFetch<any[]>(`/tasks/${taskId}/tags`, key);
          const tags = (tagsRes.data || []).map((t: any) => ({
            id: t.id,
            name: t.name,
            color: t.color,
          }));

          return Response.json({
            ok: true,
            task: {
              id: task.id,
              name: task.name,
              description: task.description || "",
              taskStatusId: task.taskStatusId,
              taskStatus: task.taskStatus ? {
                id: task.taskStatus.id,
                name: task.taskStatus.name,
                type: task.taskStatus.type,
              } : null,
              projectId: task.projectId,
              project: task.project ? { id: task.project.id, name: task.project.name } : null,
              dueOn: task.dueOn,
              isPrio: task.isPrio || false,
              assignees: (task.assignees || []).map((a: any) => ({
                id: a.id || a.userId,
                name: `${a.firstName || ""} ${a.lastName || ""}`.trim(),
                initials: `${(a.firstName || "")[0] || ""}${(a.lastName || "")[0] || ""}`.toUpperCase(),
              })),
              createdOn: task.createdOn,
              updatedOn: task.updatedOn,
              list: task.lists?.[0]?.name || "",
              checklist,
              tags,
            },
            comments,
          });
        } catch (e) {
          return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 });
        }
      },

      // PUT /api/awork/task?taskId=xxx - Update task
      PUT: async ({ request }) => {
        try {
          const auth = await verifyAuth(request);
          if ("error" in auth) return Response.json({ ok: false, error: auth.error }, { status: auth.status });

          const url = new URL(request.url);
          const taskId = url.searchParams.get("taskId");
          if (!taskId) return Response.json({ ok: false, error: "taskId required" }, { status: 400 });

          const body = await request.json().catch(() => ({}));
          const parsed = UpdateTaskBody.safeParse(body);
          if (!parsed.success) return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });

          const key = process.env.AWORK_API_KEY;
          if (!key) return Response.json({ ok: false, error: "AWORK_API_KEY nicht konfiguriert" });

          const wantsFieldUpdate =
            parsed.data.name !== undefined ||
            parsed.data.description !== undefined ||
            parsed.data.taskStatusId !== undefined ||
            parsed.data.dueOn !== undefined;

          // AWORK's PUT /tasks/{id} is a full replace: it requires `name`. Fetch the
          // current task first and merge so partial updates (e.g. status only) don't
          // fail with "The Name field is required."
          if (wantsFieldUpdate) {
            const currentRes = await aworkFetch<any>(`/tasks/${taskId}`, key);
            if (!currentRes.ok || !currentRes.data) {
              return Response.json({ ok: false, error: `Task nicht gefunden: ${currentRes.error}` }, { status: currentRes.status });
            }
            const cur = currentRes.data;
            const updates: any = {
              name: parsed.data.name !== undefined ? parsed.data.name : cur.name,
              description: parsed.data.description !== undefined ? parsed.data.description : cur.description,
              taskStatusId: parsed.data.taskStatusId !== undefined ? parsed.data.taskStatusId : cur.taskStatusId,
              dueOn: parsed.data.dueOn !== undefined ? parsed.data.dueOn : cur.dueOn,
              baseType: cur.baseType,
              entityId: cur.entityId,
              typeOfWorkId: cur.typeOfWorkId,
              isPrio: cur.isPrio,
            };
            const updateRes = await aworkFetch(`/tasks/${taskId}`, key, { method: "PUT", body: updates });
            if (!updateRes.ok) {
              return Response.json({ ok: false, error: `Update fehlgeschlagen: ${updateRes.error}` }, { status: updateRes.status });
            }
          }

          // Update assignees if provided — AWORK uses a single "setassignees"
          // endpoint that takes a bare array of user UUIDs and replaces the list.
          if (parsed.data.assigneeIds !== undefined) {
            const asgRes = await aworkFetch(`/tasks/${taskId}/setassignees`, key, {
              method: "POST",
              body: parsed.data.assigneeIds,
            });
            if (!asgRes.ok) {
              return Response.json({ ok: false, error: `Zuweisung fehlgeschlagen: ${asgRes.error}` }, { status: asgRes.status });
            }
          }

          return Response.json({ ok: true });
        } catch (e) {
          return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 });
        }
      },

      // POST /api/awork/task?taskId=xxx&action=comment - Add comment
      POST: async ({ request }) => {
        try {
          const auth = await verifyAuth(request);
          if ("error" in auth) return Response.json({ ok: false, error: auth.error }, { status: auth.status });

          const url = new URL(request.url);
          const taskId = url.searchParams.get("taskId");
          const action = url.searchParams.get("action");

          if (!taskId) return Response.json({ ok: false, error: "taskId required" }, { status: 400 });

          const key = process.env.AWORK_API_KEY;
          if (!key) return Response.json({ ok: false, error: "AWORK_API_KEY nicht konfiguriert" });

          const body = await request.json().catch(() => ({}));

          if (action === "comment") {
            const parsed = CommentBody.safeParse(body);
            if (!parsed.success) return Response.json({ ok: false, error: "message required" }, { status: 400 });

            const commentRes = await aworkFetch(`/tasks/${taskId}/comments`, key, {
              method: "POST",
              body: { message: `<p>${parsed.data.message}</p>` },
            });

            if (!commentRes.ok) {
              return Response.json({ ok: false, error: `Kommentar fehlgeschlagen: ${commentRes.error}` }, { status: commentRes.status });
            }

            return Response.json({ ok: true, comment: commentRes.data });
          }

          if (action === "checklist") {
            const name = body.name;
            if (!name) return Response.json({ ok: false, error: "name required" }, { status: 400 });

            const res = await aworkFetch(`/tasks/${taskId}/checklistitems`, key, {
              method: "POST",
              body: { name, isDone: false },
            });

            if (!res.ok) {
              return Response.json({ ok: false, error: `Checklist fehlgeschlagen: ${res.error}` }, { status: res.status });
            }

            return Response.json({ ok: true, item: res.data });
          }

          if (action === "checklist-toggle") {
            const itemId = body.itemId;
            const isDone = body.isDone;
            if (!itemId) return Response.json({ ok: false, error: "itemId required" }, { status: 400 });

            const res = await aworkFetch(`/tasks/${taskId}/checklistitems/${itemId}`, key, {
              method: "PUT",
              body: { isDone },
            });

            if (!res.ok) {
              return Response.json({ ok: false, error: `Toggle fehlgeschlagen: ${res.error}` }, { status: res.status });
            }

            return Response.json({ ok: true });
          }

          return Response.json({ ok: false, error: "Unknown action" }, { status: 400 });
        } catch (e) {
          return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 });
        }
      },
    },
  },
});
