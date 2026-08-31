import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
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
  const [zeigen, setZeigen] = useState(false);

  // Dunkle Karte + shadcn-Defaults (helles Theme) = unsichtbare Felder
  // (Volkan 31.08., Screenshot). Deshalb explizite Dark-Styles wie der Rest
  // der Seite.
  const feldStil: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "11px 42px 11px 13px",
    borderRadius: 10,
    border: "1px solid #43305a",
    background: "#140a1c",
    color: "#f2edf7",
    fontSize: 14,
    fontFamily: "inherit",
    outline: "none",
  };
  const labelStil: React.CSSProperties = {
    display: "block",
    fontSize: 12.5,
    fontWeight: 600,
    color: "#c9bfd6",
    marginBottom: 6,
  };

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
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#0b0410",
        backgroundImage: `url("data:image/svg+xml,%3Csvg width='28' height='49' viewBox='0 0 28 49' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z' fill='%23B9009C' fill-opacity='0.05' fill-rule='evenodd'/%3E%3C/svg%3E")`,
        padding: 20,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          background: "#1c1024",
          border: "1px solid #302039",
          borderRadius: 16,
          padding: 32,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          {/* CD-Symbol: neues Marken-Icon (E + Power-O im Hexagon) + Wortmarke "Ezy One". */}
          <EzyOneMark width={26} />
          <span style={{ fontSize: 18, fontWeight: 700, color: "#ece6f0" }}>Ezy One</span>
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#e2e4f0", margin: "8px 0 4px" }}>
          Passwort festlegen
        </h1>
        <p style={{ fontSize: 13, color: "#8a94a8", margin: "0 0 20px" }}>
          Lege dein persönliches Passwort fest, um dein EzyHub-Konto zu aktivieren.
        </p>

        {!ready ? (
          <p style={{ color: "#8a94a8", fontSize: 13 }}>Einladung wird geprüft…</p>
        ) : !hasSession ? (
          <div style={{ fontSize: 13, color: "#e0a458" }}>
            Dieser Einladungslink ist ungültig oder abgelaufen. Bitte den SuperAdmin um eine neue
            Einladung.
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label htmlFor="pw" style={labelStil}>
                Neues Passwort
              </label>
              <div style={{ position: "relative" }}>
                <input
                  id="pw"
                  type={zeigen ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mindestens 8 Zeichen"
                  autoFocus
                  autoComplete="new-password"
                  style={feldStil}
                />
                <button
                  type="button"
                  onClick={() => setZeigen((v) => !v)}
                  aria-label={zeigen ? "Passwort verbergen" : "Passwort anzeigen"}
                  style={{
                    position: "absolute",
                    right: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    color: "#9a8bab",
                    cursor: "pointer",
                    display: "flex",
                    padding: 4,
                  }}
                >
                  {zeigen ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="pw2" style={labelStil}>
                Passwort bestätigen
              </label>
              <input
                id="pw2"
                type={zeigen ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                style={feldStil}
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              style={{
                marginTop: 4,
                padding: "12px 16px",
                borderRadius: 10,
                border: "none",
                background: busy ? "#5d2a6e" : "#9c00a8",
                color: "#fff",
                fontSize: 14,
                fontWeight: 700,
                fontFamily: "inherit",
                cursor: busy ? "default" : "pointer",
              }}
            >
              {busy ? "Wird gespeichert…" : "Passwort setzen & anmelden"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
