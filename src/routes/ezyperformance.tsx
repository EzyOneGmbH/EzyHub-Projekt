import { createFileRoute } from "@tanstack/react-router";
import { ScopedAppRoute } from "@/ezy/ScopedAppRoute";

export const Route = createFileRoute("/ezyperformance")({
  component: () => <ScopedAppRoute appId="ads" next="/ezyperformance" />,
});
