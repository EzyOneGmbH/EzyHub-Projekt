import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { ArrowLeft, Save, Trash2, Sparkles, ListTodo } from "lucide-react";
import { toast } from "sonner";
import { GoogleConnectPanel } from "@/components/google-connect-panel";
import { AhrefsPanel } from "@/components/ahrefs-panel";

export const Route = createFileRoute("/customers/$id")({
  component: CustomerDetail,
});

function CustomerDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const [c, setC] = useState<any>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("customers").select("*").eq("id", id).maybeSingle();
      setC(data);
    })();
  }, [id]);

  if (!c) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">Lädt...</p>
      </AppShell>
    );
  }

  const save = async () => {
    const { error } = await supabase
      .from("customers")
      .update({
        name: c.name,
        company: c.company,
        email: c.email,
        phone: c.phone,
        notes: c.notes,
      })
      .eq("id", id);
    if (error) toast.error(error.message);
    else toast.success("Gespeichert");
  };

  const del = async () => {
    if (!confirm("Wirklich löschen?")) return;
    const { error } = await supabase.from("customers").delete().eq("id", id);
    if (error) toast.error(error.message);
    else navigate({ to: "/customers" });
  };

  const summarize = async () => {
    if (!c.notes) return toast.error("Keine Notizen vorhanden");
    setAiBusy(true);
    const { data, error } = await supabase.functions.invoke("ai-summarize", {
      body: { text: c.notes },
    });
    setAiBusy(false);
    if (error) return toast.error(error.message);
    setC({ ...c, notes: data.summary });
    toast.success("Zusammenfassung eingefügt — bitte speichern");
  };

  const suggestTasks = async () => {
    if (!c.notes) return toast.error("Keine Notizen vorhanden");
    setAiBusy(true);
    const { data, error } = await supabase.functions.invoke("ai-suggest-tasks", {
      body: { context: `Kunde: ${c.name}${c.company ? " (" + c.company + ")" : ""}\n\n${c.notes}` },
    });
    setAiBusy(false);
    if (error) return toast.error(error.message);
    setSuggestions(data.tasks ?? []);
  };

  const createTask = async (title: string) => {
    const { error } = await supabase.from("tasks").insert({
      title,
      customer_id: id,
      created_by: user!.id,
    });
    if (error) toast.error(error.message);
    else toast.success("Aufgabe erstellt");
  };

  const canEdit = c.created_by === user?.id || isAdmin;

  return (
    <AppShell>
      <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/customers" })} className="mb-4">
        <ArrowLeft className="mr-2 h-4 w-4" /> Zurück
      </Button>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <h1 className="mb-4 text-2xl font-bold text-foreground">{c.name}</h1>
          <div className="space-y-3">
            {(["name", "company", "email", "phone"] as const).map((k) => (
              <div key={k} className="space-y-1">
                <Label className="capitalize">{k}</Label>
                <Input
                  value={c[k] ?? ""}
                  disabled={!canEdit}
                  onChange={(e) => setC({ ...c, [k]: e.target.value })}
                />
              </div>
            ))}
            <div className="space-y-1">
              <Label>Notizen</Label>
              <Textarea
                rows={8}
                value={c.notes ?? ""}
                disabled={!canEdit}
                onChange={(e) => setC({ ...c, notes: e.target.value })}
              />
            </div>
            {canEdit && (
              <div className="flex flex-wrap gap-2 pt-2">
                <Button onClick={save}><Save className="mr-2 h-4 w-4" /> Speichern</Button>
                <Button variant="outline" onClick={summarize} disabled={aiBusy}>
                  <Sparkles className="mr-2 h-4 w-4" /> Notizen zusammenfassen
                </Button>
                <Button variant="outline" onClick={suggestTasks} disabled={aiBusy}>
                  <ListTodo className="mr-2 h-4 w-4" /> Aufgaben vorschlagen
                </Button>
                <Button variant="destructive" onClick={del} className="ml-auto">
                  <Trash2 className="mr-2 h-4 w-4" /> Löschen
                </Button>
              </div>
            )}
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="mb-3 font-semibold text-foreground">KI-Vorschläge</h2>
          {suggestions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Klicke „Aufgaben vorschlagen", um KI-Ideen für nächste Schritte zu bekommen.
            </p>
          ) : (
            <ul className="space-y-2">
              {suggestions.map((s, i) => (
                <li key={i} className="flex items-start gap-2 rounded-md border border-border p-2 text-sm">
                  <span className="flex-1">{s}</span>
                  <Button size="sm" variant="ghost" onClick={() => createTask(s)}>
                    + Task
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4">
            <Link to="/tasks" className="text-sm text-primary hover:underline">
              Alle Aufgaben →
            </Link>
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <GoogleConnectPanel
          clientId={id}
          gscProperty={c.gsc_property ?? null}
          ga4Property={c.ga4_property ?? null}
          onPropertiesChange={(p) => setC({ ...c, ...p })}
        />
        <AhrefsPanel clientId={id} domain={c.domain ?? null} />
      </div>
    </AppShell>
  );
}
