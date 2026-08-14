import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { EzyOneMark } from "@/components/ezy-one-mark";

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
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#0b0410", backgroundImage: `url("data:image/svg+xml,%3Csvg width='28' height='49' viewBox='0 0 28 49' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z' fill='%23B9009C' fill-opacity='0.05' fill-rule='evenodd'/%3E%3C/svg%3E")`, padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 400, background: "#1c1024", border: "1px solid #302039", borderRadius: 16, padding: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          {/* CD-Symbol: neues Marken-Icon (E + Power-O im Hexagon) + Wortmarke "Ezy One". */}
          <EzyOneMark width={26} />
          <span style={{ fontSize: 18, fontWeight: 700, color: "#ece6f0" }}>Ezy One</span>
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#e2e4f0", margin: "8px 0 4px" }}>Passwort festlegen</h1>
        <p style={{ fontSize: 13, color: "#8a94a8", margin: "0 0 20px" }}>
          Lege dein persönliches Passwort fest, um dein EzyHub-Konto zu aktivieren.
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
