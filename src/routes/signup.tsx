import { createFileRoute, redirect } from "@tanstack/react-router";

// Selbstregistrierung deaktiviert (RBAC 2026-07-15): Mitarbeiter werden
// ausschliesslich vom SuperAdmin/Admin unter "Team" eingeladen. Ohne app_users-
// Zeile hat ein selbst angelegtes Konto ohnehin KEINEN Datenzugriff (RLS).
export const Route = createFileRoute("/signup")({
  beforeLoad: () => {
    throw redirect({ to: "/login" });
  },
});
