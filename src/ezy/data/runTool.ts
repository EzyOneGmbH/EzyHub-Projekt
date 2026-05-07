import { ezyFetch } from "./api";
import { supabase } from "@/integrations/supabase/client";
import { toolProvider } from "./useEzyToolSettings";

export type ToolRunResult = {
  ok: boolean;
  liveConnected: boolean;
  message: string;
  data?: unknown;
  error?: string;
  score?: number | null;
};

/**
 * Execute a tool live against the real backend.
 * If the tool has no real backend route, returns liveConnected=false.
 * On success, persists an audit_runs row.
 */
export async function executeTool(
  toolId: string,
  client: { id: string; domain?: string; name?: string },
  inputs: Record<string, string>,
): Promise<ToolRunResult> {
  const provider = toolProvider(toolId);
  if (!provider) {
    return {
      ok: false,
      liveConnected: false,
      message: "Noch nicht live verbunden",
    };
  }

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(client.id),
  );
  if (!isUuid) {
    return {
      ok: false,
      liveConnected: false,
      message: "Kunde ohne gültige ID — Live-Lauf nicht möglich",
    };
  }

  let path = "";
  let init: RequestInit = { method: "GET" };
  let auditType = "seo";

  switch (toolId) {
    case "canonry":
      // NOTE: this is a read-only overview, not a real sweep.
      path = `/api/live/canonry/overview?clientId=${encodeURIComponent(client.id)}`;
      init = { method: "GET" };
      auditType = "geo_overview";
      break;
    case "open-seo-audit":
    case "full-seo-audit":
    case "technical-audit":
    case "on-page-audit":
      path = `/api/ahrefs/overview`;
      init = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id }),
      };
      auditType = "seo";
      break;
    case "geo-aeo-audit": {
      const q = inputs.queries || inputs.url || client.domain || "";
      path = `/api/perplexity/search`;
      init = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id, query: q, model: "sonar" }),
      };
      auditType = "geo";
      break;
    }
    default:
      return { ok: false, liveConnected: false, message: "Noch nicht live verbunden" };
  }

  let payload: any = null;
  let httpOk = false;
  let errorMsg = "";
  try {
    const res = await ezyFetch(path, init);
    httpOk = res.ok;
    payload = await res.json().catch(() => ({}));
    if (!res.ok) errorMsg = payload?.error || `HTTP ${res.status}`;
  } catch (e: any) {
    errorMsg = e?.message || String(e);
  }

  // Persist audit run (overview reads stored as geo_overview, not as a sweep)
  try {
    const { data: userRes } = await supabase.auth.getUser();
    const { data: clientRow } = await supabase
      .from("clients")
      .select("organization_id")
      .eq("id", client.id)
      .maybeSingle();
    if (userRes?.user && clientRow?.organization_id) {
      await supabase.from("audit_runs").insert({
        organization_id: clientRow.organization_id,
        client_id: client.id,
        triggered_by: userRes.user.id,
        audit_type: auditType,
        status: httpOk ? "succeeded" : "failed",
        input: { toolId, inputs },
        result: httpOk ? payload : null,
        error: httpOk ? null : errorMsg,
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      } as any);
    }
  } catch {
    /* non-fatal */
  }

  return {
    ok: httpOk,
    liveConnected: true,
    message: httpOk ? "Live-Lauf abgeschlossen" : errorMsg || "Fehler beim Live-Lauf",
    data: payload,
    error: httpOk ? undefined : errorMsg,
    score: null,
  };
}
