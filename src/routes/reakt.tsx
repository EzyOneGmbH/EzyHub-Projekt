import { createFileRoute } from "@tanstack/react-router";
import { ScopedAppRoute } from "@/ezy/ScopedAppRoute";

// Interims-App (Phase 3): zeigt die Agent-Läufe der Reaktivierungsmaschine.
// Die echte Reaktivierungs-UI (Waves/Entwürfe/Zeitplan) kommt in Phase 4.
export const Route = createFileRoute("/reakt")({
  component: () => <ScopedAppRoute appId="reakt" next="/reakt" />,
});
