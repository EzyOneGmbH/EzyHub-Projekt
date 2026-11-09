import { createFileRoute } from "@tanstack/react-router";
import { blogKunden } from "@/server/blog-autopilot.server";

// GET /api/blog/clients: Kunden mit freigeschaltetem Blog-Autopiloten, auf die
// die angemeldete Person Zugriff hat, samt Projekt-Stand (Einstieg Onboarding).
export const Route = createFileRoute("/api/blog/clients")({
  server: { handlers: { GET: async ({ request }) => blogKunden(request) } },
});
