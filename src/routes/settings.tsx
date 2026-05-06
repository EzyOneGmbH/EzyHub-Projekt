import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { RequireRole } from "@/components/require-role";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, BarChart3, Link2, Bot } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

const TOOLS = [
  { key: "perplexity", label: "Perplexity Recherche", icon: Search, desc: "Live-Web-Suche mit Quellen für Content-Recherche." },
  { key: "ahrefs", label: "Ahrefs SEO", icon: BarChart3, desc: "Domain-Rating, Backlinks, Keyword-Daten." },
  { key: "canonry", label: "Canonry", icon: Link2, desc: "Eigene Canonry-API Anbindung." },
  { key: "ai", label: "KI-Generierung", icon: Bot, desc: "Texterstellung & Zusammenfassungen via AI Gateway." },
];

type Customer = { id: string; name: string };

function SettingsPage() {
  const { isAdmin, user } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("customers").select("id,name").order("name");
      const list = (data ?? []) as Customer[];
      setCustomers(list);
      if (list.length && !selected) setSelected(list[0].id);
    })();
  }, []);

  useEffect(() => {
    if (!selected) return;
    (async () => {
      const { data } = await supabase
        .from("customer_tool_settings")
        .select("tool_key, enabled")
        .eq("customer_id", selected);
      const map: Record<string, boolean> = {};
      (data ?? []).forEach((r: any) => (map[r.tool_key] = r.enabled));
      setEnabledMap(map);
    })();
  }, [selected]);

  const toggle = async (toolKey: string, enabled: boolean) => {
    if (!isAdmin) return toast.error("Nur Admins können Tools schalten");
    setEnabledMap((m) => ({ ...m, [toolKey]: enabled }));
    const { error } = await supabase
      .from("customer_tool_settings")
      .upsert(
        { customer_id: selected, tool_key: toolKey, enabled },
        { onConflict: "customer_id,tool_key" }
      );
    if (error) {
      toast.error(error.message);
      setEnabledMap((m) => ({ ...m, [toolKey]: !enabled }));
    } else {
      toast.success(`${toolKey} ${enabled ? "aktiviert" : "deaktiviert"}`);
    }
  };

  return (
    <AppShell>
      <RequireRole roles={["owner", "admin"]}>
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Einstellungen</h1>
        <p className="text-sm text-muted-foreground">
          {isAdmin ? "Verwalte Tools pro Kunde." : "Nur Lesemodus — Admins können Tools verwalten."}
        </p>
      </div>

      <Card className="mb-6 p-6">
        <h2 className="mb-2 font-semibold">Mein Konto</h2>
        <div className="grid gap-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">E-Mail</span><span>{user?.email}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Rolle</span><span>{isAdmin ? "Admin" : "Mitglied"}</span></div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold">Tools pro Kunde</h2>
            <p className="text-xs text-muted-foreground">Schalte SEO/GEO-Tools für jeden Kunden einzeln frei.</p>
          </div>
          <div className="w-64">
            <Label className="mb-1 block text-xs">Kunde</Label>
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger><SelectValue placeholder="Kunde wählen" /></SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {!selected ? (
          <p className="text-sm text-muted-foreground">Lege zuerst einen Kunden an.</p>
        ) : (
          <div className="grid gap-3">
            {TOOLS.map((t) => {
              const Icon = t.icon;
              const on = !!enabledMap[t.key];
              return (
                <div
                  key={t.key}
                  className="flex items-center justify-between rounded-lg border border-border bg-muted/20 p-4"
                >
                  <div className="flex items-start gap-3">
                    <span className={`grid h-9 w-9 place-items-center rounded-md ${on ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <div>
                      <div className="font-medium">{t.label}</div>
                      <div className="text-xs text-muted-foreground">{t.desc}</div>
                    </div>
                  </div>
                  <Switch checked={on} disabled={!isAdmin} onCheckedChange={(v) => toggle(t.key, v)} />
                </div>
              );
            })}
          </div>
        )}
      </Card>
      </RequireRole>
    </AppShell>
  );
}
