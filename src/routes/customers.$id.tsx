import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/customers/$id")({
  beforeLoad: () => { throw redirect({ to: "/dashboard" }); },
});
