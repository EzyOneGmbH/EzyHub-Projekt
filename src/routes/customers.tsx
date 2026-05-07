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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Globe2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/customers")({
  component: CustomersPage,
});

type Client = {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  country: string | null;
  notes: string | null;
};

const schema = z.object({
  name: z.string().trim().min(1, "Name erforderlich").max(100),
  domain: z.string().trim().max(255).optional().or(z.literal("")),
  industry: z.string().trim().max(150).optional().or(z.literal("")),
  country: z.string().trim().max(100).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

function CustomersPage() {
  const { user, organizationId, isOrgAdmin } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", domain: "", industry: "", country: "", notes: "" });
  const [search, setSearch] = useState("");

  const load = async () => {
    const { data } = await supabase
      .from("clients")
      .select("id,name,domain,industry,country,notes")
      .order("created_at", { ascending: false });
    setClients((data ?? []) as Client[]);
  };

  useEffect(() => {
    load();
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!organizationId) {
      toast.error("Keine Organisation zugeordnet");
      return;
    }
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    const { error } = await supabase.from("clients").insert({
      organization_id: organizationId,
      name: parsed.data.name,
      domain: parsed.data.domain || null,
      industry: parsed.data.industry || null,
      country: parsed.data.country || null,
      notes: parsed.data.notes || null,
      created_by: user!.id,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Client angelegt");
    setForm({ name: "", domain: "", industry: "", country: "", notes: "" });
    setOpen(false);
    load();
  };

  const filtered = clients.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.domain ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Clients</h1>
          <p className="text-sm text-muted-foreground">{clients.length} Einträge</p>
        </div>
        {isOrgAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> Neuer Client
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Neuer Client</DialogTitle>
              </DialogHeader>
              <form onSubmit={onSubmit} className="space-y-3">
                {(
                  [
                    ["name", "Name *"],
                    ["domain", "Domain (z. B. example.com)"],
                    ["industry", "Branche"],
                    ["country", "Land"],
                  ] as const
                ).map(([k, label]) => (
                  <div key={k} className="space-y-1">
                    <Label htmlFor={k}>{label}</Label>
                    <Input id={k} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                  </div>
                ))}
                <div className="space-y-1">
                  <Label htmlFor="notes">Notizen</Label>
                  <Textarea id="notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
                <Button type="submit" className="w-full">Anlegen</Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Input
        placeholder="Suche..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 max-w-sm"
      />

      <div className="grid gap-3">
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground">Keine Clients gefunden.</p>
        )}
        {filtered.map((c) => (
          <Link key={c.id} to="/customers/$id" params={{ id: c.id }}>
            <Card className="p-4 transition-colors hover:border-primary">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-semibold text-foreground">{c.name}</div>
                  {c.domain && (
                    <div className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                      <Globe2 className="h-3 w-3" /> {c.domain}
                    </div>
                  )}
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  {c.industry && <div>{c.industry}</div>}
                  {c.country && <div>{c.country}</div>}
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
