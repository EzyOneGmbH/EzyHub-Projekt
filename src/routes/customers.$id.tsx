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
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { GoogleConnectPanel } from "@/components/google-connect-panel";
import { AhrefsPanel } from "@/components/ahrefs-panel";

export const Route = createFileRoute("/customers/$id")({
  component: ClientDetail,
});

type Client = {
  id: string;
  organization_id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  country: string | null;
  language: string;
  notes: string | null;
  gsc_property: string | null;
  ga4_property: string | null;
  canonry_project: string | null;
};

type AuditRun = {
  id: string;
  audit_type: string;
  status: string;
  created_at: string;
  finished_at: string | null;
  error: string | null;
};

function ClientDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { isOrgAdmin } = useAuth();
  const [c, setC] = useState<Client | null>(null);
  const [runs, setRuns] = useState<AuditRun[]>([]);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [canonryData, setCanonryData] = useState<any>(null);
  const [canonryLoading, setCanonryLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("clients").select("*").eq("id", id).maybeSingle();
      setC(data as Client | null);
      const [{ data: r }, { data: ints }] = await Promise.all([
        supabase
          .from("audit_runs")
          .select("id,audit_type,status,created_at,finished_at,error")
          .eq("client_id", id)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase.from("client_integrations").select("provider,enabled").eq("client_id", id),
      ]);
      setRuns((r ?? []) as AuditRun[]);
      const map: Record<string, boolean> = {};
      (ints ?? []).forEach((row: any) => (map[row.provider] = row.enabled));
      setEnabled(map);
    })();
  }, [id]);

  const loadCanonry = async () => {
    if (!c?.canonry_project) return;
    setCanonryLoading(true);
    try {
      const qs = new URLSearchParams({ project: c.canonry_project });
      if (c.domain) qs.set("domain", c.domain);
      const res = await fetch(`/api/live/canonry/overview?${qs.toString()}`);
      setCanonryData(await res.json());
    } finally {
      setCanonryLoading(false);
    }
  };

  if (!c) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">Lädt...</p>
      </AppShell>
    );
  }

  const save = async () => {
    const { error } = await supabase
      .from("clients")
      .update({
        name: c.name,
        domain: c.domain,
        industry: c.industry,
        country: c.country,
        notes: c.notes,
        gsc_property: c.gsc_property,
        ga4_property: c.ga4_property,
        canonry_project: c.canonry_project,
      })
      .eq("id", id);
    if (error) toast.error(error.message);
    else toast.success("Gespeichert");
  };

  const del = async () => {
    if (!confirm("Wirklich löschen?")) return;
    const { error } = await supabase.from("clients").delete().eq("id", id);
    if (error) toast.error(error.message);
    else navigate({ to: "/customers" });
  };

  return (
    <AppShell>
      <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/customers" })} className="mb-4">
        <ArrowLeft className="mr-2 h-4 w-4" /> Zurück
      </Button>

      <Card className="p-6">
        <h1 className="mb-4 text-2xl font-bold text-foreground">{c.name}</h1>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Name" value={c.name} onChange={(v) => setC({ ...c, name: v })} disabled={!isOrgAdmin} />
          <Field label="Domain" value={c.domain ?? ""} onChange={(v) => setC({ ...c, domain: v || null })} disabled={!isOrgAdmin} />
          <Field label="Branche" value={c.industry ?? ""} onChange={(v) => setC({ ...c, industry: v || null })} disabled={!isOrgAdmin} />
          <Field label="Land" value={c.country ?? ""} onChange={(v) => setC({ ...c, country: v || null })} disabled={!isOrgAdmin} />
          <Field label="Canonry Projekt-Slug" value={c.canonry_project ?? ""} onChange={(v) => setC({ ...c, canonry_project: v || null })} disabled={!isOrgAdmin} />
          <Field label="GSC Property" value={c.gsc_property ?? ""} onChange={(v) => setC({ ...c, gsc_property: v || null })} disabled={!isOrgAdmin} />
          <Field label="GA4 Property" value={c.ga4_property ?? ""} onChange={(v) => setC({ ...c, ga4_property: v || null })} disabled={!isOrgAdmin} />
        </div>
        <div className="mt-3 space-y-1">
          <Label>Notizen</Label>
          <Textarea rows={5} value={c.notes ?? ""} disabled={!isOrgAdmin} onChange={(e) => setC({ ...c, notes: e.target.value })} />
        </div>
        {isOrgAdmin && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={save}><Save className="mr-2 h-4 w-4" /> Speichern</Button>
            <Button variant="destructive" onClick={del} className="ml-auto"><Trash2 className="mr-2 h-4 w-4" /> Löschen</Button>
          </div>
        )}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <GoogleConnectPanel
          clientId={id}
          gscProperty={c.gsc_property}
          ga4Property={c.ga4_property}
          onPropertiesChange={(p) => setC({ ...c, ...p })}
        />
        <AhrefsPanel clientId={id} domain={c.domain} />
      </div>

      <Card className="mt-6 p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Canonry / GEO Health</h2>
          <Button size="sm" variant="outline" onClick={loadCanonry} disabled={!c.canonry_project || canonryLoading}>
            {canonryLoading ? "Lädt..." : "Laden"}
          </Button>
        </div>
        {!c.canonry_project ? (
          <p className="text-sm text-muted-foreground">Kein Canonry-Projekt-Slug konfiguriert.</p>
        ) : canonryData ? (
          <pre className="max-h-80 overflow-auto rounded bg-muted/30 p-3 text-xs">{JSON.stringify(canonryData, null, 2)}</pre>
        ) : (
          <p className="text-sm text-muted-foreground">Auf „Laden" klicken, um Health/Runs/Keywords zu holen.</p>
        )}
      </Card>

      <Card className="mt-6 p-6">
        <h2 className="mb-3 font-semibold">Audit-Verlauf</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Audit-Runs.</p>
        ) : (
          <ul className="divide-y divide-border">
            {runs.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant={r.status === "succeeded" ? "default" : r.status === "failed" ? "destructive" : "outline"}>{r.status}</Badge>
                  <span className="font-mono text-xs">{r.audit_type}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(r.created_at).toLocaleString("de-DE")}
                  {r.error ? ` · ${r.error.slice(0, 60)}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AppShell>
  );
}

function Field({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
