import { createFileRoute } from "@tanstack/react-router";
import { ScopedAppRoute } from "@/ezy/ScopedAppRoute";

export const Route = createFileRoute("/admin")({
  component: () => <ScopedAppRoute appId="admin" next="/admin" />,
});
