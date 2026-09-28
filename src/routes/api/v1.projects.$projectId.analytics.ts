import { createFileRoute } from "@tanstack/react-router";
import { readApiHandler, projektAnalytics } from "@/server/read-api.server";

// Read-API v1 (ChatGPT, read-only): GA4-Landingpage-Daten (ga4_landing_daily), aggregiert nach Datum oder Landingpage.
// Auth, Validierung, Mandantentrennung, CORS und Logging: readApiHandler.
export const Route = createFileRoute("/api/v1/projects/$projectId/analytics")({
  server: { handlers: readApiHandler(projektAnalytics) },
});
