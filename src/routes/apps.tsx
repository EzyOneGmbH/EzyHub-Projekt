import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useAppAccess } from "@/ezy/data/useAppAccess";
import { EZY_APPS, type EzyAppDef, type EzyAppId } from "@/ezy/data/appRegistry";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/apps")({
  component: AppsLauncher,
});

// Plattform-Umbau Phase 1 (2026-07-31): App-Launcher nach dem Login (Atlassian-
// Muster). Kacheln nach Rolle + app_access; gesperrte Apps bleiben sichtbar
// (Mitarbeiter sollen wissen, was es gibt), Klick führt aber nirgendwo hin.
// Viewer (Kunden-Logins) überspringen den Launcher komplett.
function AppsLauncher() {
  const navigate = useNavigate();
  const { session, loading, role, signOut, user } = useAuth();
  const { canOpen, loading: accessLoading } = useAppAccess();
  const [hover, setHover] = useState<string | null>(null);
  // Feinschliff (01.08.): Live-Badges auf den Kacheln — offene Entwürfe der
  // Reaktivierungsmaschine + offene Freigaben (Admin). Fehler = still kein Badge.
  const [badges, setBadges] = useState<Partial<Record<EzyAppId, string>>>({});
  useEffect(() => {
    if (loading || !session || accessLoading) return;
    let alive = true;
    (async () => {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const H = { Authorization: `Bearer ${token || ""}` };
      const jobs: Array<Promise<void>> = [];
      if (canOpen("reakt")) jobs.push(
        fetch("/api/agent/reakt?what=status", { headers: H })
          .then((r) => r.json())
          .then((j) => {
            if (!alive || !j?.ok) return;
            let n = 0;
            for (const w of j.waves || []) n += Number(w?.byStatus?.ENTWURF || 0);
            if (n > 0) setBadges((b) => ({ ...b, reakt: `${n} Entwürfe` }));
          })
          .catch(() => { /* still: kein Badge */ }),
      );
      if (canOpen("admin")) jobs.push(
        fetch("/api/agent/approvals", { headers: H })
          .then((r) => r.json())
          .then((j) => {
            if (!alive) return;
            const n = Number(j?.openCount || 0);
            if (n > 0) setBadges((b) => ({ ...b, admin: `${n} Freigaben` }));
          })
          .catch(() => { /* still: kein Badge */ }),
      );
      await Promise.all(jobs);
    })();
    return () => { alive = false; };
  }, [loading, session, accessLoading, canOpen]);

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/login", search: { next: undefined }, replace: true });
  }, [loading, session, navigate]);
  useEffect(() => {
    if (!loading && role === "viewer") window.location.replace("/dashboard");
  }, [loading, role]);

  if (loading || !session || role === "viewer") return null;

  const S = {
    bg: "#0b0e14", panel: "#12161f", panel2: "#181d29", line: "#232a3a",
    txt: "#e8eaf2", mut: "#8a92a6", acc: "#8b8df5",
  };

  const tile = (a: EzyAppDef) => {
    const allowed = canOpen(a.id);
    const isHover = hover === a.id && allowed;
    return (
      <a
        key={a.id}
        href={allowed ? a.href : undefined}
        onMouseEnter={() => setHover(a.id)}
        onMouseLeave={() => setHover(null)}
        aria-disabled={!allowed}
        style={{
          display: "block", textDecoration: "none", color: S.txt,
          background: S.panel2, borderRadius: 12, padding: 18,
          border: `1px solid ${isHover ? a.color : S.line}`,
          opacity: allowed ? 1 : 0.45,
          cursor: allowed ? "pointer" : "not-allowed",
          transition: "border-color .15s, transform .15s",
          transform: isHover ? "translateY(-2px)" : "none",
          position: "relative",
        }}
      >
        {allowed && badges[a.id] && (
          <span style={{
            position: "absolute", top: 12, right: 12, fontSize: 10.5, fontWeight: 700,
            color: a.color, background: a.tint, border: `1px solid ${a.color}40`,
            borderRadius: 99, padding: "3px 9px", letterSpacing: ".02em",
          }}>{badges[a.id]}</span>
        )}
        <div style={{
          width: 38, height: 38, borderRadius: 9, background: a.tint,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 19, marginBottom: 12,
        }}>{a.icon}</div>
        <div style={{ fontWeight: 700, fontSize: 15.5, color: a.color, marginBottom: 4 }}>{a.name}</div>
        <div style={{ fontSize: 12.5, color: S.mut, lineHeight: 1.5 }}>{a.desc}</div>
        <div style={{ marginTop: 10, fontSize: 11, color: allowed ? S.mut : "#fbbf24" }}>
          {allowed ? "Öffnen →" : "🔒 kein Zugriff — beim Admin anfragen"}
        </div>
      </a>
    );
  };

  return (
    <div className="launcher-page" style={{
      minHeight: "100vh", background: S.bg, color: S.txt,
      fontFamily: '"Segoe UI",system-ui,-apple-system,sans-serif',
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "9vh 24px 40px",
    }}>
      {/* Mobile (01.08.): weniger Kopfraum, volle Breite */}
      <style>{`@media(max-width:600px){.launcher-page{padding:20px 14px 32px!important}}`}</style>
      <div style={{ width: "100%", maxWidth: 880 }}>
        <div style={{ textAlign: "center", marginBottom: 34 }}>
          <div style={{ fontWeight: 700, fontSize: 21 }}>
            ✦ Ezy<span style={{ color: S.acc }}>Hub</span>
          </div>
          <div style={{ color: S.mut, fontSize: 14, marginTop: 6 }}>Womit möchtest du arbeiten?</div>
        </div>

        <div style={{
          display: "grid", gap: 14,
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        }}>
          {accessLoading
            ? <div style={{ color: S.mut, fontSize: 13, gridColumn: "1/-1", textAlign: "center", padding: 40 }}>Lade Apps…</div>
            : EZY_APPS.map(tile)}
        </div>

        <div style={{
          marginTop: 36, paddingTop: 16, borderTop: `1px solid ${S.line}`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          fontSize: 12, color: S.mut,
        }}>
          <span>Angemeldet als {user?.email}</span>
          <button
            onClick={async () => { await signOut(); navigate({ to: "/login", search: { next: undefined }, replace: true }); }}
            style={{
              background: "none", border: `1px solid ${S.line}`, color: S.mut,
              borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 12,
            }}
          >
            Abmelden
          </button>
        </div>
      </div>
    </div>
  );
}
