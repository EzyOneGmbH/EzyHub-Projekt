import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, ListTodo, AlertCircle, FileText, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const [stats, setStats] = useState({ customers: 0, openTasks: 0, dueTasks: 0, content: 0 });
  const [recent, setRecent] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [c, o, d, ci, rec] = await Promise.all([
        supabase.from("customers").select("id", { count: "exact", head: true }),
        supabase.from("tasks").select("id", { count: "exact", head: true }).neq("status", "done"),
        supabase.from("tasks").select("id", { count: "exact", head: true }).lte("due_date", today).neq("status", "done"),
        supabase.from("content_items").select("id", { count: "exact", head: true }),
        supabase.from("content_items").select("id,title,status,updated_at").order("updated_at", { ascending: false }).limit(5),
      ]);
      setStats({
        customers: c.count ?? 0,
        openTasks: o.count ?? 0,
        dueTasks: d.count ?? 0,
        content: ci.count ?? 0,
      });
      setRecent(rec.data ?? []);
    })();
  }, []);

  const cards = [
    { label: "Kunden", value: stats.customers, icon: Users, link: "/customers", accent: "from-primary/30 to-transparent" },
    { label: "Inhalte", value: stats.content, icon: FileText, link: "/content", accent: "from-accent/30 to-transparent" },
    { label: "Offene Aufgaben", value: stats.openTasks, icon: ListTodo, link: "/tasks", accent: "from-warning/30 to-transparent" },
    { label: "Fällig heute", value: stats.dueTasks, icon: AlertCircle, link: "/tasks", accent: "from-destructive/30 to-transparent" },
  ];

  return (
    <AppShell>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Deine SEO &amp; GEO Kommandozentrale.</p>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.label} to={c.link}>
            <Card className="group relative overflow-hidden transition-all hover:border-primary/60 hover:shadow-[var(--shadow-elegant)]">
              <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${c.accent} opacity-60`} />
              <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{c.label}</CardTitle>
                <c.icon className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent className="relative">
                <div className="text-4xl font-bold">{c.value}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Letzte Inhalte</h2>
          <Link to="/content" className="flex items-center gap-1 text-sm text-primary hover:underline">
            Alle <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Inhalte.</p>
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-3">
                <Link to="/content/$id" params={{ id: r.id }} className="truncate hover:text-primary">
                  {r.title}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {r.status} · {new Date(r.updated_at).toLocaleDateString("de-DE")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AppShell>
  );
}
