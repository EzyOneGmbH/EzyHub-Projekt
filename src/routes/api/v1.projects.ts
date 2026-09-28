import { createFileRoute } from "@tanstack/react-router";
import { readApiHandler, listeProjekte } from "@/server/read-api.server";

// Read-API v1 (ChatGPT, read-only): Projektliste der Organisation des Tokens (Kunden, ohne metadata).
// Auth, Validierung, Mandantentrennung, CORS und Logging: readApiHandler.
export const Route = createFileRoute("/api/v1/projects")({
  server: { handlers: readApiHandler(listeProjekte) },
});
