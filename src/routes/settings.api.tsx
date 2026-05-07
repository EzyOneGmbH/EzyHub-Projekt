import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/settings/api")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});
