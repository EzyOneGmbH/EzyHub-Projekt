import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Calendar } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/tasks")({
  component: TasksPage,
});

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: "open" | "in_progress" | "done";
  priority: "low" | "medium" | "high";
  due_date: string | null;
};

const statusLabel: Record<Task["status"], string> = {
  open: "Offen",
  in_progress: "In Arbeit",
  done: "Erledigt",
};

const priorityVariant: Record<Task["priority"], "default" | "secondary" | "destructive"> = {
  low: "secondary",
  medium: "default",
  high: "destructive",
};

const schema = z.object({
  title: z.string().trim().min(1, "Titel erforderlich").max(200),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
});

function TasksPage() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<"all" | Task["status"]>("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    priority: "medium" as Task["priority"],
    due_date: "",
  });

  const load = async () => {
    const { data } = await supabase
      .from("tasks")
      .select("*")
      .order("created_at", { ascending: false });
    setTasks((data ?? []) as Task[]);
  };

  useEffect(() => {
    load();
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ title: form.title, description: form.description });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    const { error } = await supabase.from("tasks").insert({
      title: parsed.data.title,
      description: parsed.data.description || null,
      priority: form.priority,
      due_date: form.due_date || null,
      created_by: user!.id,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Aufgabe erstellt");
    setForm({ title: "", description: "", priority: "medium", due_date: "" });
    setOpen(false);
    load();
  };

  const updateStatus = async (id: string, status: Task["status"]) => {
    const { error } = await supabase.from("tasks").update({ status }).eq("id", id);
    if (error) toast.error(error.message);
    else load();
  };

  const filtered = tasks.filter((t) => filter === "all" || t.status === filter);

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Aufgaben</h1>
          <p className="text-sm text-muted-foreground">{tasks.length} insgesamt</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> Neue Aufgabe
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Neue Aufgabe</DialogTitle>
            </DialogHeader>
            <form onSubmit={onSubmit} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="title">Titel *</Label>
                <Input
                  id="title"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="desc">Beschreibung</Label>
                <Textarea
                  id="desc"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Priorität</Label>
                  <Select
                    value={form.priority}
                    onValueChange={(v) => setForm({ ...form, priority: v as Task["priority"] })}
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
                  <Label htmlFor="due">Fällig</Label>
                  <Input
                    id="due"
                    type="date"
                    value={form.due_date}
                    onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                  />
                </div>
              </div>
              <Button type="submit" className="w-full">
                Erstellen
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="mb-4 flex gap-2">
        {(["all", "open", "in_progress", "done"] as const).map((s) => (
          <Button
            key={s}
            variant={filter === s ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(s)}
          >
            {s === "all" ? "Alle" : statusLabel[s]}
          </Button>
        ))}
      </div>

      <div className="grid gap-3">
        {filtered.length === 0 && <p className="text-sm text-muted-foreground">Keine Aufgaben.</p>}
        {filtered.map((t) => (
          <Card key={t.id} className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <Link
                  to="/tasks/$id"
                  params={{ id: t.id }}
                  className="font-semibold text-foreground hover:underline"
                >
                  {t.title}
                </Link>
                {t.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{t.description}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge variant={priorityVariant[t.priority]}>{t.priority}</Badge>
                  {t.due_date && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" /> {t.due_date}
                    </span>
                  )}
                </div>
              </div>
              <Select
                value={t.status}
                onValueChange={(v) => updateStatus(t.id, v as Task["status"])}
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Offen</SelectItem>
                  <SelectItem value="in_progress">In Arbeit</SelectItem>
                  <SelectItem value="done">Erledigt</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
