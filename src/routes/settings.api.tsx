import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { RequireRole } from "@/components/require-role";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, AlertCircle, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/settings/api")({
  component: ApiStatusPage,
});

type ProbeResult = {
  configured: boolean;
  ok: boolean;
  status?: number;
  error?: string;
  latency_ms?: number;
};

type LiveStatus = {
  generated_at: string;
  providers: Record<string, ProbeResult>;
};

const LABELS: Record<string, string> = {
  gemini: "Google Gemini",
  openai: "OpenAI",
  anthropic: "Anthropic",
  perplexity: "Perplexity",
  canonry: "Canonry",
  ahrefs: "Ahrefs",
  google_oauth: "Google OAuth",
};

function ApiStatusPage() {
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/live/status", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <AppShell>
      <RequireRole roles={["owner", "admin"]}>
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-bold">API Status</h1>
            <p className="text-sm text-muted-foreground">
              Live-Verbindung & Konfiguration aller Provider.
            </p>
          </div>
          <Button onClick={load} disabled={loading} variant="outline">
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Erneut prüfen
          </Button>
        </div>

        {error && (
          <Card className="mb-4 border-destructive p-4 text-sm text-destructive">
            Fehler: {error}
          </Card>
        )}

        <div className="grid gap-3">
          {status &&
            Object.entries(status.providers).map(([key, p]) => (
              <ProviderRow key={key} name={LABELS[key] ?? key} probe={p} />
            ))}
          {!status && !error && (
            <p className="text-sm text-muted-foreground">Lade...</p>
          )}
        </div>

        {status && (
          <p className="mt-6 text-xs text-muted-foreground">
            Geprüft: {new Date(status.generated_at).toLocaleString("de-DE")}
          </p>
        )}
      </RequireRole>
    </AppShell>
  );
}

function ProviderRow({ name, probe }: { name: string; probe: ProbeResult }) {
  const state: "ok" | "warn" | "err" = !probe.configured
    ? "warn"
    : probe.ok
      ? "ok"
      : "err";
  const Icon = state === "ok" ? CheckCircle2 : state === "warn" ? AlertCircle : XCircle;
  const tone =
    state === "ok"
      ? "text-emerald-500"
      : state === "warn"
        ? "text-amber-500"
        : "text-destructive";

  return (
    <Card className="flex items-start justify-between gap-4 p-4">
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-5 w-5 ${tone}`} />
        <div>
          <div className="font-medium">{name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={probe.configured ? "secondary" : "outline"}>
              {probe.configured ? "Konfiguriert" : "Nicht konfiguriert"}
            </Badge>
            {probe.configured && (
              <Badge variant={probe.ok ? "default" : "destructive"}>
                {probe.ok ? "Erreichbar" : "Fehler"}
              </Badge>
            )}
            {typeof probe.status === "number" && <span>HTTP {probe.status}</span>}
            {typeof probe.latency_ms === "number" && <span>{probe.latency_ms} ms</span>}
          </div>
          {probe.error && (
            <p className="mt-2 max-w-2xl break-words text-xs text-muted-foreground">
              {probe.error}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
