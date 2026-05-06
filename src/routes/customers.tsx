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
import { Plus, Building2, Mail, Phone } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/customers")({
  component: CustomersPage,
});

type Customer = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
};

const schema = z.object({
  name: z.string().trim().min(1, "Name erforderlich").max(100),
  company: z.string().trim().max(150).optional().or(z.literal("")),
  email: z.string().trim().email("Ungültige E-Mail").max(255).optional().or(z.literal("")),
  phone: z.string().trim().max(50).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

function CustomersPage() {
  const { user } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", company: "", email: "", phone: "", notes: "" });
  const [search, setSearch] = useState("");

  const load = async () => {
    const { data } = await supabase.from("customers").select("*").order("created_at", { ascending: false });
    setCustomers((data ?? []) as Customer[]);
  };

  useEffect(() => {
    load();
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    const { error } = await supabase.from("customers").insert({
      name: parsed.data.name,
      company: parsed.data.company || null,
      email: parsed.data.email || null,
      phone: parsed.data.phone || null,
      notes: parsed.data.notes || null,
      created_by: user!.id,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Kunde angelegt");
    setForm({ name: "", company: "", email: "", phone: "", notes: "" });
    setOpen(false);
    load();
  };

  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.company ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Kunden</h1>
          <p className="text-sm text-muted-foreground">{customers.length} Einträge</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> Neuer Kunde
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Neuer Kunde</DialogTitle>
            </DialogHeader>
            <form onSubmit={onSubmit} className="space-y-3">
              {(
                [
                  ["name", "Name *"],
                  ["company", "Firma"],
                  ["email", "E-Mail"],
                  ["phone", "Telefon"],
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
      </div>

      <Input
        placeholder="Suche..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 max-w-sm"
      />

      <div className="grid gap-3">
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground">Keine Kunden gefunden.</p>
        )}
        {filtered.map((c) => (
          <Link key={c.id} to="/customers/$id" params={{ id: c.id }}>
            <Card className="p-4 transition-colors hover:border-primary">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-semibold text-foreground">{c.name}</div>
                  {c.company && (
                    <div className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                      <Building2 className="h-3 w-3" /> {c.company}
                    </div>
                  )}
                </div>
                <div className="text-right text-sm text-muted-foreground">
                  {c.email && <div className="flex items-center gap-1"><Mail className="h-3 w-3" /> {c.email}</div>}
                  {c.phone && <div className="flex items-center gap-1"><Phone className="h-3 w-3" /> {c.phone}</div>}
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
