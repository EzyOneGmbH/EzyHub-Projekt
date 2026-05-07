import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Sparkles, FileText, Search, BarChart3, Users, Bot, Globe } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && session) navigate({ to: "/dashboard" });
  }, [loading, session, navigate]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/50 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2 font-bold">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-[image:var(--gradient-primary)] shadow-[var(--shadow-elegant)]">
              <Sparkles className="h-4 w-4 text-primary-foreground" />
            </span>
            <span className="bg-clip-text text-transparent bg-[image:var(--gradient-primary)]">
              EZY ONE
            </span>
            <span className="text-xs font-medium text-muted-foreground">SEO &amp; GEO</span>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="ghost">
              <Link to="/login">Anmelden</Link>
            </Button>
            <Button asChild>
              <Link to="/signup">Registrieren</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="relative mx-auto max-w-5xl px-6 py-24 text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
          <Globe className="h-3 w-3 text-primary" /> SEO + GEO Plattform für Agenturen
        </div>
        <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">
          Eine Plattform.{" "}
          <span className="bg-clip-text text-transparent bg-[image:var(--gradient-primary)]">
            Alle Kunden.
          </span>
          <br />
          Alle SEO &amp; GEO Tools.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
          Verwalte Kunden, recherchiere live, generiere Content mit KI und behalte SEO-Daten im
          Blick — alles in einem Premium-Dashboard.
        </p>
        <div className="mt-10 flex justify-center gap-3">
          <Button asChild size="lg" className="shadow-[var(--shadow-elegant)]">
            <Link to="/signup">Kostenlos starten</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/login">Anmelden</Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              icon: Users,
              title: "Multi-Kunden CRM",
              text: "Kontakte, Notizen und Aufgaben zentral verwalten.",
            },
            {
              icon: FileText,
              title: "Content-Editor",
              text: "Blog, Landing & GEO-Inhalte mit Status-Workflow.",
            },
            {
              icon: Search,
              title: "Live-Recherche",
              text: "Perplexity-Suche mit Quellenangabe direkt im Editor.",
            },
            {
              icon: BarChart3,
              title: "SEO-Daten",
              text: "Ahrefs Domain-Rating und Backlink-Insights.",
            },
            {
              icon: Bot,
              title: "KI-Generierung",
              text: "Outlines & Texte über das Lovable AI Gateway.",
            },
            {
              icon: Sparkles,
              title: "Tool-Toggles",
              text: "Aktiviere Tools individuell pro Kunde.",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-border bg-card p-6 shadow-[var(--shadow-card)] transition-all hover:border-primary/50"
            >
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
                <f.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
