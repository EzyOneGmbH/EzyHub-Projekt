import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { AppShell } from "@/components/app-shell";
import { RequireRole } from "@/components/require-role";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Globe2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/geo")({
  component: GeoDashboard,
});

type Overview = {
  generated_at: string;
  project: unknown;
  domain: string | null;
  history: unknown;
  timeline: unknown;
  health: unknown;
  runs: unknown;
  keywords: unknown;
  insights: unknown;
  schedule: unknown;
  errors: Record<string, string | null>;
};

type ClientRow = { id: string; name: string; canonry_project: string | null };

function GeoDashboard() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [clientId, setClientId] = useState("");
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("clients")
        .select("id,name,canonry_project")
        .order("name");
      setClients((data ?? []) as ClientRow[]);
    })();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!clientId) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const qs = new URLSearchParams({ clientId });
      const res = await fetch(`/api/live/canonry/overview?${qs.toString()}`, {
        cache: "no-store",
        headers: session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : undefined,
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
      } else {
        setData(body as Overview);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell>
      <RequireRole roles={["owner", "admin", "member", "viewer"]}>
        <div className="mb-6">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Globe2 className="h-7 w-7 text-primary" /> GEO Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            Canonry-Übersicht: Projekt, Health, Runs, Keywords, Insights, Schedule.
          </p>
        </div>

        <Card className="mb-6 p-6">
          <form onSubmit={submit} className="grid gap-4 md:grid-cols-[1fr,auto] md:items-end">
            <div className="space-y-2">
              <Label htmlFor="client">Kunde</Label>
              <select
                id="client"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                required
              >
                <option value="">— Kunde wählen —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.canonry_project ? ` (${c.canonry_project})` : " — kein Project"}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" disabled={loading || !clientId}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Laden
            </Button>
          </form>
        </Card>

        {error && (
          <Card className="mb-4 border-destructive p-4 text-sm text-destructive">{error}</Card>
        )}

        {data && (
          <div className="grid gap-4 md:grid-cols-2">
            <SectionCard title="Project" payload={data.project} err={data.errors.project} />
            <SectionCard title="Health (latest)" payload={data.health} err={data.errors.health} />
            <SectionCard
              title="Runs (latest)"
              payload={data.runs}
              err={data.errors.runs}
              optional
            />
            <SectionCard
              title="Schedule"
              payload={data.schedule}
              err={data.errors.schedule}
              optional
            />
            <SectionCard title="Keywords" payload={data.keywords} err={data.errors.keywords} />
            <SectionCard title="Insights" payload={data.insights} err={data.errors.insights} />
            <SectionCard title="History" payload={data.history} err={data.errors.history} />
            <SectionCard title="Timeline" payload={data.timeline} err={data.errors.timeline} />
          </div>
        )}

        {data && (
          <p className="mt-6 text-xs text-muted-foreground">
            Geprüft: {new Date(data.generated_at).toLocaleString("de-DE")}
          </p>
        )}
      </RequireRole>
    </AppShell>
  );
}

function SectionCard({
  title,
  payload,
  err,
  optional,
}: {
  title: string;
  payload: unknown;
  err: string | null;
  optional?: boolean;
}) {
  const empty = payload === null || payload === undefined;
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold">{title}</h3>
        {err ? (
          <Badge variant="destructive">Fehler</Badge>
        ) : empty ? (
          <Badge variant="outline">{optional ? "Nicht vorhanden" : "Leer"}</Badge>
        ) : (
          <Badge>OK</Badge>
        )}
      </div>
      {err ? (
        <p className="text-xs text-destructive break-words">{err}</p>
      ) : empty ? (
        <p className="text-xs text-muted-foreground">—</p>
      ) : (
        <pre className="max-h-64 overflow-auto rounded-md bg-muted/40 p-3 text-xs">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </Card>
  );
}
