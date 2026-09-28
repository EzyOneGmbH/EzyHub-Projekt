import { createFileRoute } from "@tanstack/react-router";
import { readApiOpenApi } from "@/server/read-api-openapi";
import { CORS_HEADER } from "@/server/read-api.server";

// Read-API v1: OpenAPI-3.1-Spezifikation (oeffentlich, enthaelt keine Daten).
// Direkt als ChatGPT-«Custom GPT Action» importierbar.
const methodeNichtErlaubt = async () =>
  Response.json(
    { error: { code: "method_not_allowed", message: "Only GET is supported." } },
    { status: 405, headers: { ...CORS_HEADER, Allow: "GET, OPTIONS" } },
  );

export const Route = createFileRoute("/api/v1/openapi.json")({
  server: {
    handlers: {
      GET: async () =>
        Response.json(readApiOpenApi(), {
          headers: { ...CORS_HEADER, "Cache-Control": "public, max-age=300" },
        }),
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADER }),
      ANY: methodeNichtErlaubt,
    },
  },
});
