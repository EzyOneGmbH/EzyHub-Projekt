import { createFileRoute } from "@tanstack/react-router";
import { ScopedAppRoute } from "@/ezy/ScopedAppRoute";

export const Route = createFileRoute("/ezyrank")({
  component: () => <ScopedAppRoute appId="seo" next="/ezyrank" />,
});
