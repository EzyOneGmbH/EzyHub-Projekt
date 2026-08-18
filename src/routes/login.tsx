import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { EzyOneMark } from "@/components/ezy-one-mark";

export const Route = createFileRoute("/login")({
  // Typecheck-Fix (2026-08-18): next als OPTIONALER Key — sonst verlangt der
  // Router bei jedem `to: "/login"` einen search-Param (TS2345 in app-shell,
  // health, llm-ueberblick, signup). Verhalten identisch.
  validateSearch: (s: Record<string, unknown>): { next?: string } =>
    typeof s.next === "string" && s.next.startsWith("/") && !s.next.startsWith("//")
      ? { next: s.next }
      : {},
  component: LoginPage,
});

const schema = z.object({
  email: z.string().trim().email("Ungültige E-Mail").max(255),
  password: z.string().min(6, "Mindestens 6 Zeichen").max(72),
});

function LoginPage() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const goNext = () => {
    if (next) window.location.href = next;
    else navigate({ to: "/apps" }); // Plattform-Umbau Phase 1: Launcher statt Dashboard
  };
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    goNext();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-sm">
        <Link to="/" className="flex items-center gap-2.5 font-bold text-foreground">
          {/* CD-Symbol: neues Marken-Icon (E + Power-O im Hexagon) + Wortmarke "Ezy One". */}
          <EzyOneMark width={26} />
          Ezy One
        </Link>
        <h1 className="mt-6 text-2xl font-bold text-foreground">Anmelden</h1>
        <p className="mt-1 text-sm text-muted-foreground">Willkommen zurück.</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">E-Mail</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Passwort</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Anmelden..." : "Anmelden"}
          </Button>
        </form>

        {/* Zugang nur per Einladung (RBAC 2026-07-15): Google-Login + Self-Signup
            bewusst entfernt. Neue Nutzer legt der SuperAdmin ueber Team an. */}
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Der Zugang erfolgt ausschließlich per Einladung.
        </p>
      </div>
    </div>
  );
}
