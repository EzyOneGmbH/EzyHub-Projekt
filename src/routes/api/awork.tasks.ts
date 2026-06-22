import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { canRunAudits } from "@/server/integrations.server";

// AWORK project tasks — matches a client to an AWORK project by NAME, pulls the
// project's task board (statuses + tasks) and persists audit_runs("awork_tasks").
// Server-only AWORK_API_KEY (admin-level Bearer) never reaches the client.

const Body = z.object({ clientId: z.string().uuid() });
const AWORK_BASE = "https://api.awork.com/api/v1";

type AworkStatus = { id: string; name: string; type?: string; order?: number };

async function awork<T = any>(
  path: string,
  key: string,
): Promise<{ ok: boolean; status: number; data: T | null; text?: string }> {
  const res = await fetch(`${AWORK_BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, status: res.status, data: null, text: text.slice(0, 300) };
  }
  return { ok: true, status: res.status, data: (await res.json().catch(() => null)) as T };
}

// Pick the best project match for a client name: exact (case-insensitive) first,
// then the shortest name that contains it (most specific), else the first result.
function pickProject(projects: any[], clientName: string): any | null {
  if (!projects?.length) return null;
  const cn = clientName.trim().toLowerCase();
  const exact = projects.find(
    (p) =>
      String(p.name || "")
        .trim()
        .toLowerCase() === cn,
  );
  if (exact) return exact;
  // Project name contains the client name, or vice versa (handles "La Campagnola"
  // vs "Hotel La Campagnola"). Shortest match wins (most specific). No blind fallback.
  const matches = projects
    .filter((p) => {
      const pn = String(p.name || "").toLowerCase();
      return pn.includes(cn) || cn.includes(pn);
    })
    .sort((a, b) => String(a.name).length - String(b.name).length);
  return matches[0] || null;
}

export const Route = createFileRoute("/api/awork/tasks")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const supabaseUrl = process.env.SUPABASE_URL!;
          const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!;
          const sb = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: request.headers.get("authorization") ?? "" } },
          });
          const {
            data: { user },
          } = await sb.auth.getUser();
          if (!user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

          const parsed = Body.safeParse(await request.json().catch(() => ({})));
          if (!parsed.success)
            return Response.json({ ok: false, error: "Invalid input" }, { status: 400 });

          const { data: client } = await supabaseAdmin
            .from("clients")
            .select("id, name, organization_id")
            .eq("id", parsed.data.clientId)
            .maybeSingle();
          if (!client) return Response.json({ ok: false, error: "Client not found" });
          const { data: m } = await supabaseAdmin
            .from("app_users")
            .select("role")
            .eq("user_id", user.id)
            .eq("organization_id", client.organization_id)
            .maybeSingle();
          if (!m) return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
          if (!(await canRunAudits(user.id, client.organization_id)))
            return Response.json(
              { ok: false, error: "Keine Berechtigung für Audit-Läufe (viewer/read-only)." },
              { status: 403 },
            );

          const key = process.env.AWORK_API_KEY;
          if (!key) return Response.json({ ok: false, error: "AWORK_API_KEY nicht konfiguriert." });

          const result = await fetchAworkForClient(client.name, key);
          if (result.error) return Response.json({ ok: false, error: result.error });

          const nowIso = () => new Date().toISOString();
          try {
            await supabaseAdmin.from("audit_runs").insert({
              client_id: client.id,
              organization_id: client.organization_id,
              triggered_by: user.id,
              audit_type: "awork_tasks",
              status: "succeeded",
              input: { clientName: client.name },
              result: result as never,
              started_at: nowIso(),
              finished_at: nowIso(),
            });
          } catch {
            /* non-fatal */
          }
          return Response.json({ ok: true, ...result });
        } catch (e) {
          return Response.json({
            ok: false,
            error: String((e as Error)?.message || e).slice(0, 300),
          });
        }
      },
    },
  },
});

// Load all rows of a paginated AWORK collection (projects/companies).
async function loadAll(path: string, key: string): Promise<{ rows: any[]; error?: string }> {
  let rows: any[] = [];
  for (let page = 1; page <= 6; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const r = await awork<any[]>(`${path}${sep}pageSize=1000&page=${page}`, key);
    if (!r.ok) {
      if (page === 1) return { rows: [], error: `HTTP ${r.status}: ${r.text || ""}`.trim() };
      break;
    }
    const batch = r.data || [];
    rows = rows.concat(batch);
    if (batch.length < 1000) break;
  }
  return { rows };
}

const initials = (a: any) =>
  `${String(a?.firstName || a?.name || "").charAt(0)}${String(a?.lastName || "").charAt(0)}`.toUpperCase() ||
  "?";

// AWORK path naming varies (hyphen vs none); try both, take the first that works.
async function firstOk(paths: string[], key: string) {
  let last: Awaited<ReturnType<typeof awork>> | null = null;
  for (const p of paths) {
    const r = await awork<any[]>(p, key);
    if (r.ok) return r;
    last = r;
  }
  return last!;
}

// Fetch one project's statuses + tasks + tasklists and normalize.
async function fetchProjectTasks(projectId: string, projectName: string, key: string) {
  const [stRes, tkRes, listRes] = await Promise.all([
    firstOk([`/projects/${projectId}/taskstatuses`, `/projects/${projectId}/task-statuses`], key),
    firstOk(
      [
        `/projects/${projectId}/projecttasks?pageSize=500`,
        `/projects/${projectId}/project-tasks?pageSize=500`,
      ],
      key,
    ),
    firstOk([`/projects/${projectId}/tasklists`, `/projects/${projectId}/task-lists`], key),
  ]);
  const statuses: AworkStatus[] = (stRes.data || [])
    .map((s: any) => ({
      id: String(s.id),
      name: String(s.name ?? ""),
      type: s.type ?? s.statusType ?? undefined,
      order: Number(s.order ?? 0),
    }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const tasklists = (listRes.data || [])
    .map((l: any) => ({
      id: String(l.id),
      name: String(l.name ?? ""),
      order: Number(l.order ?? 0),
    }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const statusById = new Map(statuses.map((s) => [s.id, s]));
  const tasks = (tkRes.data || []).map((t: any) => {
    const sid = String(t.taskStatusId ?? t.taskStatus?.id ?? "");
    const st = statusById.get(sid);
    const assignees = Array.isArray(t.assignees) ? t.assignees : t.users || [];
    const listId = Array.isArray(t.lists) && t.lists[0] ? String(t.lists[0].id ?? "") : "";
    const listName = Array.isArray(t.lists) && t.lists[0] ? String(t.lists[0].name ?? "") : (t.listName ?? "");
    return {
      id: String(t.id ?? ""),
      name: String(t.name ?? ""),
      project: projectName,
      projectId: projectId,
      statusId: sid,
      statusName: t.taskStatus?.name ?? st?.name ?? "Ohne Status",
      statusType: t.taskStatus?.type ?? st?.type ?? "",
      assignees: assignees.map((a: any) => ({
        id: String(a.id ?? a.userId ?? ""),
        initials: initials(a),
        name: `${a?.firstName ?? ""} ${a?.lastName ?? ""}`.trim() || a?.name || "",
      })),
      dueOn: t.dueOn ?? t.dueDate ?? null,
      isPrio: !!t.isPrio,
      listId,
      list: listName,
      hasSubtasks: t.hasSubtasks || (t.subtasksCount ?? 0) > 0,
      subtasksDoneCount: Number(t.subtasksDoneCount ?? 0),
      subtasksCount: Number(t.subtasksCount ?? 0),
      trackedDuration: Number(t.trackedDuration ?? 0),
      plannedDuration: Number(t.plannedDuration ?? 0),
      commentsCount: Number(t.commentsCount ?? 0),
      parentId: t.parentId || null,
    };
  });
  return {
    statuses,
    tasklists,
    tasks,
    statusesHttp: stRes.ok ? 200 : stRes.status,
    tasksHttp: tkRes.ok ? 200 : tkRes.status,
  };
}

const nameMatch = (a: string, b: string) => {
  const x = String(a || "")
    .trim()
    .toLowerCase();
  const y = String(b || "")
    .trim()
    .toLowerCase();
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

// Exported so the batch job (admin.populate) can reuse the same logic.
// Resolution: AWORK Company by name → its projects; fallback to a project
// whose name matches the client. Tasks are aggregated across the projects.
export async function fetchAworkForClient(clientName: string, key: string) {
  const projRes = await loadAll("/projects", key);
  if (projRes.error) return { error: `AWORK Projekte ${projRes.error}` };
  const allProjects = projRes.rows;

  // 1) Company match → company's projects.
  const compRes = await loadAll("/companies", key);
  const company = (compRes.rows || []).find((co: any) => nameMatch(co.name, clientName)) || null;
  let chosen: any[] = [];
  let scope: { type: "company" | "project"; name: string } | null = null;
  if (company) {
    chosen = allProjects.filter(
      (p) => String(p.companyId ?? p.company?.id ?? "") === String(company.id),
    );
    scope = { type: "company", name: String(company.name) };
  }
  // 2) Fallback: project-name match.
  if (chosen.length === 0) {
    const p = pickProject(allProjects, clientName);
    if (p) {
      chosen = [p];
      scope = { type: "project", name: String(p.name) };
    }
  }
  if (chosen.length === 0)
    return {
      project: null,
      statuses: [] as AworkStatus[],
      tasks: [],
      counts: { total: 0, done: 0 },
      note: `Kein AWORK-Projekt/keine Company zu „${clientName}" gefunden.`,
      _debug: { projectsTotal: allProjects.length, companiesTotal: compRes.rows?.length ?? 0 },
    };

  // Fetch + aggregate tasks across the chosen projects (cap to 10).
  const perProject = await Promise.all(
    chosen.slice(0, 10).map((p) => fetchProjectTasks(String(p.id), String(p.name), key)),
  );
  const tasks = perProject.flatMap((r) => r.tasks);
  // Merge status columns by name, keeping the smallest order seen.
  const statusMap = new Map<string, AworkStatus>();
  for (const r of perProject) {
    for (const s of r.statuses) {
      const ex = statusMap.get(s.name);
      if (!ex || (s.order ?? 0) < (ex.order ?? 0)) statusMap.set(s.name, s);
    }
  }
  const statuses = [...statusMap.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  // Merge tasklists by name
  const tasklistMap = new Map<string, { id: string; name: string; order: number }>();
  for (const r of perProject) {
    for (const l of r.tasklists || []) {
      if (!tasklistMap.has(l.name)) tasklistMap.set(l.name, l);
    }
  }
  const tasklists = [...tasklistMap.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const doneTypes = new Set(["done", "closed", "completed"]);
  const done = tasks.filter((t) => doneTypes.has(String(t.statusType).toLowerCase())).length;

  const projectLabel =
    scope?.type === "company" && chosen.length > 1
      ? `${scope.name} · ${chosen.length} Projekte`
      : (scope?.name ?? "");

  return {
    project: { id: String(chosen[0].id), name: projectLabel },
    projects: chosen.map((p) => ({ id: String(p.id), name: String(p.name) })),
    statuses,
    tasklists,
    tasks,
    counts: { total: tasks.length, done },
    generated_at: new Date().toISOString(),
    _debug: {
      projectsTotal: allProjects.length,
      companiesTotal: compRes.rows?.length ?? 0,
      scope: scope?.type,
      chosen: chosen.length,
      statusesCount: statuses.length,
    },
  };
}
