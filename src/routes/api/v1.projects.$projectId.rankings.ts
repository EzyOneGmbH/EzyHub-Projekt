import { createFileRoute } from "@tanstack/react-router";
import { readApiHandler, projektRankings } from "@/server/read-api.server";

// Read-API v1 (ChatGPT, read-only): Tages-Rankings eines Projekts inkl. previous_position/change.
// Auth, Validierung, Mandantentrennung, CORS und Logging: readApiHandler.
export const Route = createFileRoute("/api/v1/projects/$projectId/rankings")({
  server: { handlers: readApiHandler(projektRankings) },
});
