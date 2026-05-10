import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";

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

const PROVIDER_LABELS: Record<string, { name: string; hint: string }> = {
  gemini: { name: "Google Gemini", hint: "GEMINI_API_KEY" },
  openai: { name: "OpenAI", hint: "OPENAI_API_KEY" },
  anthropic: { name: "Anthropic Claude", hint: "ANTHROPIC_API_KEY" },
  perplexity: { name: "Perplexity", hint: "PERPLEXITY_API_KEY" },
  canonry: { name: "Canonry", hint: "CANONRY_BASE_URL + CANONRY_API_KEY" },
  ahrefs: { name: "Ahrefs", hint: "AHREFS_API_KEY" },
  google_oauth: {
    name: "Google OAuth (GSC/GA4)",
    hint: "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI",
  },
};

function statusOf(p: ProbeResult): "ok" | "missing" | "error" {
  if (!p.configured) return "missing";
  if (!p.ok) return "error";
  return "ok";
}

function friendlyMessage(key: string, p: ProbeResult): string {
  const meta = PROVIDER_LABELS[key];
  const s = statusOf(p);
  if (s === "ok") return `Erreichbar${p.latency_ms ? ` · ${p.latency_ms} ms` : ""}`;
  if (s === "missing")
    return `Nicht konfiguriert. Bitte folgende Secrets hinterlegen: ${meta?.hint ?? key}`;
  if (p.status === 401 || p.status === 403)
    return `Schlüssel ungültig oder ohne Berechtigung (HTTP ${p.status}). Bitte ${meta?.hint ?? key} prüfen.`;
  if (p.status === 429) return `Rate-Limit erreicht (HTTP 429). Später erneut versuchen.`;
  return p.error || `Unbekannter Fehler${p.status ? ` (HTTP ${p.status})` : ""}`;
}

function StatusIcon({ s }: { s: "ok" | "missing" | "error" }) {
  if (s === "ok") return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
  if (s === "missing") return <AlertCircle className="h-5 w-5 text-amber-500" />;
  return <XCircle className="h-5 w-5 text-destructive" />;
}

export const Route = createFileRoute("/health")({
  component: HealthPage,
});

function HealthPage() {
  const { session, loading: authLoading, isOrgAdmin, isAdmin } = useAuth();
  const [data, setData] = useState<LiveStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canView = isOrgAdmin || isAdmin;

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      const res = await fetch("/api/live/status", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body || res.statusText}`);
      }
      setData((await res.json()) as LiveStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && session && canView) void load();
  }, [authLoading, session, canView]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto max-w-2xl p-6">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Anmeldung erforderlich</AlertTitle>
          <AlertDescription>
            Bitte melde dich an, um den Health-Check zu sehen.{" "}
            <Link to="/login" className="underline">
              Zum Login
            </Link>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="container mx-auto max-w-2xl p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Keine Berechtigung</AlertTitle>
          <AlertDescription>
            Nur Owner oder Admins können den System-Health-Check einsehen.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const entries = data ? Object.entries(data.providers) : [];
  const problems = entries.filter(([, p]) => statusOf(p) !== "ok");

  return (
    <div className="container mx-auto max-w-3xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">System-Health-Check</h1>
          <p className="text-sm text-muted-foreground">
            Prüft alle konfigurierten API-Schlüssel und Verbindungen.
          </p>
        </div>
        <Button onClick={load} disabled={loading} variant="outline" size="sm">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="ml-2">Erneut prüfen</span>
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Health-Check fehlgeschlagen</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {data && problems.length === 0 && (
        <Alert>
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          <AlertTitle>Alle Systeme einsatzbereit</AlertTitle>
          <AlertDescription>
            Alle konfigurierten Schlüssel sind gültig und alle Dienste antworten.
          </AlertDescription>
        </Alert>
      )}

      {data && problems.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{problems.length} Problem(e) gefunden</AlertTitle>
          <AlertDescription>
            Einige Dienste sind nicht konfiguriert oder erreichbar. Details siehe unten.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3">
        {entries.map(([key, p]) => {
          const s = statusOf(p);
          const meta = PROVIDER_LABELS[key] ?? { name: key, hint: key };
          return (
            <Card key={key}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    <StatusIcon s={s} />
                    {meta.name}
                  </span>
                  <Badge
                    variant={s === "ok" ? "default" : s === "missing" ? "secondary" : "destructive"}
                  >
                    {s === "ok" ? "OK" : s === "missing" ? "Nicht konfiguriert" : "Fehler"}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {friendlyMessage(key, p)}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {data && (
        <p className="text-xs text-muted-foreground">
          Zuletzt geprüft: {new Date(data.generated_at).toLocaleString()}
        </p>
      )}
    </div>
  );
}
