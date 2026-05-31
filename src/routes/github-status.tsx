import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  GitBranch,
  GitCommit,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";

const REPO_OWNER = "EzyOneGmbH";
const REPO_NAME = "ezy-one-tool-980a32b9";
const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;
const API_BASE = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`;

type Commit = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name: string; email: string; date: string };
  };
  author: { login: string; avatar_url: string; html_url: string } | null;
};

type RepoInfo = {
  default_branch: string;
  pushed_at: string;
  updated_at: string;
  html_url: string;
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub API: HTTP ${res.status}`);
  return (await res.json()) as T;
}

function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `vor ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.floor(m / 60);
  if (h < 24) return `vor ${h} Std.`;
  const days = Math.floor(h / 24);
  return `vor ${days} Tag${days === 1 ? "" : "en"}`;
}

export const Route = createFileRoute("/github-status")({
  component: GitHubStatusPage,
  head: () => ({
    meta: [{ title: "GitHub-Sync-Status" }],
  }),
});

function GitHubStatusPage() {
  const repoQuery = useQuery({
    queryKey: ["github", "repo"],
    queryFn: () => fetchJson<RepoInfo>(API_BASE),
    refetchInterval: 60_000,
  });

  const commitsQuery = useQuery({
    queryKey: ["github", "commits"],
    queryFn: () => fetchJson<Commit[]>(`${API_BASE}/commits?per_page=10`),
    refetchInterval: 60_000,
  });

  const loading = repoQuery.isLoading || commitsQuery.isLoading;
  const error = repoQuery.error || commitsQuery.error;
  const commits = commitsQuery.data ?? [];
  const latest = commits[0];

  const refresh = () => {
    void repoQuery.refetch();
    void commitsQuery.refetch();
  };

  const syncFresh = repoQuery.data
    ? Date.now() - new Date(repoQuery.data.pushed_at).getTime() < 1000 * 60 * 60 * 24
    : false;

  return (
    <div className="container mx-auto max-w-3xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">GitHub-Sync-Status</h1>
          <p className="text-sm text-muted-foreground">
            Live-Status der bidirektionalen Synchronisation zwischen Lovable und GitHub.
          </p>
        </div>
        <Button onClick={refresh} disabled={loading} variant="outline" size="sm">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="ml-2">Aktualisieren</span>
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Status konnte nicht geladen werden</AlertTitle>
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      )}

      {repoQuery.data && (
        <Alert>
          {syncFresh ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          ) : (
            <AlertCircle className="h-4 w-4 text-amber-500" />
          )}
          <AlertTitle>
            {syncFresh ? "Sync aktiv" : "Längere Zeit kein Push"}
          </AlertTitle>
          <AlertDescription>
            Letzter Push auf <code>{repoQuery.data.default_branch}</code>:{" "}
            {timeAgo(repoQuery.data.pushed_at)} (
            {new Date(repoQuery.data.pushed_at).toLocaleString()})
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2">
              <GitBranch className="h-4 w-4" />
              Repository
            </span>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {REPO_OWNER}/{REPO_NAME}
              <ExternalLink className="h-3 w-3" />
            </a>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          {repoQuery.data ? (
            <>
              <div>
                Default-Branch: <Badge variant="secondary">{repoQuery.data.default_branch}</Badge>
              </div>
              <div>Repo aktualisiert: {new Date(repoQuery.data.updated_at).toLocaleString()}</div>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Lädt…
            </div>
          )}
        </CardContent>
      </Card>

      {latest && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <GitCommit className="h-4 w-4" />
              Letzter Commit
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="font-medium">
              {latest.commit.message.split("\n")[0]}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="font-mono">
                {latest.sha.slice(0, 7)}
              </Badge>
              <span>{latest.commit.author.name}</span>
              <span>·</span>
              <span>{timeAgo(latest.commit.author.date)}</span>
              <span>·</span>
              <a
                href={latest.html_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                Auf GitHub öffnen <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Commit-Verlauf (letzte 10)</CardTitle>
        </CardHeader>
        <CardContent>
          {commits.length === 0 && !loading ? (
            <p className="text-sm text-muted-foreground">Keine Commits gefunden.</p>
          ) : (
            <ul className="divide-y">
              {commits.map((c) => (
                <li key={c.sha} className="flex items-start gap-3 py-2 text-sm">
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {c.sha.slice(0, 7)}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <a
                      href={c.html_url}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate hover:underline"
                    >
                      {c.commit.message.split("\n")[0]}
                    </a>
                    <div className="text-xs text-muted-foreground">
                      {c.commit.author.name} · {timeAgo(c.commit.author.date)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Automatische Aktualisierung alle 60 Sekunden. Quelle: öffentliche GitHub-API.
      </p>
    </div>
  );
}
