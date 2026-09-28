import { createFileRoute } from "@tanstack/react-router";
import { readApiHandler, projektVisibility } from "@/server/read-api.server";

// Read-API v1 (ChatGPT, read-only): Sichtbarkeits-Kennzahlen je Tag (RPC visibility_daily).
// Auth, Validierung, Mandantentrennung, CORS und Logging: readApiHandler.
export const Route = createFileRoute("/api/v1/projects/$projectId/visibility")({
  server: { handlers: readApiHandler(projektVisibility) },
});
