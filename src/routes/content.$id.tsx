import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/content/$id")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});
