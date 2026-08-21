import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { EzyHexMark } from "@/ezy/shell";

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

// Redesign 1b (21.08.2026, Screen 2d): Glas-Karte auf Hex-Grund mit
// Radial-Glows; Formular-Logik (zod + Supabase + toast) unverändert.
const HEX_BG = `url("data:image/svg+xml,%3Csvg width='28' height='49' viewBox='0 0 28 49' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z' fill='%2377008C' fill-opacity='0.04' fill-rule='evenodd'/%3E%3C/svg%3E")`;

const inputStyle: React.CSSProperties = {
  height: 44,
  border: "1px solid rgba(43,0,51,.13)",
  borderRadius: 12,
  background: "#fff",
  padding: "0 14px",
  fontSize: 13.5,
  color: "#0D0D0D",
  fontFamily: "inherit",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

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
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "#F6F4F7",
        backgroundImage: HEX_BG,
        fontFamily: "'Aceh Soft','Nunito Sans','Segoe UI',system-ui,sans-serif",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <style>{`.login-inp:focus{border:1.5px solid #77008C;box-shadow:0 0 0 3px rgba(119,0,140,.10)}`}</style>
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 70% 55% at 50% -10%,rgba(119,0,140,.11),transparent),radial-gradient(ellipse 50% 40% at 100% 110%,rgba(185,0,156,.07),transparent)",
        }}
      />
      <form
        onSubmit={onSubmit}
        style={{
          position: "relative",
          width: 372,
          maxWidth: "100%",
          background: "rgba(255,255,255,.9)",
          backdropFilter: "blur(20px)",
          border: "1px solid rgba(43,0,51,.08)",
          borderRadius: 20,
          padding: 36,
          boxSizing: "border-box",
          boxShadow: "0 1px 2px rgba(43,0,51,.04), 0 24px 60px -36px rgba(43,0,51,.35)",
        }}
      >
        <div style={{ marginBottom: 20 }}>
          <EzyHexMark size={40} />
        </div>
        <h1
          style={{
            margin: 0,
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: "-.02em",
            color: "#0D0D0D",
            fontFamily: "'Kamerik 105',Poppins,sans-serif",
          }}
        >
          Anmelden
        </h1>
        <p style={{ margin: "5px 0 0", fontSize: 13.5, color: "#5d5563" }}>
          Willkommen zurück bei Ezy One.
        </p>
        <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 14 }}>
          <input
            id="email"
            className="login-inp"
            type="email"
            aria-label="E-Mail"
            placeholder="E-Mail"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={inputStyle}
          />
          <input
            id="password"
            className="login-inp"
            type="password"
            aria-label="Passwort"
            placeholder="Passwort"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={inputStyle}
          />
          <button
            type="submit"
            disabled={loading}
            style={{
              height: 44,
              border: "none",
              borderRadius: 12,
              background: "linear-gradient(135deg,#71008B,#B9009C)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
              fontFamily: "inherit",
              cursor: loading ? "wait" : "pointer",
              opacity: loading ? 0.7 : 1,
              boxShadow: "0 8px 20px -8px rgba(119,0,140,.5)",
            }}
          >
            {loading ? "Anmelden…" : "Anmelden"}
          </button>
        </div>
        {/* Zugang nur per Einladung (RBAC 2026-07-15): Google-Login + Self-Signup
            bewusst entfernt. Neue Nutzer legt der SuperAdmin ueber Team an. */}
        <p style={{ margin: "22px 0 0", textAlign: "center", fontSize: 12, color: "#8b8092" }}>
          Der Zugang erfolgt ausschliesslich per Einladung.
        </p>
      </form>
      <div
        style={{
          position: "absolute",
          bottom: 18,
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 11.5,
          color: "#a49dab",
        }}
      >
        Ezy One — SEO &amp; GEO Plattform
      </div>
    </div>
  );
}
