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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Save, Trash2, Sparkles, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/content/$id")({
  component: ContentEditor,
});

type Client = { id: string; name: string };

function ContentEditor() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const [item, setItem] = useState<any>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [research, setResearch] = useState<{ content: string; citations: string[] } | null>(null);
  const [researchBusy, setResearchBusy] = useState(false);
  const [researchQuery, setResearchQuery] = useState("");

  useEffect(() => {
    (async () => {
      const [itemRes, custRes] = await Promise.all([
        supabase.from("content_items").select("*").eq("id", id).maybeSingle(),
        supabase.from("clients").select("id,name").order("name"),
      ]);
      setItem(itemRes.data);
      setClients((custRes.data ?? []) as Client[]);
      if (itemRes.data?.title) setResearchQuery(itemRes.data.title);
    })();
  }, [id]);

  if (!item) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">Lädt...</p>
      </AppShell>
    );
  }

  const canEdit = item.created_by === user?.id || isAdmin;

  const save = async () => {
    const { error } = await supabase
      .from("content_items")
      .update({
        title: item.title,
        body: item.body,
        content_type: item.content_type,
        status: item.status,
        language: item.language,
        target_url: item.target_url,
        client_id: item.client_id,
        keywords:
          typeof item.keywords === "string"
            ? item.keywords
                .split(",")
                .map((s: string) => s.trim())
                .filter(Boolean)
            : item.keywords,
      })
      .eq("id", id);
    if (error) toast.error(error.message);
    else toast.success("Gespeichert");
  };

  const del = async () => {
    if (!confirm("Wirklich löschen?")) return;
    const { error } = await supabase.from("content_items").delete().eq("id", id);
    if (error) toast.error(error.message);
    else navigate({ to: "/content" });
  };

  const aiGenerate = async () => {
    setAiBusy(true);
    const prompt = `Erstelle einen ${item.content_type}-Text auf ${item.language} zum Thema: "${item.title}".${
      item.keywords?.length
        ? ` Keywords: ${(Array.isArray(item.keywords) ? item.keywords : []).join(", ")}.`
        : ""
    } Schreibe SEO-optimiert mit klarer Struktur (H2/H3) und Mehrwert.`;
    const { data, error } = await supabase.functions.invoke("ai-summarize", {
      body: { text: prompt, mode: "generate" },
    });
    setAiBusy(false);
    if (error) return toast.error(error.message);
    setItem({ ...item, body: data?.summary ?? data?.text ?? "" });
    toast.success("Entwurf eingefügt — bitte prüfen und speichern");
  };

  const doResearch = async () => {
    if (!researchQuery.trim()) return;
    if (!item.client_id) {
      toast.error("Bitte zuerst einen Kunden zuweisen.");
      return;
    }
    setResearchBusy(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const r = await fetch("/api/perplexity/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          query: researchQuery,
          model: "sonar",
          clientId: item.client_id,
        }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? `HTTP ${r.status}`);
      setResearch(json);
    } catch (e: any) {
      toast.error(e.message ?? "Recherche fehlgeschlagen");
    } finally {
      setResearchBusy(false);
    }
  };

  return (
    <AppShell>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate({ to: "/content" })}
        className="mb-4"
      >
        <ArrowLeft className="mr-2 h-4 w-4" /> Zurück
      </Button>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Titel</Label>
              <Input
                value={item.title ?? ""}
                disabled={!canEdit}
                onChange={(e) => setItem({ ...item, title: e.target.value })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label>Typ</Label>
                <Select
                  value={item.content_type}
                  disabled={!canEdit}
                  onValueChange={(v) => setItem({ ...item, content_type: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blog">Blog</SelectItem>
                    <SelectItem value="landing">Landingpage</SelectItem>
                    <SelectItem value="geo">GEO / Local</SelectItem>
                    <SelectItem value="social">Social</SelectItem>
                    <SelectItem value="other">Sonstiges</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Status</Label>
                <Select
                  value={item.status}
                  disabled={!canEdit}
                  onValueChange={(v) => setItem({ ...item, status: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Entwurf</SelectItem>
                    <SelectItem value="review">Review</SelectItem>
                    <SelectItem value="published">Veröffentlicht</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Sprache</Label>
                <Input
                  value={item.language ?? "de"}
                  disabled={!canEdit}
                  onChange={(e) => setItem({ ...item, language: e.target.value })}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Kunde</Label>
                <Select
                  value={item.client_id ?? "none"}
                  disabled={!canEdit}
                  onValueChange={(v) => setItem({ ...item, client_id: v === "none" ? null : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Kein Kunde" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Kein Kunde</SelectItem>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Ziel-URL</Label>
                <Input
                  value={item.target_url ?? ""}
                  disabled={!canEdit}
                  placeholder="https://..."
                  onChange={(e) => setItem({ ...item, target_url: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Keywords (kommagetrennt)</Label>
              <Input
                value={
                  Array.isArray(item.keywords) ? item.keywords.join(", ") : (item.keywords ?? "")
                }
                disabled={!canEdit}
                onChange={(e) => setItem({ ...item, keywords: e.target.value })}
              />
            </div>

            <div className="space-y-1">
              <Label>Inhalt</Label>
              <Textarea
                rows={16}
                value={item.body ?? ""}
                disabled={!canEdit}
                onChange={(e) => setItem({ ...item, body: e.target.value })}
                className="font-mono text-sm"
              />
            </div>

            {canEdit && (
              <div className="flex flex-wrap gap-2 pt-2">
                <Button onClick={save}>
                  <Save className="mr-2 h-4 w-4" /> Speichern
                </Button>
                <Button variant="outline" onClick={aiGenerate} disabled={aiBusy}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  {aiBusy ? "Generiere..." : "KI-Entwurf"}
                </Button>
                <Button variant="destructive" onClick={del} className="ml-auto">
                  <Trash2 className="mr-2 h-4 w-4" /> Löschen
                </Button>
              </div>
            )}
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            <Search className="h-4 w-4 text-primary" /> Web-Recherche
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Live-Suche via Perplexity mit Quellenangaben.
          </p>
          <div className="space-y-2">
            <Input
              value={researchQuery}
              onChange={(e) => setResearchQuery(e.target.value)}
              placeholder="Suchanfrage..."
            />
            <Button onClick={doResearch} disabled={researchBusy} className="w-full">
              {researchBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Search className="mr-2 h-4 w-4" />
              )}
              Recherchieren
            </Button>
          </div>
          {research && (
            <div className="mt-4 space-y-3">
              <div className="rounded-md border border-border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
                {research.content}
              </div>
              {research.citations.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Quellen</p>
                  <ul className="space-y-1">
                    {research.citations.map((c, i) => (
                      <li key={i} className="truncate text-xs">
                        <a
                          href={c}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          {c}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
