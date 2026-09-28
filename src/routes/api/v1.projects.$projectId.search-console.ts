import { createFileRoute } from "@tanstack/react-router";
import { readApiHandler, projektSearchConsole } from "@/server/read-api.server";

// Read-API v1 (ChatGPT, read-only): Search-Console-Daten (gsc_daily), serverseitig aggregiert.
// Auth, Validierung, Mandantentrennung, CORS und Logging: readApiHandler.
export const Route = createFileRoute("/api/v1/projects/$projectId/search-console")({
  server: { handlers: readApiHandler(projektSearchConsole) },
});
