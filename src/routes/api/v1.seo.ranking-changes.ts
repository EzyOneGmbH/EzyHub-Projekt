import { createFileRoute } from "@tanstack/react-router";
import { readApiHandler, globaleRankingChanges } from "@/server/read-api.server";

// Read-API v1 (ChatGPT, read-only): Ranking-Veraenderungen ueber ALLE Projekte der Organisation des Tokens.
// Auth, Validierung, Mandantentrennung, CORS und Logging: readApiHandler.
export const Route = createFileRoute("/api/v1/seo/ranking-changes")({
  server: { handlers: readApiHandler(globaleRankingChanges) },
});
