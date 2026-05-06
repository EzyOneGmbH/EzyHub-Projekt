import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Shield } from "lucide-react";

export const Route = createFileRoute("/admin/users")({
  component: AdminUsers,
});

type Row = {
  id: string;
  full_name: string | null;
  roles: string[];
};

function AdminUsers() {
  const { isAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (!loading && !isAdmin) navigate({ to: "/dashboard" });
  }, [loading, isAdmin, navigate]);

  const load = async () => {
    const [{ data: profiles }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("id, full_name"),
      supabase.from("user_roles").select("user_id, role"),
    ]);
    const byUser: Record<string, string[]> = {};
    (roles ?? []).forEach((r: any) => {
      byUser[r.user_id] = [...(byUser[r.user_id] ?? []), r.role];
    });
    setRows((profiles ?? []).map((p: any) => ({ id: p.id, full_name: p.full_name, roles: byUser[p.id] ?? [] })));
  };

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  const toggleAdmin = async (userId: string, hasAdmin: boolean) => {
    if (hasAdmin) {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", "admin");
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: "admin" });
      if (error) return toast.error(error.message);
    }
    toast.success("Aktualisiert");
    load();
  };

  if (!isAdmin) return null;

  return (
    <AppShell>
      <div className="mb-6 flex items-center gap-2">
        <Shield className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-3xl font-bold text-foreground">Nutzerverwaltung</h1>
          <p className="text-sm text-muted-foreground">Rollen vergeben oder entfernen</p>
        </div>
      </div>

      <div className="grid gap-3">
        {rows.map((r) => {
          const hasAdmin = r.roles.includes("admin");
          return (
            <Card key={r.id} className="flex items-center justify-between p-4">
              <div>
                <div className="font-semibold text-foreground">{r.full_name ?? "Ohne Name"}</div>
                <div className="mt-1 flex gap-1">
                  {r.roles.map((role) => (
                    <Badge key={role} variant={role === "admin" ? "default" : "secondary"}>
                      {role}
                    </Badge>
                  ))}
                </div>
              </div>
              <Button variant={hasAdmin ? "outline" : "default"} size="sm" onClick={() => toggleAdmin(r.id, hasAdmin)}>
                {hasAdmin ? "Admin entfernen" : "Zum Admin machen"}
              </Button>
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}
