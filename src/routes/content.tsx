import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/content")({
  component: ContentList,
});

type ClientOpt = { id: string; name: string };

type Item = {
  id: string;
  title: string;
  content_type: string;
  status: string;
  language: string;
  client_id: string | null;
  updated_at: string;
};

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  review: "bg-warning/20 text-warning",
  published: "bg-success/20 text-success",
};

function ContentList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[]>([]);
  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [newClient, setNewClient] = useState<string>("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [{ data, error }, { data: cs }] = await Promise.all([
      supabase
        .from("content_items")
        .select("id,title,content_type,status,language,client_id,updated_at")
        .order("updated_at", { ascending: false }),
      supabase.from("clients").select("id,name").order("name"),
    ]);
    if (error) toast.error(error.message);
    else setItems((data ?? []) as Item[]);
    const cl = (cs ?? []) as ClientOpt[];
    setClients(cl);
    if (cl.length && !newClient) setNewClient(cl[0].id);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    if (!newClient) return toast.error("Bitte zuerst einen Kunden anlegen.");
    const { data, error } = await supabase
      .from("content_items")
      .insert({ title: "Neuer Inhalt", created_by: user!.id, client_id: newClient })
      .select("id")
      .single();
    if (error) return toast.error(error.message);
    navigate({ to: "/content/$id", params: { id: data.id } });
  };

  const filtered = items.filter((i) => i.title.toLowerCase().includes(q.toLowerCase()));

  return (
    <AppShell>
      <div className="mb-6 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Inhalte</h1>
          <p className="text-sm text-muted-foreground">SEO &amp; GEO Beiträge, Landingpages und Snippets.</p>
        </div>
        <Button onClick={create}>
          <Plus className="mr-2 h-4 w-4" /> Neu
        </Button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen..." className="pl-9" />
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Lädt...</p>
      ) : filtered.length === 0 ? (
        <Card className="p-10 text-center">
          <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">Noch keine Inhalte. Lege den ersten an.</p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map((i) => (
            <Link key={i.id} to="/content/$id" params={{ id: i.id }}>
              <Card className="flex items-center justify-between p-4 transition-all hover:border-primary hover:shadow-[var(--shadow-elegant)]">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" />
                    <h3 className="truncate font-medium">{i.title}</h3>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {i.content_type.toUpperCase()} · {i.language.toUpperCase()} ·{" "}
                    {new Date(i.updated_at).toLocaleDateString("de-DE")}
                  </p>
                </div>
                <Badge className={statusColors[i.status] ?? ""}>{i.status}</Badge>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
