import { createFileRoute } from "@tanstack/react-router";

// First-Party GEO (EzyAI): Stub — wird vom GEO-Paket gefuellt.
export const Route = createFileRoute("/api/kpi/first-party-geo")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({ ok: false, error: "noch nicht implementiert" }, { status: 501 }),
    },
  },
});
