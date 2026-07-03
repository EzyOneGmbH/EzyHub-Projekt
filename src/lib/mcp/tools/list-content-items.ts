import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_content_items",
  title: "List content items",
  description:
    "List content items (Blogposts, Landingpages, GEO-Einträge, Erfolge, Notes, Reports, …) the signed-in user can access. Optionally filter by client_id or content_type.",
  inputSchema: {
    clientId: z.string().uuid().optional().describe("Filter to a single client."),
    type: z
      .enum(["blog", "landing", "geo", "social", "other", "audit", "note", "report", "win"])
      .optional()
      .describe("Filter by content_type."),
    limit: z.number().int().min(1).max(200).optional().describe("Max rows (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ clientId, type, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    let q = sb
      .from("content_items")
      .select("id, client_id, type, title, status, updated_at")
      .order("updated_at", { ascending: false })
      .limit(limit ?? 50);
    if (clientId) q = q.eq("client_id", clientId);
    if (type) q = q.eq("type", type);
    const { data, error } = await q;
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { items: data ?? [] },
    };
  },
});
