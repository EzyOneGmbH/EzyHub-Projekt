import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useAppAccess } from "@/ezy/data/useAppAccess";
import { EZY_APPS } from "@/ezy/data/appRegistry";
import { useEzyClients } from "@/ezy/data/useEzyClients";
import { useEzyServiceSettings } from "@/ezy/data/useEzyServiceSettings";
import { useEzyServiceMatrix } from "@/ezy/data/useEzyServiceMatrix";
import { AiVisibilityTab } from "@/ezy/EzyOneApp.jsx";
import { useEzyProfile } from "@/ezy/data/useEzyProfile";
import {
  LogOut, LineChart, Zap, Activity, MessageSquare, GraduationCap,
  FileText, Lightbulb, Globe, AlertTriangle, LayoutDashboard, Bot, Sparkles,
} from "lucide-react";

// Initialen aus einem Namen (Shell-Profilblock, wie in der EzyRank-Shell).
function initials(name: string) {
  return String(name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
}

// App-Navigation der Sidebar (Searchable-Struktur). "AEO Insights" = heutiges
// Dashboard; alle übrigen Bereiche sind Platzhalter (soon), bis konfiguriert.
type NavItem = { id: string; label: string; icon: any; soon?: boolean; badge?: number };
const APP_NAV: Array<{ group: string; items: NavItem[] }> = [
  { group: "Analytics", items: [
    { id: "aeo-insights", label: "AEO Insights", icon: LineChart },
    { id: "llm-analytics", label: "LLM Analytics", icon: Zap, soon: true },
    { id: "traffic", label: "Traffic", icon: Activity, soon: true },
  ] },
  { group: "Prompts", items: [
    { id: "your-prompts", label: "Your Prompts", icon: MessageSquare, soon: true },
    { id: "prompt-research", label: "Prompt Research", icon: GraduationCap, soon: true },
  ] },
  { group: "Actions", items: [
    { id: "content", label: "Content", icon: FileText, soon: true },
    { id: "opportunities", label: "Opportunities", icon: Lightbulb, soon: true },
  ] },
  { group: "On Page", items: [
    { id: "site-health", label: "Site Health", icon: Globe, soon: true },
    { id: "issues", label: "Issues", icon: AlertTriangle, soon: true },
  ] },
];
const NAV_LABEL: Record<string, string> = Object.fromEntries(
  APP_NAV.flatMap((g) => g.items.map((i) => [i.id, i.label])),
);

// ── KI-Crawler-Karte (Searchable-Nachbau ⑤, Beta 08/2026) ────────────────────
// Zeigt Bot-Besuche der letzten 7 Tage aus ai_crawler_hits (Ingest-Endpoint
// /api/admin/ai-crawler-ingest). Rollout des Erfassungs-Snippets auf Kunden-
// Websites läuft über den normalen Freigabe-Workflow — nie autonom.
function CrawlerCard({ clientId, S }: { clientId: string; S: Record<string, string> }) {
  const [rows, setRows] = useState<Array<{ bot: string; url: string; at: string }> | null>(null);
  useEffect(() => {
    let alive = true;
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    (supabase as any)
      .from("ai_crawler_hits")
      .select("bot, url, at")
      .eq("client_id", clientId)
      .gte("at", since)
      .order("at", { ascending: false })
      .limit(1000)
      .then(({ data }: any) => { if (alive) setRows(data ?? []); });
    return () => { alive = false; };
  }, [clientId]);
  if (rows === null) return null;
  const byBot: Record<string, number> = {};
  const byUrl: Record<string, number> = {};
  for (const r of rows) { byBot[r.bot] = (byBot[r.bot] || 0) + 1; byUrl[r.url] = (byUrl[r.url] || 0) + 1; }
  const bots = Object.entries(byBot).sort((a, b) => b[1] - a[1]);
  const urls = Object.entries(byUrl).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return (
    <div style={{ background: S.panel, border: `1px solid ${S.line}`, borderRadius: 14, padding: 18, marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>KI-Crawler auf der Website</div>
        <span style={{ fontSize: 10, color: S.app, border: `1px solid ${S.app}55`, borderRadius: 99, padding: "1px 8px" }}>Beta</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: S.mut }}>letzte 7 Tage</span>
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: S.mut, marginTop: 10 }}>
          Noch keine Daten — das Erfassungs-Snippet ist auf dieser Kunden-Website noch nicht ausgerollt
          (Rollout läuft über den Freigabe-Workflow).
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 14, marginTop: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: S.mut, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>Besuche je Bot ({rows.length})</div>
            {bots.map(([b, n]) => (
              <div key={b} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", borderBottom: `1px solid ${S.line}` }}>
                <span>{b}</span><span style={{ color: S.mut }}>{n}</span>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 11, color: S.mut, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>Meistgecrawlte Seiten</div>
            {urls.map(([u, n]) => (
              <div key={u} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11.5, padding: "3px 0", borderBottom: `1px solid ${S.line}` }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u}</span><span style={{ color: S.mut }}>{n}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Prompt-Kuration (Searchable-Nachbau 08/2026) ─────────────────────────────
// Vorgeschlagen (needs_review) annehmen/ablehnen, Aktiv/Archiviert schalten —
// Archivieren stoppt Messkosten ohne Datenverlust. Schreibt direkt auf
// ai_visibility_prompt_defs (RLS: Org-Mitglieder dürfen pflegen).
type PromptDef = { id: string; prompt: string; topic: string | null; intent: string | null; active: boolean; needs_review: boolean; prompt_type: string | null };

function PromptCurationPanel({ clientId, onClose, S }: { clientId: string; onClose: () => void; S: Record<string, string> }) {
  const [defs, setDefs] = useState<PromptDef[] | null>(null);
  const [view, setView] = useState<"review" | "active" | "archived">("review");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await (supabase as any)
      .from("ai_visibility_prompt_defs")
      .select("id, prompt, topic, intent, active, needs_review, prompt_type")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });
    if (error) setErr(error.message);
    else setDefs((data ?? []) as PromptDef[]);
  }, [clientId]);
  useEffect(() => { void load(); }, [load]);

  const update = async (id: string, patch: Partial<PromptDef>) => {
    setBusy(id); setErr(null);
    const { error } = await (supabase as any).from("ai_visibility_prompt_defs").update(patch).eq("id", id);
    if (error) setErr(error.message);
    await load();
    setBusy(null);
  };

  const all = defs ?? [];
  const groups = {
    review: all.filter((d) => d.needs_review),
    active: all.filter((d) => d.active && !d.needs_review),
    archived: all.filter((d) => !d.active && !d.needs_review),
  };
  const rows = groups[view];
  const tabBtn = (id: "review" | "active" | "archived", label: string, n: number, warn?: boolean) => (
    <button key={id} onClick={() => setView(id)}
      style={{ padding: "5px 12px", borderRadius: 99, fontSize: 12, cursor: "pointer", border: `1px solid ${view === id ? S.app : S.line}`, background: view === id ? S.appTint : "transparent", color: view === id ? S.app : warn && n > 0 ? "#fbbf24" : S.mut }}>
      {label} {n}
    </button>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(30,28,24,.35)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: "min(680px,100vw)", background: S.bg, borderLeft: `1px solid ${S.line}`, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: `1px solid ${S.line}` }}>
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>Prompts verwalten</div>
          <div style={{ display: "flex", gap: 6, marginLeft: 8 }}>
            {tabBtn("review", "Vorgeschlagen", groups.review.length, true)}
            {tabBtn("active", "Aktiv", groups.active.length)}
            {tabBtn("archived", "Archiviert", groups.archived.length)}
          </div>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", color: S.mut, fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ padding: "8px 18px", fontSize: 11, color: S.mut, borderBottom: `1px solid ${S.line}` }}>
          Nur <b style={{ color: S.txt }}>aktive</b> Prompts laufen im Messzyklus (Kosten!). Archivieren behält die Historie. „Vorgeschlagen" = vom Seeder/Relevanz-Audit zur Prüfung markiert.
        </div>
        {err && <div style={{ margin: "10px 18px 0", padding: "8px 12px", borderRadius: 8, border: "1px solid #f8717155", color: "#f87171", fontSize: 12 }}>{err}</div>}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 18px 24px" }}>
          {defs === null ? (
            <div style={{ color: S.mut, fontSize: 13, padding: 20 }}>Lade…</div>
          ) : rows.length === 0 ? (
            <div style={{ color: S.mut, fontSize: 13, padding: 20 }}>Keine Einträge in dieser Ansicht.</div>
          ) : rows.map((d) => (
            <div key={d.id} style={{ border: `1px solid ${S.line}`, borderRadius: 10, padding: "10px 12px", marginBottom: 8, background: S.panel }}>
              <div style={{ fontSize: 12.5, lineHeight: 1.45 }}>{d.prompt}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                {d.topic && <span style={{ fontSize: 10.5, color: S.mut, border: `1px solid ${S.line}`, borderRadius: 99, padding: "2px 8px" }}>{d.topic}</span>}
                {d.intent && <span style={{ fontSize: 10.5, color: S.mut, border: `1px solid ${S.line}`, borderRadius: 99, padding: "2px 8px" }}>{d.intent}</span>}
                {d.prompt_type === "brand" && <span style={{ fontSize: 10.5, color: "#a78bfa", border: "1px solid #a78bfa55", borderRadius: 99, padding: "2px 8px" }}>Marken-Check</span>}
                <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  {d.needs_review ? (
                    <>
                      <button disabled={busy === d.id} onClick={() => update(d.id, { needs_review: false, active: true })}
                        style={{ padding: "4px 12px", borderRadius: 8, fontSize: 11.5, cursor: "pointer", border: `1px solid ${S.app}`, background: "transparent", color: S.app }}>
                        ✓ Annehmen
                      </button>
                      <button disabled={busy === d.id} onClick={() => update(d.id, { needs_review: false, active: false })}
                        style={{ padding: "4px 12px", borderRadius: 8, fontSize: 11.5, cursor: "pointer", border: `1px solid ${S.line}`, background: "transparent", color: S.mut }}>
                        Archivieren
                      </button>
                    </>
                  ) : d.active ? (
                    <button disabled={busy === d.id} onClick={() => update(d.id, { active: false })}
                      style={{ padding: "4px 12px", borderRadius: 8, fontSize: 11.5, cursor: "pointer", border: `1px solid ${S.line}`, background: "transparent", color: S.mut }}>
                      Archivieren
                    </button>
                  ) : (
                    <button disabled={busy === d.id} onClick={() => update(d.id, { active: true })}
                      style={{ padding: "4px 12px", borderRadius: 8, fontSize: 11.5, cursor: "pointer", border: `1px solid ${S.app}`, background: "transparent", color: S.app }}>
                      Aktivieren
                    </button>
                  )}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/ezyai")({
  component: EzyAiApp,
});

// Plattform-Umbau Phase 2 (2026-07-31): EzyAI als erste eigenständige App.
// Die Fach-Komponente (AiVisibilityTab) ist aus dem Dashboard UMGEZOGEN, nicht
// neu gebaut — diese Route liefert nur die App-Shell drumherum (Header mit
// App-Switcher, Kunden-Auswahl, Service-Gate). Muster für Phase 3.
// Light Studio (2026-08-03): hell à la Searchable
const S = {
  bg: "#f7f6f2", panel: "#ffffff", line: "#e8e6df",
  txt: "#1c1c1e", mut: "#6e6c64", app: "#7c3aed", appTint: "rgba(124,58,237,.10)",
  // Shell-Nav (identisch zur EzyRank-Shell): accentDim/accentLight.
  navAccent: "#5b4bd6", navDim: "rgba(108,92,231,0.10)",
};
const SIDEBAR_W = 256;
const CLIENT_LS = "ezyai.clientId";

function EzyAiApp() {
  const navigate = useNavigate();
  const { session, loading: authLoading, role, isOrgAdmin } = useAuth();
  const { canOpen, loading: accessLoading } = useAppAccess();
  const { profile } = useEzyProfile();
  const ezy = useEzyClients();
  const [swOpen, setSwOpen] = useState(false);
  const [curOpen, setCurOpen] = useState(false); // Prompt-Kuration (Nachbau 08/2026)
  const [view, setView] = useState<"dashboard" | "agent">("dashboard"); // Dashboard/Agent-Switcher
  const [section, setSection] = useState("aeo-insights"); // aktiver Sidebar-App-Bereich
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

  // Nur Kunden mit aktiver KI-Sichtbarkeit (canonry|perplexity) anbieten (01.08.)
  const svcMatrix = useEzyServiceMatrix();
  const clients = useMemo(
    () => (ezy.clients || []).filter((c: any) => svcMatrix.hasService(c.id, ["canonry", "perplexity"])),
    [ezy.clients, svcMatrix.hasService],
  );
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

  const shareReport = async () => {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const r = await fetch("/api/public/report", {
      method: "POST",
      headers: { Authorization: `Bearer ${token || ""}`, "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: client!.id, days: 30 }),
    });
    const j = await r.json().catch(() => ({}));
    if (j?.ok && j.url) {
      const full = `${window.location.origin}${j.url}`;
      try { await navigator.clipboard.writeText(full); alert(`Report-Link kopiert (30 Tage gültig):\n${full}`); }
      catch { window.prompt("Report-Link (30 Tage gültig) — kopieren:", full); }
    } else alert(j?.error || "Link konnte nicht erstellt werden");
  };

  return (
    <div style={{ minHeight: "100vh", background: S.bg, color: S.txt, fontFamily: '"Segoe UI",system-ui,-apple-system,sans-serif' }}>
      {/* Mobile (04.08.): Shell-Sidebar wird zur horizontalen Leiste oben. */}
      <style>{`
        .ezyai-shell{display:flex;min-height:100vh}
        .ezyai-side{width:${SIDEBAR_W}px;flex-shrink:0;background:${S.panel};border-right:1px solid ${S.line};display:flex;flex-direction:column;position:fixed;top:0;left:0;bottom:0;z-index:50;overflow-y:auto}
        .ezyai-body{flex:1;min-width:0;margin-left:${SIDEBAR_W}px}
        .ezyai-mnav{display:none}
        @media(max-width:900px){
          .ezyai-side{display:none}
          .ezyai-body{margin-left:0}
          .ezyai-mnav{display:block;position:sticky;top:0;z-index:40;background:${S.panel};border-bottom:1px solid ${S.line};padding:8px 10px;overflow-x:auto}
          .ezyai-chead{flex-wrap:wrap!important;gap:8px!important;padding:10px!important}
          .ezyai-main{padding:14px 10px 48px!important}
        }
      `}</style>

      <div className="ezyai-shell">
        {/* ── Shell-Seitenleiste (identisch zur EzyRank-Shell) ─────────────── */}
        <aside className="ezyai-side">
          {/* Logo */}
          <div style={{ padding: "20px 20px", borderBottom: `1px solid ${S.line}`, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#6c5ce7,#0284c7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: "#fff", flexShrink: 0 }}>EO</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-.3px" }}>EZY ONE</div>
              <div style={{ fontSize: 10, color: S.mut }}>SEO &amp; GEO Platform</div>
            </div>
          </div>

          {/* App-Switcher */}
          <div style={{ position: "relative", borderBottom: `1px solid ${S.line}`, padding: "8px 10px" }}>
            <button
              onClick={() => setSwOpen((v) => !v)}
              title="App wechseln"
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, background: swOpen ? "rgba(0,0,0,.05)" : "none", border: "none", borderRadius: 8, padding: "8px 10px", color: S.app, cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}
            >
              <span style={{ fontSize: 14, lineHeight: 1, letterSpacing: 1 }}>⣿</span>
              <span style={{ color: S.app }}>EzyAI</span>
            </button>
            {swOpen && (
              <div style={{ position: "absolute", top: "100%", left: 10, zIndex: 200, width: 236, background: S.panel, border: `1px solid ${S.line}`, borderRadius: 12, padding: 8, boxShadow: "0 14px 44px rgba(0,0,0,.14)" }}>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: S.mut, padding: "4px 10px 8px", fontWeight: 700 }}>Apps wechseln</div>
                {EZY_APPS.filter((a) => canOpen(a.id)).map((a) => {
                  const active = a.id === "geo";
                  return (
                    <a key={a.id} href={a.href}
                      onClick={(e) => { if (active) { e.preventDefault(); setSwOpen(false); } }}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, fontSize: 13, textDecoration: "none", color: active ? a.color : S.txt, background: active ? a.tint : "none" }}>
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

          {/* Kunden-Auswahl (Searchable-Position: oben in der Sidebar) */}
          <div style={{ padding: "10px 12px", borderBottom: `1px solid ${S.line}` }}>
            <select
              value={client?.id || ""}
              onChange={(e) => setClientId(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 8, background: S.bg, color: S.txt, border: `1px solid ${S.line}`, fontSize: 13, fontFamily: "inherit" }}
            >
              {clients.map((c: any) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
          </div>

          {/* Dashboard / Agent — Switcher */}
          <div style={{ padding: "10px 12px", borderBottom: `1px solid ${S.line}` }}>
            <div style={{ display: "flex", gap: 4, background: S.bg, border: `1px solid ${S.line}`, borderRadius: 10, padding: 3 }}>
              {([["dashboard", "Dashboard", LayoutDashboard], ["agent", "Agent", Bot]] as const).map(([v, label, Icon]) => {
                const a = view === v;
                return (
                  <button key={v} onClick={() => setView(v)}
                    style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "7px 10px", borderRadius: 8, border: "none", cursor: "pointer", background: a ? S.panel : "transparent", color: a ? S.txt : S.mut, fontSize: 12.5, fontWeight: a ? 700 : 500, boxShadow: a ? "0 1px 2px rgba(0,0,0,.06)" : "none", fontFamily: "inherit" }}>
                    <Icon size={14} />{label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* App-Nav (Searchable-Struktur; AEO Insights aktiv, Rest In Vorbereitung) */}
          <nav style={{ flex: 1, padding: "12px 8px", overflowY: "auto" }}>
            {APP_NAV.map((g, gi) => (
              <div key={g.group} style={{ marginTop: gi ? 14 : 0 }}>
                <div style={{ padding: "0 14px 6px", fontSize: 10.5, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: S.mut }}>{g.group}</div>
                {g.items.map((t) => {
                  const Icon = t.icon;
                  const a = view === "dashboard" && section === t.id;
                  return (
                    <button key={t.id} onClick={() => { setView("dashboard"); setSection(t.id); }}
                      title={t.soon ? "In Vorbereitung" : undefined}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10, border: "none", cursor: "pointer", background: a ? S.navDim : "transparent", color: a ? S.navAccent : S.mut, fontSize: 13, fontWeight: a ? 600 : 400, marginBottom: 2, transition: "all .15s", fontFamily: "inherit", opacity: t.soon ? 0.75 : 1 }}>
                      <Icon size={18} />
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>{t.label}</span>
                      {t.soon ? <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: S.mut, border: `1px solid ${S.line}`, borderRadius: 99, padding: "1px 6px" }}>bald</span> : null}
                      {t.badge && t.badge > 0 ? <span style={{ background: "#fdf6e3", color: "#8a6d1b", borderRadius: 99, padding: "1px 7px", fontSize: 10, fontWeight: 700 }}>{t.badge}</span> : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* Profil */}
          <div style={{ padding: "12px 16px", borderTop: `1px solid ${S.line}`, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: S.app, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#fff" }}>{initials(profile.name)}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: S.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profile.name || "—"}</div>
              <div style={{ fontSize: 10, color: S.mut }}>{profile.role}</div>
            </div>
            <LogOut size={14} color={S.mut} style={{ cursor: "pointer" }} onClick={() => supabase.auth.signOut()} />
          </div>
        </aside>

        {/* ── Content ──────────────────────────────────────────────────────── */}
        <div className="ezyai-body">
          {/* Mobile-Nav: Dashboard/Agent + Kunden + App-Bereiche als Chips */}
          <div className="ezyai-mnav">
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
              {([["dashboard", "Dashboard"], ["agent", "Agent"]] as const).map(([v, label]) => (
                <button key={v} onClick={() => setView(v)}
                  style={{ padding: "6px 12px", borderRadius: 8, border: "none", cursor: "pointer", background: view === v ? S.navDim : S.bg, color: view === v ? S.navAccent : S.mut, fontSize: 12.5, fontWeight: view === v ? 700 : 500, fontFamily: "inherit" }}>{label}</button>
              ))}
              <select value={client?.id || ""} onChange={(e) => setClientId(e.target.value)}
                style={{ marginLeft: "auto", padding: "6px 8px", borderRadius: 8, background: S.bg, color: S.txt, border: `1px solid ${S.line}`, fontSize: 12.5, maxWidth: 180 }}>
                {clients.map((c: any) => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </select>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", overflowX: "auto" }}>
              {APP_NAV.flatMap((g) => g.items).map((t) => {
                const Icon = t.icon;
                const a = view === "dashboard" && section === t.id;
                return (
                  <button key={t.id} onClick={() => { setView("dashboard"); setSection(t.id); }}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", padding: "7px 11px", borderRadius: 10, border: "none", cursor: "pointer", background: a ? S.navDim : "transparent", color: a ? S.navAccent : S.mut, fontSize: 12.5, fontWeight: a ? 600 : 400, fontFamily: "inherit", opacity: t.soon ? 0.7 : 1 }}>
                    <Icon size={15} />{t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Kontext-Kopfzeile: Bereichs-Titel + Aktionen (Kunde ist jetzt in der Sidebar) */}
          <header className="ezyai-chead" style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 22px", background: S.panel, borderBottom: `1px solid ${S.line}`, position: "sticky", top: 0, zIndex: 30 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: S.txt }}>
              {view === "agent" ? "Agent" : NAV_LABEL[section] || "AEO Insights"}
            </div>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
              <button onClick={() => setCurOpen(true)} style={{ fontSize: 12, color: S.mut, background: "none", cursor: "pointer", border: `1px solid ${S.line}`, borderRadius: 8, padding: "6px 12px" }}>Prompts verwalten</button>
              {isOrgAdmin && client?.id && (
                <button onClick={shareReport} style={{ fontSize: 12, color: S.app, background: "none", cursor: "pointer", border: `1px solid ${S.app}55`, borderRadius: 8, padding: "6px 12px" }}>Report teilen</button>
              )}
              <a href="/llm-ueberblick" style={{ fontSize: 12, color: S.mut, textDecoration: "none", border: `1px solid ${S.line}`, borderRadius: 8, padding: "6px 12px" }}>LLM-Überblick</a>
            </div>
          </header>

          <main className="ezyai-main" style={{ maxWidth: 1180, margin: "0 auto", padding: "22px 22px 60px" }}>
            {view === "agent" ? (
              <div style={{ background: S.panel, border: `1px solid ${S.line}`, borderRadius: 14, padding: 40, textAlign: "center", maxWidth: 560, margin: "40px auto 0" }}>
                <div style={{ width: 52, height: 52, borderRadius: 14, background: S.appTint, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
                  <Sparkles size={26} color={S.app} />
                </div>
                <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>EzyPilot</div>
                <div style={{ fontSize: 13, color: S.mut, lineHeight: 1.5, marginBottom: 18 }}>
                  Der KI-Assistent für Daten- und Portal-Fragen, Agenten-Bau und das Obsidian-Gedächtnis{client ? ` — im Kontext von ${client.name}` : ""}.
                </div>
                <a href="/pilot" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 18px", borderRadius: 10, background: S.app, color: "#fff", textDecoration: "none", fontSize: 13.5, fontWeight: 600 }}>
                  <Bot size={16} /> EzyPilot öffnen
                </a>
              </div>
            ) : ezy.loading && !clients.length ? (
              <div style={{ color: S.mut, fontSize: 13, padding: 60, textAlign: "center" }}>Lade Kunden…</div>
            ) : !client ? (
              <div style={{ color: S.mut, fontSize: 13, padding: 60, textAlign: "center" }}>Keine Kunden zugewiesen.</div>
            ) : section !== "aeo-insights" ? (
              <div style={{ background: S.panel, border: `1px solid ${S.line}`, borderRadius: 14, padding: 40, textAlign: "center", maxWidth: 560, margin: "40px auto 0" }}>
                <div style={{ fontSize: 30, marginBottom: 12 }}>🧭</div>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>{NAV_LABEL[section]} — in Vorbereitung</div>
                <div style={{ fontSize: 13, color: S.mut }}>Dieser Bereich wird noch konfiguriert. Der volle KI-Sichtbarkeits-Report liegt unter „AEO Insights".</div>
              </div>
            ) : !aivisOn ? (
              <div style={{ background: S.panel, border: `1px solid ${S.line}`, borderRadius: 14, padding: 40, textAlign: "center", maxWidth: 560, margin: "60px auto 0" }}>
                <div style={{ fontSize: 30, marginBottom: 12 }}>🤖</div>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>KI-Sichtbarkeit ist für {client.name} nicht aktiviert</div>
                <div style={{ fontSize: 13, color: S.mut }}>Der Service lässt sich im Admin unter Kunden → Services (Canonry / Perplexity) einschalten.</div>
              </div>
            ) : (
              <>
                <AiVisibilityTab selectedClient={client} navStyle="topbar" />
                <CrawlerCard clientId={client.id} S={S} />
              </>
            )}
          </main>
        </div>
      </div>
      {curOpen && client?.id && <PromptCurationPanel clientId={client.id} onClose={() => setCurOpen(false)} S={S} />}
    </div>
  );
}
