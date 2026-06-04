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
  // Ownership: which side is responsible for inserting audit_runs.
  // Server routes that already persist must set this to true so the client
  // does not create duplicate audit_runs entries.
  let serverPersists = false;

  // Tools backed by real Claude Code plugin skills, routed through the agent service.
  const TOOL_SKILL: Record<string, string> = {
    "generate-blog": "blog-write",
    "blog-outline": "blog-outline",
    "content-brief": "seo-content-brief",
    "schema-markup": "seo-schema",
  };
  const agentSkill = TOOL_SKILL[toolId];
  if (agentSkill) {
    const lang = inputs.language || "Deutsch";
    let skillInput = "";
    switch (toolId) {
      case "generate-blog":
        skillInput = `Schreibe einen vollständigen, SEO- und GEO-optimierten Blog-Artikel.\nThema/Keyword: ${inputs.topic || ""}\nTonalität: ${inputs.tone || "Professionell"}\nLänge: ${inputs.length || "Standard"}\nSprache: ${lang}`;
        break;
      case "blog-outline":
        skillInput = `Erstelle eine detaillierte Artikel-Gliederung (H1/H2/H3 + FAQ).\nThema: ${inputs.topic || ""}\nKeywords:\n${inputs.keywords || ""}\nSprache: ${lang}`;
        break;
      case "content-brief":
        skillInput = `Erstelle ein SEO-Content-Brief.\nThema/Keyword: ${inputs.topic || ""}\nZielgruppe: ${inputs.audience || "nicht angegeben"}\nSprache: ${lang}`;
        break;
      case "schema-markup":
        skillInput = `Erzeuge valides Schema.org JSON-LD.\nSchema-Typ: ${inputs.schemaType || "Article"}\nAngaben:\n${inputs.content || ""}`;
        break;
    }
    path = `/api/agent/run`;
    init = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: client.id,
        skill: agentSkill,
        input: skillInput,
        title: inputs.topic || inputs.title || null,
      }),
    };
    auditType = `skill_${agentSkill}`;
    serverPersists = true;
  }

  if (!agentSkill) switch (toolId) {
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
      auditType = "ahrefs";
      serverPersists = true;
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
    case "generate-blog":
      path = `/api/ai/generate`;
      init = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: client.id,
          kind: "blog",
          topic: inputs.topic || "",
          tone: inputs.tone || "Professionell",
          length: inputs.length || "",
          language: inputs.language || "Deutsch",
        }),
      };
      auditType = "content_blog";
      serverPersists = true;
      break;
    case "obsidian-note":
      path = `/api/ai/generate`;
      init = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: client.id,
          kind: "obsidian",
          title: inputs.title || "",
          content: inputs.content || "",
          tags: inputs.tags || "",
        }),
      };
      auditType = "content_note";
      serverPersists = true;
      break;
    case "content-brief":
      path = `/api/ai/generate`;
      init = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: client.id,
          kind: "content-brief",
          topic: inputs.topic || "",
          audience: inputs.audience || "",
          language: inputs.language || "Deutsch",
        }),
      };
      auditType = "content_brief";
      serverPersists = true;
      break;
    case "blog-outline":
      path = `/api/ai/generate`;
      init = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: client.id,
          kind: "outline",
          topic: inputs.topic || "",
          keywords: inputs.keywords || "",
          language: inputs.language || "Deutsch",
        }),
      };
      auditType = "content_outline";
      serverPersists = true;
      break;
    case "meta-tags":
      path = `/api/ai/generate`;
      init = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: client.id,
          kind: "meta",
          topic: inputs.topic || "",
          keyword: inputs.keyword || "",
          language: inputs.language || "Deutsch",
        }),
      };
      auditType = "content_meta";
      serverPersists = true;
      break;
    case "schema-markup":
      path = `/api/ai/generate`;
      init = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: client.id,
          kind: "schema",
          schemaType: inputs.schemaType || "Article",
          content: inputs.content || "",
        }),
      };
      auditType = "content_schema";
      serverPersists = true;
      break;
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

  // Detect Ahrefs all-failed / rate-limited even on HTTP 200.
  let partial = false;
  let effectiveOk = httpOk;
  if (httpOk && payload && typeof payload === "object" && "errors" in payload) {
    const errs = (payload as any).errors || {};
    const sections = Object.values(errs);
    const allFailed = sections.length > 0 && sections.every((e) => e !== null && e !== undefined);
    const anyFailed = sections.some((e) => e !== null && e !== undefined);
    if (allFailed) {
      effectiveOk = false;
      errorMsg = (payload as any).rate_limited
        ? "Ahrefs rate limit"
        : "Alle Ahrefs-Sektionen fehlgeschlagen";
    } else if (anyFailed) {
      partial = true;
    }
  }

  // Persist audit_run only when the server route does not already do so.
  if (!serverPersists) {
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
          status: effectiveOk ? "succeeded" : "failed",
          input: { toolId, inputs },
          result: effectiveOk ? payload : null,
          error: effectiveOk ? null : errorMsg,
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
        } as any);
      }
    } catch {
      /* non-fatal */
    }
  }

  return {
    ok: effectiveOk,
    liveConnected: true,
    message: effectiveOk
      ? partial
        ? "Live-Lauf teilweise erfolgreich"
        : "Live-Lauf abgeschlossen"
      : errorMsg || "Fehler beim Live-Lauf",
    data: payload,
    error: effectiveOk ? undefined : errorMsg,
    score: null,
  };
}
