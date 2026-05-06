import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import {
  ga4Summary,
  getGoogleConnectionStatus,
  gscKeywordImport,
  disconnectGoogle,
} from "@/server/google.functions";
import { Loader2, Link2, Unplug, Download, BarChart3 } from "lucide-react";
import { toast } from "sonner";

type Props = {
  clientId: string;
  gscProperty: string | null;
  ga4Property: string | null;
  onPropertiesChange: (props: { gsc_property?: string | null; ga4_property?: string | null }) => void;
};

type Status = { connected: boolean; email: string | null; scopes: string[]; updatedAt: string | null };

export function GoogleConnectPanel({ clientId, gscProperty, ga4Property, onPropertiesChange }: Props) {
  const { isOrgAdmin } = useAuth();
  const getStatus = useServerFn(getGoogleConnectionStatus);
  const importKeywords = useServerFn(gscKeywordImport);
  const ga4 = useServerFn(ga4Summary);
  const disconnect = useServerFn(disconnectGoogle);

  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"connect" | "import" | "ga4" | "disconnect" | null>(null);
  const [importResult, setImportResult] = useState<any>(null);
  const [ga4Result, setGa4Result] = useState<any>(null);
  const [gsc, setGsc] = useState(gscProperty ?? "");
  const [ga4P, setGa4P] = useState(ga4Property ?? "");

  const reload = async () => {
    setLoading(true);
    try {
      setStatus((await getStatus({ data: { clientId } })) as Status);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const saveProps = async () => {
    const update = { gsc_property: gsc || null, ga4_property: ga4P || null };
    const { error } = await supabase.from("clients").update(update).eq("id", clientId);
    if (error) return toast.error(error.message);
    onPropertiesChange(update);
    toast.success("Properties gespeichert");
  };

  const connect = async () => {
    setBusy("connect");
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(`/api/google/oauth/start?client_id=${encodeURIComponent(clientId)}`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const json = await res.json();
      if (!res.ok || !json.url) throw new Error(json.error || `HTTP ${res.status}`);
      const popup = window.open(json.url, "google-oauth", "width=520,height=640");
      // poll for completion
      const interval = setInterval(async () => {
        if (popup?.closed) {
          clearInterval(interval);
          await reload();
        }
      }, 1000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const runImport = async () => {
    setBusy("import");
    setImportResult(null);
    try {
      const r = await importKeywords({ data: { clientId, days: 28, rowLimit: 50 } });
      setImportResult(r);
      if (r.ok) toast.success(`${r.imported} Keywords importiert`);
      else toast.error(r.error || "Fehler");
    } finally {
      setBusy(null);
    }
  };

  const runGa4 = async () => {
    setBusy("ga4");
    setGa4Result(null);
    try {
      const r = await ga4({ data: { clientId, days: 28 } });
      setGa4Result(r);
      if (!r.ok) toast.error(r.error || "Fehler");
    } finally {
      setBusy(null);
    }
  };

  const runDisconnect = async () => {
    if (!confirm("Google-Verbindung wirklich entfernen?")) return;
    setBusy("disconnect");
    try {
      const r = await disconnect({ data: { clientId } });
      if (r.ok) {
        toast.success("Getrennt");
        await reload();
      } else toast.error(r.error || "Fehler");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Google (Search Console & GA4)</h2>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : status?.connected ? (
          <Badge>Verbunden{status.email ? ` · ${status.email}` : ""}</Badge>
        ) : (
          <Badge variant="outline">Nicht verbunden</Badge>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label>GSC Property</Label>
          <Input
            placeholder="sc-domain:example.com oder https://example.com/"
            value={gsc}
            disabled={!isOrgAdmin}
            onChange={(e) => setGsc(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label>GA4 Property ID</Label>
          <Input
            placeholder="properties/123456789"
            value={ga4P}
            disabled={!isOrgAdmin}
            onChange={(e) => setGa4P(e.target.value)}
          />
        </div>
      </div>

      {isOrgAdmin && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" onClick={saveProps}>
            Properties speichern
          </Button>
          {status?.connected ? (
            <>
              <Button onClick={runImport} disabled={busy !== null}>
                {busy === "import" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                GSC-Keywords importieren
              </Button>
              <Button variant="outline" onClick={runGa4} disabled={busy !== null}>
                {busy === "ga4" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BarChart3 className="mr-2 h-4 w-4" />}
                GA4 Summary
              </Button>
              <Button variant="ghost" onClick={runDisconnect} disabled={busy !== null} className="ml-auto">
                <Unplug className="mr-2 h-4 w-4" /> Trennen
              </Button>
            </>
          ) : (
            <Button onClick={connect} disabled={busy !== null}>
              {busy === "connect" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
              Google verbinden
            </Button>
          )}
        </div>
      )}

      {importResult && (
        <div className="mt-4 rounded-md border border-border bg-muted/30 p-3 text-xs">
          <div className="mb-1 font-semibold">GSC Import</div>
          {importResult.ok ? (
            <div>
              <div>Importiert: {importResult.imported}</div>
              <div>
                Canonry:{" "}
                {importResult.canonry?.ok
                  ? `OK (${importResult.canonry.count})`
                  : `Fehler — ${importResult.canonry?.error ?? "n/a"}`}
              </div>
            </div>
          ) : (
            <div className="text-destructive">{importResult.error}</div>
          )}
        </div>
      )}

      {ga4Result && (
        <div className="mt-3 rounded-md border border-border bg-muted/30 p-3 text-xs">
          <div className="mb-1 font-semibold">GA4 (letzte {ga4Result.days} Tage)</div>
          {ga4Result.ok ? (
            <div className="grid grid-cols-4 gap-2">
              <Metric label="Sessions" value={ga4Result.metrics.sessions} />
              <Metric label="Users" value={ga4Result.metrics.totalUsers} />
              <Metric label="Engaged" value={ga4Result.metrics.engagedSessions} />
              <Metric label="Pageviews" value={ga4Result.metrics.screenPageViews} />
            </div>
          ) : (
            <div className="text-destructive">{ga4Result.error}</div>
          )}
        </div>
      )}
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-base font-bold">{value.toLocaleString("de-DE")}</div>
    </div>
  );
}
