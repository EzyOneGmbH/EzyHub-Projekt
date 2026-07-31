import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useAppAccess } from "@/ezy/data/useAppAccess";
import { EZY_APPS } from "@/ezy/data/appRegistry";
import { useEzyClients } from "@/ezy/data/useEzyClients";
import { useEzyServiceSettings } from "@/ezy/data/useEzyServiceSettings";
import { AiVisibilityTab } from "@/ezy/EzyOneApp.jsx";

export const Route = createFileRoute("/ezyai")({
  component: EzyAiApp,
});

// Plattform-Umbau Phase 2 (2026-07-31): EzyAI als erste eigenständige App.
// Die Fach-Komponente (AiVisibilityTab) ist aus dem Dashboard UMGEZOGEN, nicht
// neu gebaut — diese Route liefert nur die App-Shell drumherum (Header mit
// App-Switcher, Kunden-Auswahl, Service-Gate). Muster für Phase 3.
const S = {
  bg: "#0f1117", panel: "#151824", line: "#232a3a",
  txt: "#e8eaf2", mut: "#8a92a6", app: "#a78bfa", appTint: "rgba(167,139,250,.15)",
};
const CLIENT_LS = "ezyai.clientId";

function EzyAiApp() {
  const navigate = useNavigate();
  const { session, loading: authLoading, role } = useAuth();
  const { canOpen, loading: accessLoading } = useAppAccess();
  const ezy = useEzyClients();
  const [swOpen, setSwOpen] = useState(false);
  const [clientId, setClientId] = useState(() => {
    try { return localStorage.getItem(CLIENT_LS) || ""; } catch { return ""; }
  });

  useEffect(() => {
    if (!authLoading && !session) navigate({ to: "/login", search: { next: "/ezyai" }, replace: true });
  }, [authLoading, session, navigate]);
  useEffect(() => {
    if (!authLoading && role === "viewer") window.location.replace("/dashboard");
  }, [authLoading, role]);
  useEffect(() => {
    // Member ohne EzyAI-Freigabe → zurück zum Launcher (Kachel dort erklärt es)
    if (!accessLoading && session && !canOpen("geo")) window.location.replace("/apps");
  }, [accessLoading, session, canOpen]);

  const clients = ezy.clients || [];
  const client = useMemo(
    () => clients.find((c: any) => c.id === clientId) || clients[0] || null,
    [clients, clientId],
  );
  useEffect(() => {
    if (client?.id) { try { localStorage.setItem(CLIENT_LS, client.id); } catch { /* egal */ } }
  }, [client?.id]);

  const svc = useEzyServiceSettings(client?.id);
  const aivisOn = svc.loading || svc.enabled?.canonry || svc.enabled?.perplexity;

  if (authLoading || !session || role === "viewer") return null;

  return (
    <div style={{ minHeight: "100vh", background: S.bg, color: S.txt, fontFamily: '"Segoe UI",system-ui,-apple-system,sans-serif' }}>
      {/* Mobile (01.08.): Header umbricht, Kunden-Select volle Breite, engere Paddings */}
      <style>{`@media(max-width:640px){
        .ezyai-head{flex-wrap:wrap!important;gap:8px!important;padding:8px 10px!important}
        .ezyai-head-right{margin-left:0!important;width:100%!important}
        .ezyai-head-right select{flex:1;max-width:none!important}
        .ezyai-main{padding:14px 10px 48px!important}
      }`}</style>
      {/* App-Header */}
      <header className="ezyai-head" style={{
        display: "flex", alignItems: "center", gap: 14, padding: "10px 18px",
        background: S.panel, borderBottom: `1px solid ${S.line}`,
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setSwOpen((v) => !v)}
            title="App wechseln"
            style={{ background: "none", border: "none", color: S.mut, fontSize: 16, cursor: "pointer", padding: "6px 8px", borderRadius: 8, letterSpacing: 1 }}
          >⣿</button>
          {swOpen && (
            <div style={{
              position: "absolute", top: "100%", left: 0, zIndex: 200, width: 240,
              background: S.panel, border: `1px solid ${S.line}`, borderRadius: 12,
              padding: 8, boxShadow: "0 14px 44px rgba(0,0,0,.55)",
            }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: S.mut, padding: "4px 10px 8px", fontWeight: 700 }}>Apps wechseln</div>
              {EZY_APPS.filter((a) => canOpen(a.id)).map((a) => {
                const active = a.id === "geo";
                return (
                  <a key={a.id} href={a.href}
                    onClick={(e) => { if (active) { e.preventDefault(); setSwOpen(false); } }}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
                      borderRadius: 8, fontSize: 13, textDecoration: "none",
                      color: active ? a.color : S.txt, background: active ? a.tint : "none",
                    }}>
                    <span style={{ width: 24, height: 24, borderRadius: 6, background: a.tint, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>{a.icon}</span>
                    {a.name}
                  </a>
                );
              })}
              <div style={{ borderTop: `1px solid ${S.line}`, margin: "8px 4px" }} />
              <a href="/apps" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, fontSize: 12.5, textDecoration: "none", color: S.mut }}>✦ Zum Launcher</a>
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 30, height: 30, borderRadius: 8, background: S.appTint, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>🤖</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14.5, color: S.app, lineHeight: 1.1 }}>EzyAI</div>
            <div style={{ fontSize: 10.5, color: S.mut }}>KI-Sichtbarkeit</div>
          </div>
        </div>

        <div className="ezyai-head-right" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <a href="/llm-ueberblick" style={{ fontSize: 12, color: S.mut, textDecoration: "none", border: `1px solid ${S.line}`, borderRadius: 8, padding: "6px 12px" }}>
            LLM-Überblick
          </a>
          <select
            value={client?.id || ""}
            onChange={(e) => setClientId(e.target.value)}
            style={{ padding: "7px 10px", borderRadius: 8, background: S.bg, color: S.txt, border: `1px solid ${S.line}`, fontSize: 13, maxWidth: 240 }}
          >
            {clients.map((c: any) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </header>

      {/* Inhalt */}
      <main className="ezyai-main" style={{ maxWidth: 1280, margin: "0 auto", padding: "22px 18px 60px" }}>
        {ezy.loading && !clients.length ? (
          <div style={{ color: S.mut, fontSize: 13, padding: 60, textAlign: "center" }}>Lade Kunden…</div>
        ) : !client ? (
          <div style={{ color: S.mut, fontSize: 13, padding: 60, textAlign: "center" }}>Keine Kunden zugewiesen.</div>
        ) : !aivisOn ? (
          <div style={{
            background: S.panel, border: `1px solid ${S.line}`, borderRadius: 14,
            padding: 40, textAlign: "center", maxWidth: 560, margin: "60px auto 0",
          }}>
            <div style={{ fontSize: 30, marginBottom: 12 }}>🤖</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>KI-Sichtbarkeit ist für {client.name} nicht aktiviert</div>
            <div style={{ fontSize: 13, color: S.mut }}>
              Der Service lässt sich im Admin unter Kunden → Services (Canonry / Perplexity) einschalten.
            </div>
          </div>
        ) : (
          <AiVisibilityTab selectedClient={client} />
        )}
      </main>
    </div>
  );
}
