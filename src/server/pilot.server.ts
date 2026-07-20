import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Geteilte EzyPilot-Serverlogik (2026-07-20): wird vom Web-Proxy
// (/api/agent/pilot) UND den MCP-Tools (pilot_ask/pilot_note) genutzt, damit
// beide Oberflaechen denselben Scope rechnen. SICHERHEITSKERN unveraendert:
// Rolle + Kunden-Slugs kommen serverseitig aus app_users/client_access —
// niemals vom Client/Modell.

// Gleiche Slug-Ableitung wie admin.client-context (Kundenname -> Vault-Ordner).
export function slugifyName(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function svc() {
  const base = process.env.AGENT_BASE_URL;
  const secret = process.env.AGENT_SHARED_SECRET;
  return base && secret ? { base: base.replace(/\/+$/, ""), secret } : null;
}

export type PilotScope = {
  isOwner: boolean;
  role: string;
  clients: { id: string; name: string; slug: string }[];
  allowedSlugs: string[];
};

/** Scope des Aufrufers: Rolle + zugewiesene Kunden (id/name/slug). */
export async function pilotScope(userId: string): Promise<PilotScope | null> {
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
// Gilt ueber beide Oberflaechen (Web + MCP) gemeinsam.
const RATE_MAX = 30;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const rateLog = new Map<string, number[]>();
export function pilotThrottled(userId: string): boolean {
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

/** Frage an den werkzeuglosen Lese-Dienst des agent-service. */
export async function pilotAskUpstream(opts: {
  question: string;
  history?: { role: string; content: string }[];
  mode?: string;
  scope: PilotScope;
}) {
  const s = svc();
  if (!s) return { ok: false, error: "Agent service not configured", status: 503 };
  const r = await fetch(`${s.base}/pilot-ask`, {
    method: "POST",
    headers: { Authorization: `Bearer ${s.secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      question: opts.question,
      history: (opts.history || []).slice(-12),
      mode: opts.mode === "allgemein" ? "allgemein" : "kunden",
      allowedSlugs: opts.scope.allowedSlugs,
      isOwner: opts.scope.isOwner,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}

/** Notiz an den append-only Notiz-Kanal des agent-service. */
export async function pilotNoteUpstream(opts: {
  clientSlug: string;
  text: string;
  topic?: string;
  author: string;
  scope: PilotScope;
}) {
  const s = svc();
  if (!s) return { ok: false, error: "Agent service not configured", status: 503 };
  const r = await fetch(`${s.base}/pilot-note`, {
    method: "POST",
    headers: { Authorization: `Bearer ${s.secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      clientSlug: opts.clientSlug,
      text: opts.text,
      topic: opts.topic || "",
      author: opts.author,
      allowedSlugs: opts.scope.allowedSlugs,
      isOwner: opts.scope.isOwner,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}
