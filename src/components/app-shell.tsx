import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/customers", label: "Kunden", icon: Users },
  { to: "/content", label: "Inhalte", icon: FileText },
  { to: "/tasks", label: "Aufgaben", icon: ListTodo },
  { to: "/assistant", label: "KI-Assistent", icon: Bot },
  { to: "/settings", label: "Einstellungen", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { session, loading, isAdmin, signOut, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/login" });
  }, [loading, session, navigate]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Lädt...</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-60 flex-col border-r border-border bg-sidebar p-4 md:flex">
        <Link to="/dashboard" className="flex items-center gap-2 px-2 py-2 font-bold text-sidebar-foreground">
          <Sparkles className="h-5 w-5 text-primary" />
          EZY ONE TOOL
        </Link>

        <nav className="mt-6 flex-1 space-y-1">
          {navItems.map((item) => {
            const active = location.pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
          {isAdmin && (
            <Link
              to="/admin/users"
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                location.pathname.startsWith("/admin")
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent"
              )}
            >
              <Shield className="h-4 w-4" />
              Admin
            </Link>
          )}
        </nav>

        <div className="mt-4 border-t border-sidebar-border pt-4">
          <div className="mb-2 truncate px-3 text-xs text-muted-foreground">{user?.email}</div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={async () => {
              await signOut();
              navigate({ to: "/" });
            }}
          >
            <LogOut className="mr-2 h-4 w-4" /> Abmelden
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl p-6">{children}</div>
      </main>
    </div>
  );
}
