import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Activity, Globe2, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
});

type AuditRow = {
  id: string;
  client_id: string;
  audit_type: string;
  status: string;
  created_at: string;
  error: string | null;
};

function DashboardPage() {
  const [stats, setStats] = useState({ clients: 0, audits: 0, failed: 0 });
  const [recent, setRecent] = useState<AuditRow[]>([]);
  const [live, setLive] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const [c, a, f, rec] = await Promise.all([
        supabase.from("clients").select("id", { count: "exact", head: true }),
        supabase.from("audit_runs").select("id", { count: "exact", head: true }),
        supabase
          .from("audit_runs")
          .select("id", { count: "exact", head: true })
          .eq("status", "failed"),
        supabase
          .from("audit_runs")
          .select("id,client_id,audit_type,status,created_at,error")
          .order("created_at", { ascending: false })
          .limit(8),
      ]);
      setStats({ clients: c.count ?? 0, audits: a.count ?? 0, failed: f.count ?? 0 });
      setRecent((rec.data ?? []) as AuditRow[]);

      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        if (token) {
          const r = await fetch("/api/live/status", {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (r.ok) setLive(await r.json());
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const cards = [
    { label: "Clients", value: stats.clients, icon: Users, link: "/customers" },
    { label: "Audit-Runs", value: stats.audits, icon: Activity, link: "/customers" },
    { label: "Fehlgeschlagen", value: stats.failed, icon: Activity, link: "/customers" },
    { label: "GEO", value: "Canonry", icon: Globe2, link: "/geo" },
  ];

  return (
    <AppShell>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">EZY ONE — SEO &amp; GEO Kommandozentrale.</p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.label} to={c.link}>
            <Card className="transition-colors hover:border-primary/60">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {c.label}
                </CardTitle>
                <c.icon className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{c.value}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {live && (
        <Card className="mb-6 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Live-Status</h2>
            <Badge variant="outline">
              {new Date(live.generated_at ?? Date.now()).toLocaleTimeString("de-DE")}
            </Badge>
          </div>
          <pre className="mt-3 max-h-48 overflow-auto rounded bg-muted/30 p-3 text-xs">
            {JSON.stringify(live, null, 2)}
          </pre>
        </Card>
      )}

      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Letzte Audit-Runs</h2>
          <Link
            to="/customers"
            className="flex items-center gap-1 text-sm text-primary hover:underline"
          >
            Clients <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Runs.</p>
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      r.status === "succeeded"
                        ? "default"
                        : r.status === "failed"
                          ? "destructive"
                          : "outline"
                    }
                  >
                    {r.status}
                  </Badge>
                  <Link
                    to="/customers/$id"
                    params={{ id: r.client_id }}
                    className="font-mono text-xs hover:text-primary"
                  >
                    {r.audit_type}
                  </Link>
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(r.created_at).toLocaleString("de-DE")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AppShell>
  );
}
