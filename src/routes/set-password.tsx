import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";

// Passwort setzen — Ziel des Einladungs-/Recovery-Links (RBAC 2026-07-15).
// supabase-js (detectSessionInUrl) tauscht den Token aus dem URL-Hash automatisch
// in eine Session; danach kann der Nutzer sein Passwort setzen (updateUser).
export const Route = createFileRoute("/set-password")({
  component: SetPasswordPage,
});

const schema = z.object({
  password: z.string().min(8, "Mindestens 8 Zeichen").max(72),
});

function SetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Nach dem Klick auf den Einladungslink erzeugt supabase-js aus dem
    // URL-Hash eine Session (invite/recovery). Wir warten kurz darauf.
    let mounted = true;
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (mounted) {
        setHasSession(!!s);
        setReady(true);
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setHasSession(!!data.session);
        setReady(true);
      }
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    if (password !== confirm) {
      toast.error("Die Passwörter stimmen nicht überein.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Passwort gesetzt — willkommen!");
    void navigate({ to: "/dashboard" });
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0b0d14", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 400, background: "#151823", border: "1px solid #262a3a", borderRadius: 16, padding: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <Sparkles size={22} color="#8b7cff" />
          <span style={{ fontSize: 18, fontWeight: 700, color: "#e2e4f0" }}>EZY ONE</span>
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#e2e4f0", margin: "8px 0 4px" }}>Passwort festlegen</h1>
        <p style={{ fontSize: 13, color: "#8a94a8", margin: "0 0 20px" }}>
          Lege dein persönliches Passwort fest, um dein EZY ONE-Konto zu aktivieren.
        </p>

        {!ready ? (
          <p style={{ color: "#8a94a8", fontSize: 13 }}>Einladung wird geprüft…</p>
        ) : !hasSession ? (
          <div style={{ fontSize: 13, color: "#e0a458" }}>
            Dieser Einladungslink ist ungültig oder abgelaufen. Bitte den SuperAdmin um eine neue Einladung.
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <Label htmlFor="pw">Neues Passwort</Label>
              <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mindestens 8 Zeichen" autoFocus />
            </div>
            <div>
              <Label htmlFor="pw2">Passwort bestätigen</Label>
              <Input id="pw2" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? "Wird gespeichert…" : "Passwort setzen & anmelden"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
