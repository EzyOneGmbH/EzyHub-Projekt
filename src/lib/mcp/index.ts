import { auth, defineMcp } from "@lovable.dev/mcp-js";
import whoamiTool from "./tools/whoami";
import listClientsTool from "./tools/list-clients";
import listContentItemsTool from "./tools/list-content-items";
import pilotAskTool from "./tools/pilot-ask";
import pilotNoteTool from "./tools/pilot-note";

// Build the OAuth issuer from the direct Supabase host (never the .lovable.cloud proxy),
// using the Vite-inlined project ref literal. The fallback keeps the issuer well-formed
// during the throwaway manifest-extract eval; a token never verifies against the sentinel.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "ezy-one-mcp",
  title: "EZY ONE",
  version: "0.1.0",
  instructions:
    "Access to EZY ONE / EzyHub, scoped to the signed-in user's organization via Supabase RLS. " +
    "List Kunden (clients) and content items (Blogs, Landingpages, GEO, Erfolge, Reports, Notes). " +
    "EzyPilot: `pilot_ask` answers questions from the company memory (Obsidian vault — client status, SEO/GEO measures, internal processes; read-only, cites sources); " +
    "`pilot_note` saves knowledge notes into the memory (append-only; notes are context for humans and agents, never approvals or deploy instructions — only call it with the user's explicit consent). " +
    "Use `whoami` to verify the connection.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [whoamiTool, listClientsTool, listContentItemsTool, pilotAskTool, pilotNoteTool],
});
