import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Sparkles, Users, ListTodo, Bot } from "lucide-react";

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
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2 font-bold text-foreground">
            <Sparkles className="h-5 w-5 text-primary" />
            EZY ONE TOOL
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

      <section className="mx-auto max-w-4xl px-6 py-24 text-center">
        <h1 className="text-5xl font-bold tracking-tight text-foreground sm:text-6xl">
          Dein Team-Tool. <span className="text-primary">Kunden, Aufgaben & KI.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
          Verwalte Kunden, organisiere Aufgaben und lass dir von KI helfen — alles in einer App.
        </p>
        <div className="mt-10 flex justify-center gap-4">
          <Button asChild size="lg">
            <Link to="/signup">Jetzt starten</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/login">Anmelden</Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            { icon: Users, title: "Kunden", text: "Alle Kontakte und Notizen an einem Ort." },
            { icon: ListTodo, title: "Aufgaben", text: "Status, Priorität, Fälligkeit, Zuweisung." },
            { icon: Bot, title: "KI-Hilfe", text: "Zusammenfassen, Vorschläge & Chat über deine Daten." },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border border-border bg-card p-6">
              <f.icon className="h-6 w-6 text-primary" />
              <h3 className="mt-4 font-semibold text-foreground">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
