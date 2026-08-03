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
};
const CLIENT_LS = "ezyai.clientId";

function EzyAiApp() {
  const navigate = useNavigate();
  const { session, loading: authLoading, role } = useAuth();
  const { canOpen, loading: accessLoading } = useAppAccess();
  const ezy = useEzyClients();
  const [swOpen, setSwOpen] = useState(false);
  const [curOpen, setCurOpen] = useState(false); // Prompt-Kuration (Nachbau 08/2026)
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
              padding: 8, boxShadow: "0 14px 44px rgba(0,0,0,.14)",
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
          <button onClick={() => setCurOpen(true)} style={{ fontSize: 12, color: S.mut, background: "none", cursor: "pointer", border: `1px solid ${S.line}`, borderRadius: 8, padding: "6px 12px" }}>
            Prompts verwalten
          </button>
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
          <>
            <AiVisibilityTab selectedClient={client} />
            <CrawlerCard clientId={client.id} S={S} />
          </>
        )}
      </main>
      {curOpen && client?.id && <PromptCurationPanel clientId={client.id} onClose={() => setCurOpen(false)} S={S} />}
    </div>
  );
}
