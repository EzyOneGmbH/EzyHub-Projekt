import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { useAuth, type OrgRole } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

type Props = {
  roles: OrgRole[];
  children: ReactNode;
  /** if true, only org admins (owner/admin) pass — shorthand */
  adminOnly?: boolean;
};

/**
 * Wrap any UI that requires specific organization roles.
 * Shows a clear "no permission" screen otherwise.
 * Assumes the surrounding AppShell has already enforced auth.
 */
export function RequireRole({ roles, children, adminOnly }: Props) {
  const { role, loading } = useAuth();
  const allowed = adminOnly ? ["owner", "admin"] : roles;

  if (loading) return null;

  if (!role) {
    return <NoAccess title="Kein Organisations-Zugang" message="Dein Konto gehört noch zu keiner Organisation. Bitte wende dich an einen Administrator." />;
  }

  if (!allowed.includes(role)) {
    return (
      <NoAccess
        title="Keine Berechtigung"
        message={`Diese Seite erfordert eine der Rollen: ${allowed.join(", ")}. Deine aktuelle Rolle: ${role}.`}
      />
    );
  }

  return <>{children}</>;
}

function NoAccess({ title, message }: { title: string; message: string }) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
        <ShieldAlert className="h-6 w-6 text-destructive" />
      </div>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      <Button asChild className="mt-6" variant="outline">
        <Link to="/dashboard">Zum Dashboard</Link>
      </Button>
    </div>
  );
}
