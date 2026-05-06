import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, ListTodo, AlertCircle, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const [stats, setStats] = useState({ customers: 0, openTasks: 0, dueTasks: 0, doneTasks: 0 });

  useEffect(() => {
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [c, o, d, done] = await Promise.all([
        supabase.from("customers").select("id", { count: "exact", head: true }),
        supabase.from("tasks").select("id", { count: "exact", head: true }).neq("status", "done"),
        supabase.from("tasks").select("id", { count: "exact", head: true }).lte("due_date", today).neq("status", "done"),
        supabase.from("tasks").select("id", { count: "exact", head: true }).eq("status", "done"),
      ]);
      setStats({
        customers: c.count ?? 0,
        openTasks: o.count ?? 0,
        dueTasks: d.count ?? 0,
        doneTasks: done.count ?? 0,
      });
    })();
  }, []);

  const cards = [
    { label: "Kunden", value: stats.customers, icon: Users, link: "/customers" },
    { label: "Offene Aufgaben", value: stats.openTasks, icon: ListTodo, link: "/tasks" },
    { label: "Fällig", value: stats.dueTasks, icon: AlertCircle, link: "/tasks" },
    { label: "Erledigt", value: stats.doneTasks, icon: CheckCircle2, link: "/tasks" },
  ];

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Übersicht deines Teams</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.label} to={c.link}>
            <Card className="transition-colors hover:border-primary">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle>
                <c.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-foreground">{c.value}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
