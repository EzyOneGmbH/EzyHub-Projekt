import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BarChart3, RefreshCw, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  clientId: string;
  domain?: string | null;
}

export function AhrefsPanel({ clientId, domain }: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  // true = Anzeige stammt aus dem letzten gespeicherten Lauf (audit_runs),
  // false = frisch per Button abgerufen. Der Populate-Job befüllt audit_runs
  // für alle Kunden, daher zeigt das Panel beim Öffnen sofort Daten.
  const [fromStore, setFromStore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: row } = await supabase
        .from("audit_runs")
        .select("result, finished_at")
        .eq("client_id", clientId)
        .eq("audit_type", "ahrefs")
        .eq("status", "succeeded")
        .order("finished_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      // Nur Läufe mit Quell-Label automatisch anzeigen (Ahrefs seit 09.09.2026,
      // DataForSEO 06.08.–09.09.); Läufe ohne `source` stammen aus der Zeit vor
      // dem Panel-Autoload und werden nicht vorgeladen.
      const src = (row?.result as any)?.source;
      if (!cancelled && row?.result && (src === "ahrefs" || src === "dataforseo")) {
        setData(row.result);
        setFromStore(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const res = await fetch("/api/ahrefs/overview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ clientId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData(json);
      setFromStore(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Backlinks &amp; Autorität</h2>
          <Badge variant="secondary">
            {data?.source === "dataforseo" ? "DataForSEO" : "Ahrefs"}
          </Badge>
          {domain && <Badge variant="outline">{domain}</Badge>}
        </div>
        <Button onClick={run} disabled={loading || !domain} size="sm">
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {data ? "Aktualisieren" : "Daten abrufen"}
        </Button>
      </div>

      {!domain && (
        <p className="text-sm text-muted-foreground">Diesem Kunden ist keine Domain zugeordnet.</p>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      {data && (
        <div className="space-y-3">
          {data.rate_limited && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-600">
              Ahrefs Rate-Limit erreicht — bitte später erneut versuchen.
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Section
              title={data.source === "dataforseo" ? "Autorität (DFS-Rank)" : "Domain Rating"}
              payload={data.domain_rating}
              error={data.errors?.domain_rating}
            />
            <Section
              title="Backlinks Stats"
              payload={data.backlinks_stats}
              error={data.errors?.backlinks_stats}
            />
            <Section
              title="Refdomains (90d)"
              payload={data.refdomains_history}
              error={data.errors?.refdomains_history}
            />
            <Section title="Metrics" payload={data.metrics} error={data.errors?.metrics} />
          </div>
          <p className="text-xs text-muted-foreground">
            {fromStore ? "Stand vom" : "Geprüft:"}{" "}
            {new Date(data.generated_at).toLocaleString("de-DE")}
            {fromStore
              ? " (gespeicherter Lauf — „Aktualisieren“ holt Live-Daten)"
              : " — Ergebnis in audit_runs gespeichert."}
          </p>
        </div>
      )}
    </Card>
  );
}

function Section({
  title,
  payload,
  error,
}: {
  title: string;
  payload: unknown;
  error?: string | null;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">{title}</span>
        <Badge variant={error ? "destructive" : payload ? "default" : "outline"}>
          {error ? "Fehler" : payload ? "OK" : "Leer"}
        </Badge>
      </div>
      {error ? (
        <p className="text-xs text-muted-foreground break-words">{error}</p>
      ) : (
        <pre className="max-h-32 overflow-auto rounded bg-muted/40 p-2 text-[10px] leading-tight">
          {payload ? JSON.stringify(payload, null, 2) : "—"}
        </pre>
      )}
    </div>
  );
}
