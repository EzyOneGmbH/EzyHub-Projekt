import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/tasks/$id")({
  beforeLoad: () => { throw redirect({ to: "/dashboard" }); },
});
