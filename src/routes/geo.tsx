import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { AppShell } from "@/components/app-shell";
import { RequireRole } from "@/components/require-role";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Globe2, Loader2 } from "lucide-react";

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

function GeoDashboard() {
  const [project, setProject] = useState("");
  const [domain, setDomain] = useState("");
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!project) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const qs = new URLSearchParams({ project });
      if (domain) qs.set("domain", domain);
      const res = await fetch(`/api/live/canonry/overview?${qs.toString()}`, { cache: "no-store" });
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
          <form onSubmit={submit} className="grid gap-4 md:grid-cols-[1fr,1fr,auto] md:items-end">
            <div className="space-y-2">
              <Label htmlFor="project">Project</Label>
              <Input
                id="project"
                value={project}
                onChange={(e) => setProject(e.target.value)}
                placeholder="my-project"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="domain">Domain (optional)</Label>
              <Input
                id="domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="example.com"
              />
            </div>
            <Button type="submit" disabled={loading || !project}>
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
