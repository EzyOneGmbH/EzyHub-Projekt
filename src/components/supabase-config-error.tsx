import { AlertTriangle, RefreshCw, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

const FALLBACK_SUPABASE_URL = "https://glrgccmujzuwnhyvwxyi.supabase.co";
const FALLBACK_SUPABASE_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdscmdjY211anp1d25oeXZ3eHlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNzE4ODIsImV4cCI6MjA5MzY0Nzg4Mn0.AOITFOXW-8bzgMljEx7dQOd_snxoptGHKGcWLAXZqMA";

type Props = {
  missing: string[];
};

export function SupabaseConfigError({ missing }: Props) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-8 shadow-sm">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-6 w-6 text-destructive" />
        </div>
        <h1 className="text-center text-2xl font-bold text-foreground">
          Backend-Konfiguration fehlt
        </h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Die App kann nicht starten, weil die Verbindung zu Lovable Cloud nicht konfiguriert ist.
        </p>

        <div className="mt-6 rounded-md border border-border bg-muted/40 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Fehlende Variablen
          </p>
          <ul className="mt-2 space-y-1 font-mono text-sm text-foreground">
            {missing.map((v) => (
              <li key={v}>• {v}</li>
            ))}
          </ul>
        </div>

        <div className="mt-6 space-y-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">So behebst du das:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Lege eine <code className="rounded bg-muted px-1">.env</code>-Datei im Projekt-Root an
              (siehe <code className="rounded bg-muted px-1">.env.example</code>).
            </li>
            <li>
              Trage <code className="rounded bg-muted px-1">VITE_SUPABASE_URL</code> und{" "}
              <code className="rounded bg-muted px-1">VITE_SUPABASE_PUBLISHABLE_KEY</code> aus
              Lovable Cloud ein.
            </li>
            <li>Starte die Vorschau anschließend neu.</li>
          </ol>
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button onClick={() => window.location.reload()} className="w-full">
            <RefreshCw className="mr-2 h-4 w-4" />
            Erneut versuchen
          </Button>
          <Button asChild variant="outline" className="w-full">
            <a
              href="https://docs.lovable.dev/features/cloud"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              Setup-Anleitung
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}

export function getMissingSupabaseEnv(): string[] {
  const env = (typeof import.meta !== "undefined" ? import.meta.env : undefined) as
    | Record<string, string | undefined>
    | undefined;
  const missing: string[] = [];
  const supabaseUrl = env?.VITE_SUPABASE_URL || process.env.SUPABASE_URL || FALLBACK_SUPABASE_URL;
  const supabasePublishableKey =
    env?.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    FALLBACK_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl) missing.push("VITE_SUPABASE_URL");
  if (!supabasePublishableKey) missing.push("VITE_SUPABASE_PUBLISHABLE_KEY");
  return missing;
}
