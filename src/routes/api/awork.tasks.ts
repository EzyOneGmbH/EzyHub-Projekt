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

// Exported so the batch job (admin.populate) can reuse the same logic.
export async function fetchAworkForClient(clientName: string, key: string) {
  // 1) Load projects (paginated) and match by name client-side. AWORK's
  // filterby syntax is finicky, so we filter locally for robustness.
  let allProjects: any[] = [];
  for (let page = 1; page <= 5; page++) {
    const pr = await awork<any[]>(`/projects?pageSize=1000&page=${page}`, key);
    if (!pr.ok) {
      if (page === 1) return { error: `AWORK Projekte HTTP ${pr.status}: ${pr.text || ""}`.trim() };
      break;
    }
    const batch = pr.data || [];
    allProjects = allProjects.concat(batch);
    if (batch.length < 1000) break;
  }
  const project = pickProject(allProjects, clientName);
  if (!project)
    return {
      project: null,
      statuses: [] as AworkStatus[],
      tasks: [],
      counts: { total: 0, done: 0 },
      note: `Kein AWORK-Projekt zu „${clientName}" gefunden.`,
    };

  // 2) Status columns (ordered) + 3) tasks — in parallel.
  const [stRes, tkRes] = await Promise.all([
    awork<any[]>(`/projects/${project.id}/task-statuses`, key),
    awork<any[]>(`/projects/${project.id}/project-tasks?pageSize=500`, key),
  ]);

  const statuses: AworkStatus[] = (stRes.data || [])
    .map((s: any) => ({
      id: String(s.id),
      name: String(s.name ?? ""),
      type: s.type ?? s.statusType ?? undefined,
      order: Number(s.order ?? 0),
    }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const statusById = new Map(statuses.map((s) => [s.id, s]));

  const initials = (a: any) =>
    `${String(a?.firstName || a?.name || "").charAt(0)}${String(a?.lastName || "").charAt(0)}`.toUpperCase() ||
    "?";

  const tasks = (tkRes.data || []).map((t: any) => {
    const sid = String(t.taskStatusId ?? t.taskStatus?.id ?? "");
    const st = statusById.get(sid);
    const assignees = Array.isArray(t.assignees) ? t.assignees : t.users || [];
    return {
      id: String(t.id ?? ""),
      name: String(t.name ?? ""),
      statusId: sid,
      statusName: t.taskStatus?.name ?? st?.name ?? "Ohne Status",
      statusType: t.taskStatus?.type ?? st?.type ?? "",
      assignees: assignees.map((a: any) => ({
        initials: initials(a),
        name: `${a?.firstName ?? ""} ${a?.lastName ?? ""}`.trim() || a?.name || "",
      })),
      dueOn: t.dueOn ?? t.dueDate ?? null,
      isPrio: !!t.isPrio,
      list: Array.isArray(t.lists) ? (t.lists[0]?.name ?? "") : (t.listName ?? ""),
    };
  });

  const doneTypes = new Set(["done", "closed", "completed"]);
  const done = tasks.filter((t) => doneTypes.has(String(t.statusType).toLowerCase())).length;

  return {
    project: { id: String(project.id), name: String(project.name) },
    statuses,
    tasks,
    counts: { total: tasks.length, done },
    generated_at: new Date().toISOString(),
    _debug: {
      projectsTotal: allProjects.length,
      statusesHttp: stRes.ok ? 200 : stRes.status,
      statusesCount: statuses.length,
      tasksHttp: tkRes.ok ? 200 : tkRes.status,
      tasksErr: tkRes.ok ? null : tkRes.text || null,
      tasksRaw: Array.isArray(tkRes.data) ? tkRes.data.length : `non-array:${typeof tkRes.data}`,
    },
  };
}
