import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Save, Trash2, Sparkles } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/tasks/$id")({
  component: TaskDetail,
});

function TaskDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const [t, setT] = useState<any>(null);
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("tasks").select("*").eq("id", id).maybeSingle();
      setT(data);
    })();
  }, [id]);

  if (!t)
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">Lädt...</p>
      </AppShell>
    );

  const save = async () => {
    const { error } = await supabase
      .from("tasks")
      .update({
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        due_date: t.due_date || null,
      })
      .eq("id", id);
    if (error) toast.error(error.message);
    else toast.success("Gespeichert");
  };

  const del = async () => {
    if (!confirm("Wirklich löschen?")) return;
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) toast.error(error.message);
    else navigate({ to: "/tasks" });
  };

  const summarize = async () => {
    if (!t.description) return toast.error("Keine Beschreibung");
    setAiBusy(true);
    const { data, error } = await supabase.functions.invoke("ai-summarize", {
      body: { text: t.description },
    });
    setAiBusy(false);
    if (error) return toast.error(error.message);
    setT({ ...t, description: data.summary });
    toast.success("Eingefügt — bitte speichern");
  };

  const canEdit = t.created_by === user?.id || t.assigned_to === user?.id || isAdmin;

  return (
    <AppShell>
      <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/tasks" })} className="mb-4">
        <ArrowLeft className="mr-2 h-4 w-4" /> Zurück
      </Button>

      <Card className="max-w-2xl p-6">
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Titel</Label>
            <Input
              value={t.title}
              disabled={!canEdit}
              onChange={(e) => setT({ ...t, title: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>Beschreibung</Label>
            <Textarea
              rows={6}
              value={t.description ?? ""}
              disabled={!canEdit}
              onChange={(e) => setT({ ...t, description: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Status</Label>
              <Select
                value={t.status}
                onValueChange={(v) => setT({ ...t, status: v })}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Offen</SelectItem>
                  <SelectItem value="in_progress">In Arbeit</SelectItem>
                  <SelectItem value="done">Erledigt</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Priorität</Label>
              <Select
                value={t.priority}
                onValueChange={(v) => setT({ ...t, priority: v })}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Niedrig</SelectItem>
                  <SelectItem value="medium">Mittel</SelectItem>
                  <SelectItem value="high">Hoch</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Fällig</Label>
              <Input
                type="date"
                value={t.due_date ?? ""}
                disabled={!canEdit}
                onChange={(e) => setT({ ...t, due_date: e.target.value })}
              />
            </div>
          </div>

          {canEdit && (
            <div className="flex flex-wrap gap-2 pt-2">
              <Button onClick={save}>
                <Save className="mr-2 h-4 w-4" /> Speichern
              </Button>
              <Button variant="outline" onClick={summarize} disabled={aiBusy}>
                <Sparkles className="mr-2 h-4 w-4" /> Beschreibung kürzen
              </Button>
              <Button variant="destructive" onClick={del} className="ml-auto">
                <Trash2 className="mr-2 h-4 w-4" /> Löschen
              </Button>
            </div>
          )}
        </div>
      </Card>
    </AppShell>
  );
}
