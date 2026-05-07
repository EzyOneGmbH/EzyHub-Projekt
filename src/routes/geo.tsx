import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/geo")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});
