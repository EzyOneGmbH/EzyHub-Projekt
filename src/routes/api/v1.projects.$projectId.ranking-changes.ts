import { createFileRoute } from "@tanstack/react-router";
import { readApiHandler, projektRankingChanges } from "@/server/read-api.server";

// Read-API v1 (ChatGPT, read-only): Ranking-Veraenderungen eines Projekts (RPC rank_changes).
// Auth, Validierung, Mandantentrennung, CORS und Logging: readApiHandler.
export const Route = createFileRoute("/api/v1/projects/$projectId/ranking-changes")({
  server: { handlers: readApiHandler(projektRankingChanges) },
});
