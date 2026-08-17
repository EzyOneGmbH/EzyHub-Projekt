import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useAppAccess } from "@/ezy/data/useAppAccess";
import { ToastProvider, EzyPilotProvider, EzyPilotButton, EzyPilotPopup } from "@/ezy/EzyOneApp.jsx";
import { useEzyProfile } from "@/ezy/data/useEzyProfile";
import { HexGlowLayer } from "@/ezy/HexGlow";
import { AppVersionBadge } from "@/ezy/AppVersionBadge";

// EzyAI – Analyse (14.08.2026): Pre-Onboarding-Schnellaudit fuer Leads.
// Konzept/Design: Onboarding-Wizard (Pop-Up, 4 Schritte, Wettbewerber via AI),
// Tabs Analyse|Verlauf, kompletter Ergebnisreport (Score, verpasstes
// AI-Suchvolumen, Prompts x Engines, Issues/Seiten wie EzyAI-SiteHealth,
// Massnahmen, Benchmark, Anbindungs-Check) + PDF-Export via Druck-Stylesheet.
// Immer voller Umfang — keine Modus-Auswahl; keine Kosten in der Oberflaeche.

export const Route = createFileRoute("/ezyai-analyse")({
  component: EzyAiAnalyseApp,
});

// Ezy One CD Tokens (identisch zu ezyai.tsx).
const S = {
  bg: "#f7f5f9", panel: "#ffffff", line: "#eae4ee", lineHover: "#d8cede",
  txt: "#161217", mut: "#6d6473", dim: "#a49dab",
  app: "#77008C", appLight: "#B9009C", tint: "rgba(119,0,140,.09)",
  green: "#0f9d6c", greenDim: "rgba(16,185,129,.12)",
  red: "#dc2626", redDim: "rgba(239,68,68,.10)",
  orange: "#d97706", orangeDim: "rgba(245,158,11,.12)",
  grad: "linear-gradient(135deg,#71008B,#B9009C)",
};
const HEX_BG = `url("data:image/svg+xml,%3Csvg width='28' height='49' viewBox='0 0 28 49' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z' fill='%2377008C' fill-opacity='0.04' fill-rule='evenodd'/%3E%3C/svg%3E")`;

const ENGINE_COLS = ["ChatGPT", "Perplexity", "Gemini", "Claude"] as const;

type AuditRow = {
  id: string; domain: string; firmenname: string; branche?: string; ort?: string;
  status: string; stage: string; progress: number; score: number | null;
  dims?: { ai: number; technik: number; entitaet: number; seo: number } | null;
  wettbewerber?: string[]; created_at: string; data?: any; missedVol?: number | null;
  error?: string | null;
};

async function api(method: "GET" | "POST", pathQuery: string, body?: any) {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  const r = await fetch(`/api/agent/analyse${pathQuery}`, {
    method,
    headers: { Authorization: `Bearer ${token || ""}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
}

const fmtVol = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `~${Math.round(v).toLocaleString("de-CH")}`;
const fmtDate = (iso: string) => {
  try { return new Date(iso).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "2-digit" }); }
  catch { return iso.slice(0, 10); }
};
const scoreColor = (n: number | null | undefined) =>
  n === null || n === undefined ? S.dim : n >= 65 ? S.green : n >= 40 ? S.orange : S.red;
const scoreBg = (n: number | null | undefined) =>
  n === null || n === undefined ? S.tint : n >= 65 ? S.greenDim : n >= 40 ? S.orangeDim : S.redDim;

// Etappen-Anzeige des Laufs (Wizard-Schritt 4 + Fortschritt aus dem Verlauf).
const STAGES: Array<{ keys: string[]; name: string; desc: string }> = [
  { keys: ["technik"], name: "Technik & SiteHealth", desc: "robots.txt-AI-Bots, OnPage-Audit (bis 50 Seiten), Tech-Stack" },
  { keys: ["seo"], name: "SEO-Fundament", desc: "Sichtbarkeit, Traffic-Schaetzung, Backlinks, LLM-Mentions-Makro" },
  { keys: ["volumen"], name: "AI-Suchvolumen", desc: "Monatliche AI-Nachfrage je Prompt" },
  { keys: ["ai1", "ai2", "ai3"], name: "AI-Sichtbarkeit", desc: "15 Prompts (max. 3 Brand) über ChatGPT, Perplexity, Gemini und Claude" },
  { keys: ["entitaet"], name: "Entität & Vertrauen", desc: "Wikidata, Organization-Schema, Brand-SERP" },
  { keys: ["benchmark"], name: "Wettbewerber-Benchmark", desc: "Quick-Score je Wettbewerber" },
  { keys: ["score"], name: "Scoring & Massnahmen", desc: "AI-Readiness-Score + Top-5-Empfehlungen" },
];
const stageIndex = (stage: string) => {
  const i = STAGES.findIndex((s) => s.keys.includes(stage));
  return i === -1 ? STAGES.length : i;
};

function Sev({ v }: { v: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    kritisch: { bg: S.redDim, fg: S.red }, hoch: { bg: S.redDim, fg: S.red },
    mittel: { bg: S.orangeDim, fg: S.orange }, niedrig: { bg: S.greenDim, fg: S.green },
    leicht: { bg: S.greenDim, fg: S.green },
  };
  const c = map[v] || { bg: S.tint, fg: S.app };
  return <span style={{ display: "inline-block", minWidth: 34, textAlign: "center", fontWeight: 700, fontSize: 11.5, borderRadius: 8, padding: "2px 8px", background: c.bg, color: c.fg, flexShrink: 0 }}>{v}</span>;
}
function ScorePill({ n }: { n: number | null | undefined }) {
  return <span style={{ display: "inline-block", minWidth: 30, textAlign: "center", fontWeight: 700, fontSize: 12, borderRadius: 8, padding: "2px 8px", background: scoreBg(n), color: scoreColor(n) }}>{n ?? "—"}</span>;
}

const th: React.CSSProperties = { textAlign: "left", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#a49dab", padding: "8px 10px", borderBottom: `1px solid ${S.line}` };
const td: React.CSSProperties = { padding: "9px 10px", borderBottom: `1px solid ${S.line}`, fontSize: 13 };
const card: React.CSSProperties = { background: S.panel, border: `1px solid ${S.line}`, borderRadius: 14, padding: 20 };
const inp: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: S.bg, border: `1px solid ${S.line}`, borderRadius: 10, padding: "9px 12px", fontSize: 13.5, fontFamily: "inherit", color: S.txt };
const lbl: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, color: S.mut, marginBottom: 5 };
const ctaBtn: React.CSSProperties = { background: S.grad, color: "#fff", border: "none", borderRadius: 10, padding: "11px 22px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const ghostBtn: React.CSSProperties = { background: "none", border: `1px solid ${S.line}`, borderRadius: 10, padding: "10px 16px", fontSize: 13, fontWeight: 600, color: S.mut, cursor: "pointer", fontFamily: "inherit" };

function EzyAiAnalyseApp() {
  const navigate = useNavigate();
  const { session, loading: authLoading, role } = useAuth();
  const { canOpen, loading: accessLoading } = useAppAccess();
  const { profile } = useEzyProfile();

  const [tab, setTab] = useState<"analyse" | "verlauf">("analyse");
  const [list, setList] = useState<AuditRow[] | null>(null);
  const [detail, setDetail] = useState<AuditRow | null>(null); // Ergebnis-Ansicht
  const [wizOpen, setWizOpen] = useState(false);

  useEffect(() => {
    if (!authLoading && !session) navigate({ to: "/login", search: { next: "/ezyai-analyse" }, replace: true });
  }, [authLoading, session, navigate]);
  useEffect(() => {
    if (!authLoading && role === "viewer") window.location.replace("/dashboard");
  }, [authLoading, role]);
  useEffect(() => {
    if (!accessLoading && session && !canOpen("analyse")) window.location.replace("/apps");
  }, [accessLoading, session, canOpen]);

  const loadList = useCallback(async () => {
    const j = await api("GET", "");
    if (j?.ok) setList(j.audits);
  }, []);
  useEffect(() => { if (session && role && role !== "viewer") void loadList(); }, [session, role, loadList]);

  const openDetail = async (id: string) => {
    const j = await api("GET", `?id=${id}`);
    if (j?.ok) { setDetail(j.audit); window.scrollTo(0, 0); }
  };

  if (authLoading || !session || role === "viewer") return null;

  return (
    <ToastProvider>
      <EzyPilotProvider selectedClient={null} clients={[]} tools={[]}>
        <div className="anl-root" style={{ minHeight: "100vh", display: "flex", background: S.bg, backgroundImage: HEX_BG, color: S.txt, fontFamily: "'Aceh Soft','Nunito Sans','Segoe UI',system-ui,sans-serif" }}>
          <style>{`
            .anl-side { width: 256px; }
            @media (max-width: 900px) { .anl-side { display: none; } }
            details.anl-fold > summary { list-style: none; cursor: pointer; }
            details.anl-fold > summary::-webkit-details-marker { display: none; }
            details.anl-fold[open] > summary { border-bottom: 1px solid ${S.line}; }
            details.anl-fold[open] > summary .anl-cl { display: none; }
            details.anl-fold:not([open]) > summary .anl-op { display: none; }
            @media print {
              .anl-side, .anl-head, .anl-noprint { display: none !important; }
              .anl-root { background: #fff !important; background-image: none !important; }
              .anl-main { max-width: none !important; padding: 0 !important; }
              .anl-print-head { display: flex !important; }
              a { text-decoration: none; color: inherit; }
            }
            .anl-print-head { display: none; }
          `}</style>
          <HexGlowLayer />

          {/* ── Sidebar ── */}
          <aside className="anl-side" style={{ flexShrink: 0, background: S.panel, borderRight: `1px solid ${S.line}`, padding: "18px 14px", display: "flex", flexDirection: "column", gap: 4, boxSizing: "border-box", position: "sticky", top: 0, height: "100vh" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px 16px" }}>
              <div style={{ width: 34, height: 38, flexShrink: 0, background: S.grad, clipPath: "polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 14, fontFamily: "'Kamerik 105',Poppins,sans-serif" }}>EO</div>
              <div style={{ fontWeight: 800, fontSize: 15, fontFamily: "'Kamerik 105',Poppins,sans-serif" }}>
                Ezy One
                <div style={{ fontWeight: 600, fontSize: 10.5, color: S.appLight, letterSpacing: ".04em" }}>ANALYSE</div>
              </div>
            </div>
            <a href="/apps" style={{ fontSize: 12, color: S.mut, textDecoration: "none", padding: "6px 10px", borderRadius: 8, marginBottom: 8 }}>‹ Alle Apps</a>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: S.dim, padding: "10px 10px 4px" }}>App</div>
            <button onClick={() => { setDetail(null); setTab("analyse"); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 10, fontSize: 13.5, fontWeight: 600, color: !detail && tab === "analyse" ? S.app : S.mut, background: !detail && tab === "analyse" ? S.tint : "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left", width: "100%" }}>
              🔎 Analyse
            </button>
            <button onClick={() => { setDetail(null); setTab("verlauf"); void loadList(); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 10, fontSize: 13.5, fontWeight: 600, color: !detail && tab === "verlauf" ? S.app : S.mut, background: !detail && tab === "verlauf" ? S.tint : "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left", width: "100%" }}>
              🕘 Verlauf
            </button>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: S.dim, padding: "12px 10px 4px" }}>Demnächst</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", fontSize: 13.5, fontWeight: 600, color: S.dim, opacity: 0.5 }}>⚡ Live-Abfrage (Demo)</div>
            <div style={{ marginTop: "auto", borderTop: `1px solid ${S.line}`, paddingTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 30, height: 30, borderRadius: 999, background: S.tint, color: S.appLight, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12 }}>
                {String((profile as any)?.name || "?").trim().split(/\s+/).map((w: string) => w[0]).slice(0, 2).join("").toUpperCase() || "?"}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{(profile as any)?.name || "—"}</div>
                <AppVersionBadge appId="analyse" />
              </div>
            </div>
          </aside>

          {/* ── Hauptbereich ── */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <header className="anl-head" style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 22px", background: S.panel, borderBottom: `1px solid ${S.line}`, position: "sticky", top: 0, zIndex: 30 }}>
              <span style={{ fontSize: 12.5, color: S.mut, fontWeight: 600 }}>{detail ? "Ergebnis" : tab === "verlauf" ? "Verlauf" : "Analyse"}</span>
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
                <EzyPilotButton />
              </div>
            </header>

            <main className="anl-main" style={{ maxWidth: 1180, margin: "0 auto", padding: "22px 22px 60px" }}>
              {detail
                ? <ResultView audit={detail} onBack={() => { setDetail(null); setTab("verlauf"); void loadList(); }} onRerun={() => setWizOpen(true)} />
                : <HomeView tab={tab} setTab={setTab} list={list} onOpen={openDetail} onNew={() => setWizOpen(true)} onResume={(id) => { setWizOpen(true); setResumeId(id); }} />}
            </main>
          </div>

          {wizOpen && (
            <Wizard
              resumeId={resumeIdRef.current}
              prefill={detail ? { domain: detail.domain, firmenname: detail.firmenname, branche: detail.branche || "", ort: detail.ort || "" } : null}
              onClose={() => { setWizOpen(false); resumeIdRef.current = null; void loadList(); }}
              onDone={(id) => { setWizOpen(false); resumeIdRef.current = null; void openDetail(id); }}
            />
          )}
          <EzyPilotPopup />
        </div>
      </EzyPilotProvider>
    </ToastProvider>
  );

  // Fortsetzen laufender Analysen (Verlauf → "Fortschritt"): Ref statt State,
  // damit der Wizard beim Oeffnen den richtigen Lauf uebernimmt.
  function setResumeId(id: string) { resumeIdRef.current = id; }
}
const resumeIdRef: { current: string | null } = { current: null };

// ── Startseite: Tabs Analyse | Verlauf ──────────────────────────────────────
function HomeView({ tab, setTab, list, onOpen, onNew, onResume }: {
  tab: "analyse" | "verlauf"; setTab: (t: "analyse" | "verlauf") => void;
  list: AuditRow[] | null; onOpen: (id: string) => void; onNew: () => void; onResume: (id: string) => void;
}) {
  return (
    <>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, fontFamily: "'Kamerik 105',Poppins,sans-serif" }}>Analyse</h1>
        <div style={{ fontSize: 13, color: S.mut, marginTop: 4 }}>
          Pre-Check für Leads & Pitches — immer im vollen Umfang: alle Engines, AI-Suchvolumen, SiteHealth, Wettbewerber-Benchmark.
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, margin: "18px 0" }}>
        {(["analyse", "verlauf"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "6px 16px", borderRadius: 99, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", border: `1px solid ${tab === t ? S.app : S.line}`, background: tab === t ? S.tint : "transparent", color: tab === t ? S.app : S.mut }}>
            {t === "analyse" ? "Analyse" : "Verlauf"}
          </button>
        ))}
      </div>

      {tab === "analyse" ? (
        <div style={{ ...card, padding: 34, display: "flex", alignItems: "center", gap: 26, flexWrap: "wrap" }}>
          <div style={{ width: 62, height: 68, background: S.grad, clipPath: "polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>🔎</div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <h2 style={{ margin: "0 0 6px", fontSize: 19, fontFamily: "'Kamerik 105',Poppins,sans-serif" }}>Wie sichtbar ist dein Lead in AI-Suchen?</h2>
            <p style={{ margin: 0, fontSize: 13.5, color: S.mut, maxWidth: "52ch" }}>
              Ein Lauf, volles Programm: AI-Sichtbarkeit über alle Engines, verpasstes AI-Suchvolumen, SiteHealth, Entität, Anbindungs-Check und Wettbewerber-Benchmark — fertig in ~15 Minuten.
            </p>
          </div>
          <button style={ctaBtn} onClick={onNew}>＋ Neue Analyse</button>
        </div>
      ) : (
        <div style={card}>
          <h3 style={{ margin: "0 0 4px", fontSize: 15.5 }}>Verlauf</h3>
          <p style={{ fontSize: 12.5, color: S.mut, margin: "0 0 14px" }}>Alle Analysen der Organisation — Re-Run jederzeit, z. B. fürs Follow-up nach 3 Monaten.</p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontVariantNumeric: "tabular-nums" }}>
              <thead><tr>
                <th style={th}>Datum</th><th style={th}>Domain</th><th style={th}>Firma</th><th style={th}>Status</th>
                <th style={th}>Score</th><th style={{ ...th, textAlign: "right" }}>Verpasstes AI-Vol./Mt.</th><th style={th}></th>
              </tr></thead>
              <tbody>
                {(list ?? []).map((r) => (
                  <tr key={r.id}>
                    <td style={td}>{fmtDate(r.created_at)}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{r.domain}</td>
                    <td style={td}>{r.firmenname}</td>
                    <td style={td}>
                      {r.status === "laufend"
                        ? <span style={{ ...pillStyle(S.orangeDim, S.orange) }}>läuft · {r.progress}%</span>
                        : r.status === "fehler"
                          ? <span style={{ ...pillStyle(S.redDim, S.red) }}>Fehler</span>
                          : <span style={{ ...pillStyle(S.greenDim, S.green) }}>fertig</span>}
                    </td>
                    <td style={td}><ScorePill n={r.score} /></td>
                    <td style={{ ...td, textAlign: "right" }}>{fmtVol(r.missedVol)}</td>
                    <td style={td}>
                      {r.status === "laufend"
                        ? <span style={{ color: S.app, fontWeight: 600, fontSize: 12.5, cursor: "pointer" }} onClick={() => onResume(r.id)}>Fortschritt</span>
                        : <span style={{ color: S.app, fontWeight: 600, fontSize: 12.5, cursor: "pointer" }} onClick={() => onOpen(r.id)}>Öffnen</span>}
                    </td>
                  </tr>
                ))}
                {list !== null && list.length === 0 && (
                  <tr><td style={{ ...td, textAlign: "center", color: S.dim }} colSpan={7}>Noch keine Analysen — starte die erste über den Tab «Analyse».</td></tr>
                )}
                {list === null && (
                  <tr><td style={{ ...td, textAlign: "center", color: S.dim }} colSpan={7}>Lade…</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
const pillStyle = (bg: string, fg: string): React.CSSProperties =>
  ({ display: "inline-block", fontWeight: 700, fontSize: 11.5, borderRadius: 8, padding: "2px 9px", background: bg, color: fg });

// ── Onboarding-Wizard (Pop-Up, 4 Schritte) ──────────────────────────────────
function Wizard({ onClose, onDone, resumeId, prefill }: {
  onClose: () => void; onDone: (id: string) => void; resumeId: string | null;
  prefill: { domain: string; firmenname: string; branche: string; ort: string } | null;
}) {
  const [step, setStep] = useState(resumeId ? 4 : 1);
  const [form, setForm] = useState({ domain: prefill?.domain || "", firmenname: prefill?.firmenname || "", branche: prefill?.branche || "", ort: prefill?.ort || "" });
  const [aiBusy, setAiBusy] = useState(false);
  const [kandidaten, setKandidaten] = useState<Array<{ domain: string; grund: string; checked: boolean }> | null>(null);
  const [manuell, setManuell] = useState("");
  const [startBusy, setStartBusy] = useState(false);
  const [audit, setAudit] = useState<AuditRow | null>(null);
  const [err, setErr] = useState("");
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  // Tick-Schleife: solange das Pop-Up offen ist, treibt das Frontend den Lauf
  // Etappe fuer Etappe voran (Server arbeitet je Tick bis ~4 Min).
  const runTicks = useCallback(async (id: string) => {
    let cur: AuditRow | null = null;
    for (let guard = 0; guard < 40; guard++) {
      if (!aliveRef.current) return;
      const j = await api("POST", "", { action: "tick", id });
      if (!aliveRef.current) return;
      if (!j?.ok) { setErr(j?.error || "Tick fehlgeschlagen — neuer Versuch in 5 s"); await new Promise((r) => setTimeout(r, 5000)); continue; }
      cur = j.audit; setAudit(j.audit); setErr(j.audit?.error || "");
      if (j.audit.status !== "laufend") return;
    }
  }, []);

  useEffect(() => {
    if (resumeId) {
      void (async () => {
        const j = await api("GET", `?id=${resumeId}`);
        if (!aliveRef.current) return;
        if (j?.ok) {
          setAudit(j.audit);
          setForm({ domain: j.audit.domain, firmenname: j.audit.firmenname, branche: j.audit.branche || "", ort: j.audit.ort || "" });
          if (j.audit.status === "laufend") void runTicks(resumeId);
        }
      })();
    }
  }, [resumeId, runTicks]);

  const aiFind = async () => {
    setAiBusy(true); setErr("");
    const j = await api("POST", "", { action: "competitors", ...form });
    setAiBusy(false);
    if (!j?.ok) { setErr(j?.error || "Wettbewerber-Ermittlung fehlgeschlagen"); return; }
    setKandidaten((j.kandidaten || []).map((k: any) => ({ domain: k.domain, grund: k.grund, checked: k.empfohlen !== false })));
  };

  const start = async () => {
    setStartBusy(true); setErr("");
    const wettbewerber = (kandidaten || []).filter((k) => k.checked).map((k) => k.domain).slice(0, 3);
    const j = await api("POST", "", { action: "start", ...form, wettbewerber });
    setStartBusy(false);
    if (!j?.ok) { setErr(j?.error || "Start fehlgeschlagen"); return; }
    setAudit(j.audit); setStep(4);
    void runTicks(j.audit.id);
  };

  const formOk = form.domain.includes(".") && form.firmenname.trim().length >= 2;
  const curIdx = audit ? stageIndex(audit.stage) : 0;
  const d = audit?.data || {};

  const dot = (i: number) => {
    const on = step === i, done = step > i;
    return (
      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, flex: i < 4 ? 1 : undefined }}>
        <div style={{ width: 26, height: 26, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, flexShrink: 0, background: on ? S.grad : done ? S.greenDim : S.bg, color: on ? "#fff" : done ? S.green : S.dim, border: on || done ? "none" : `1px solid ${S.line}` }}>{done ? "✓" : i}</div>
        {i < 4 && <div style={{ flex: 1, height: 2, borderRadius: 2, background: step > i ? S.appLight : S.line }} />}
      </div>
    );
  };

  return (
    <div className="anl-noprint" style={{ position: "fixed", inset: 0, background: "rgba(22,18,23,.45)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: S.panel, borderRadius: 18, width: 620, maxWidth: "100%", maxHeight: "92vh", overflowY: "auto", boxShadow: "0 24px 70px rgba(60,0,70,.25)" }}>
        <div style={{ padding: "22px 26px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>{[1, 2, 3, 4].map(dot)}</div>
        </div>

        {/* Schritt 1: Firma & Markt */}
        {step === 1 && (
          <>
            <div style={{ padding: "0 26px 8px" }}>
              <h2 style={{ fontSize: 18, margin: "0 0 4px", fontFamily: "'Kamerik 105',Poppins,sans-serif" }}>Wen analysieren wir?</h2>
              <p style={{ fontSize: 13, color: S.mut, margin: "0 0 18px" }}>Domain genügt — Branche und Ort verbessern die automatische Prompt-Generierung.</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={lbl}>Domain *</label><input style={inp} placeholder="beispiel-kunde.ch" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} /></div>
                <div><label style={lbl}>Firmenname *</label><input style={inp} placeholder="Beispiel Kunde AG" value={form.firmenname} onChange={(e) => setForm({ ...form, firmenname: e.target.value })} /></div>
                <div><label style={lbl}>Branche</label><input style={inp} placeholder="z. B. Treuhand" value={form.branche} onChange={(e) => setForm({ ...form, branche: e.target.value })} /></div>
                <div><label style={lbl}>Ort / Markt</label><input style={inp} placeholder="z. B. Zürich" value={form.ort} onChange={(e) => setForm({ ...form, ort: e.target.value })} /></div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 26px 24px" }}>
              <button style={ghostBtn} onClick={onClose}>Abbrechen</button>
              <button style={{ ...ctaBtn, marginLeft: "auto", opacity: formOk ? 1 : 0.5, cursor: formOk ? "pointer" : "default" }} disabled={!formOk} onClick={() => setStep(2)}>Weiter</button>
            </div>
          </>
        )}

        {/* Schritt 2: Wettbewerber via AI */}
        {step === 2 && (
          <>
            <div style={{ padding: "0 26px 8px" }}>
              <h2 style={{ fontSize: 18, margin: "0 0 4px", fontFamily: "'Kamerik 105',Poppins,sans-serif" }}>Wettbewerber</h2>
              <p style={{ fontSize: 13, color: S.mut, margin: "0 0 18px" }}>Die AI ermittelt die relevantesten Wettbewerber aus Branche, Ort und den echten Suchergebnissen — du kannst sie danach anpassen.</p>
              {!kandidaten && (
                <button onClick={aiFind} disabled={aiBusy} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: S.tint, color: S.app, border: `1px solid rgba(119,0,140,.3)`, borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: aiBusy ? "default" : "pointer", fontFamily: "inherit" }}>
                  {aiBusy ? "AI analysiert Branche, SERP & AI-Antworten…" : "✦ Wettbewerber mit AI ermitteln"}
                </button>
              )}
              {kandidaten && (
                <div style={{ border: `1px solid ${S.line}`, borderRadius: 12, padding: "4px 14px", background: S.bg }}>
                  {kandidaten.map((k, i) => (
                    <label key={k.domain} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", fontSize: 13, borderBottom: i < kandidaten.length - 1 ? `1px solid ${S.line}` : "none", cursor: "pointer" }}>
                      <input type="checkbox" checked={k.checked} onChange={() => setKandidaten(kandidaten.map((x) => x.domain === k.domain ? { ...x, checked: !x.checked } : x))} />
                      <b>{k.domain}</b>
                      <span style={{ color: S.mut, fontSize: 12 }}>— {k.grund}</span>
                    </label>
                  ))}
                  <div style={{ display: "flex", gap: 8, padding: "10px 0" }}>
                    <input style={{ ...inp, flex: 1 }} placeholder="weitere-domain.ch manuell ergänzen" value={manuell} onChange={(e) => setManuell(e.target.value)} />
                    <button style={ghostBtn} onClick={() => { const dm = manuell.trim().toLowerCase(); if (dm.includes(".")) { setKandidaten([...kandidaten, { domain: dm, grund: "manuell ergänzt", checked: true }]); setManuell(""); } }}>+</button>
                  </div>
                </div>
              )}
              {kandidaten && <p style={{ fontSize: 11.5, color: S.dim, marginTop: 8 }}>Ermittelt aus SERP-Überschneidung + AI-Kuratierung. Max. 3 gehen in den Benchmark.</p>}
              {err && <p style={{ fontSize: 12.5, color: S.red, marginTop: 8 }}>{err}</p>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 26px 24px" }}>
              <button style={ghostBtn} onClick={() => setStep(1)}>Zurück</button>
              <button style={{ ...ctaBtn, marginLeft: "auto" }} onClick={() => setStep(3)}>{kandidaten?.some((k) => k.checked) ? "Weiter" : "Ohne Wettbewerber weiter"}</button>
            </div>
          </>
        )}

        {/* Schritt 3: Umfang & Start */}
        {step === 3 && (
          <>
            <div style={{ padding: "0 26px 8px" }}>
              <h2 style={{ fontSize: 18, margin: "0 0 4px", fontFamily: "'Kamerik 105',Poppins,sans-serif" }}>Bereit — das ist im Lauf enthalten</h2>
              <p style={{ fontSize: 13, color: S.mut, margin: "0 0 18px" }}>Jede Analyse läuft im vollen Umfang — Dauer ~15 Minuten.</p>
              <div style={{ border: `1px solid ${S.line}`, borderRadius: 12, overflow: "hidden" }}>
                {[
                  ["✦", "AI-Sichtbarkeit", "15 Prompts (1–3 Brand, Rest neutrale Alternativen-Suchen) über ChatGPT, Perplexity, Gemini, Claude + Makro-Mentions + AI-Suchvolumen je Prompt"],
                  ["⚙", "Technik & SiteHealth", "robots.txt-AI-Bots, OnPage-Audit (bis 50 Seiten), Tech-Stack-Erkennung"],
                  ["◈", "Entität & Vertrauen", "Wikidata, Organization-Schema, Brand-SERP"],
                  ["▤", "SEO-Fundament", "Sichtbarkeit, Traffic, Backlinks"],
                  ["⇄", "Wettbewerber-Benchmark", `${(kandidaten || []).filter((k) => k.checked).length || "keine"} Domains in Quick-Tiefe`],
                  ["🔌", "Anbindungs-Check", "CMS-Erkennung, GA4, Consent, Ads-Tag"],
                ].map(([ic, t, s2]) => (
                  <div key={t as string} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", fontSize: 13, borderBottom: `1px solid ${S.line}` }}>
                    <span style={{ width: 24, height: 24, borderRadius: 8, background: S.tint, color: S.app, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0 }}>{ic}</span>
                    <b>{t}</b>&nbsp;<span style={{ color: S.mut }}>— {s2}</span>
                  </div>
                ))}
              </div>
              {err && <p style={{ fontSize: 12.5, color: S.red, marginTop: 8 }}>{err}</p>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 26px 24px" }}>
              <button style={ghostBtn} onClick={() => setStep(2)}>Zurück</button>
              <button style={{ ...ctaBtn, marginLeft: "auto", opacity: startBusy ? 0.6 : 1 }} disabled={startBusy} onClick={start}>{startBusy ? "Prompt-Set wird generiert…" : "Analyse starten"}</button>
            </div>
          </>
        )}

        {/* Schritt 4: Fortschritt */}
        {step === 4 && (
          <>
            <div style={{ padding: "0 26px 8px" }}>
              <h2 style={{ fontSize: 18, margin: "0 0 4px", fontFamily: "'Kamerik 105',Poppins,sans-serif" }}>
                {audit?.status === "fertig" ? "Analyse abgeschlossen" : audit?.status === "fehler" ? "Analyse fehlgeschlagen" : "Analyse läuft…"}
              </h2>
              <p style={{ fontSize: 13, color: S.mut, margin: "0 0 14px" }}>
                {form.domain} — der Lauf arbeitet in Etappen; dieses Fenster sollte geöffnet bleiben. Über «Verlauf → Fortschritt» kannst du jederzeit hierher zurück.
              </p>
              <div style={{ height: 7, borderRadius: 4, background: S.bg, overflow: "hidden", margin: "4px 0 6px" }}>
                <div style={{ width: `${audit?.progress ?? 2}%`, height: "100%", borderRadius: 4, background: S.grad, transition: "width .6s" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: S.dim, marginBottom: 6 }}>
                <span>{audit?.progress ?? 0}%</span>
                <span>{audit?.status === "laufend" ? "läuft…" : audit?.status || ""}</span>
              </div>
              {STAGES.map((st2, i) => {
                const done = audit?.status === "fertig" || i < curIdx;
                const run = audit?.status === "laufend" && i === curIdx;
                let zwischenbefund = st2.desc;
                if (i === 0 && d.technik) zwischenbefund = `SiteHealth ${d.technik.scores?.overall ?? "?"}/100 · ${(d.technik.issues || []).length} Probleme${d.anbindung?.cms ? ` · ${d.anbindung.cms}` : ""}`;
                if (i === 1 && d.seo) zwischenbefund = `${d.seo.keywords} Keywords · ~${d.seo.etv} organische Besuche/Mt. · ${d.seo.refDomains} Ref-Domains`;
                if (i === 3 && d.prompts?.some((p: any) => p.engines)) {
                  const done2 = d.prompts.filter((p: any) => p.engines && Object.keys(p.engines).length >= 4).length;
                  zwischenbefund = `Prompt ${Math.min(done2 + 1, d.prompts.length)}/${d.prompts.length} · ChatGPT, Perplexity, Gemini, Claude`;
                }
                return (
                  <div key={st2.name} style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 4px", borderBottom: i < STAGES.length - 1 ? `1px solid ${S.line}` : "none" }}>
                    <div style={{ width: 26, height: 26, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 13, fontWeight: 800, background: done ? S.greenDim : run ? S.tint : S.bg, color: done ? S.green : run ? S.app : S.dim, border: done || run ? "none" : `1px dashed ${S.lineHover}` }}>
                      {done ? "✓" : run ? "⟳" : i + 1}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{st2.name}</div>
                      <div style={{ fontSize: 12, color: S.mut, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{zwischenbefund}</div>
                    </div>
                  </div>
                );
              })}
              {(err || audit?.error) && audit?.status !== "fertig" && (
                <p style={{ fontSize: 12, color: audit?.status === "fehler" ? S.red : S.orange, marginTop: 8 }}>{audit?.status === "fehler" ? audit?.error : (err || audit?.error)}</p>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 26px 24px" }}>
              <button style={ghostBtn} onClick={onClose}>Schliessen</button>
              {audit?.status === "fertig" && (
                <button style={{ ...ctaBtn, marginLeft: "auto" }} onClick={() => onDone(audit.id)}>Ergebnis ansehen</button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Ergebnisreport (komplett) ───────────────────────────────────────────────
function ResultView({ audit, onBack, onRerun }: { audit: AuditRow; onBack: () => void; onRerun: () => void }) {
  const d = audit.data || {};
  const dims = audit.dims || { ai: 0, technik: 0, entitaet: 0, seo: 0 };
  const prompts = (d.prompts || []) as Array<{ q: string; vol: number | null; engines?: Record<string, any> }>;
  const issues = (d.technik?.issues || []) as any[];
  const pages = (d.technik?.pages || []) as any[];
  const blocked = (d.technik?.blockedBots || []) as string[];
  const anb = d.anbindung || {};
  const ent = d.entitaet || {};
  const bench = d.benchmark || {};
  const missed = Number(d.missedVol) || 0;
  const ohneNennung = prompts.filter((p) => !Object.values(p.engines || {}).some((e: any) => e?.mention)).length;

  const printPdf = () => {
    // Alle Aufklapp-Panels oeffnen, damit der PDF-Export vollstaendig ist.
    document.querySelectorAll<HTMLDetailsElement>("details.anl-fold").forEach((el) => { el.open = true; });
    setTimeout(() => window.print(), 60);
  };

  const ring = (() => {
    const n = audit.score ?? 0;
    const dash = 295, off = Math.round(dash * (1 - n / 100));
    return (
      <div style={{ position: "relative", width: 108, height: 108, flexShrink: 0 }}>
        <svg width="108" height="108" viewBox="0 0 108 108" style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
          <circle cx="54" cy="54" r="47" fill="none" stroke={S.bg} strokeWidth="10" />
          <circle cx="54" cy="54" r="47" fill="none" stroke="url(#anlg)" strokeWidth="10" strokeLinecap="round" strokeDasharray={dash} strokeDashoffset={off} />
          <defs><linearGradient id="anlg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#71008B" /><stop offset="1" stopColor="#B9009C" /></linearGradient></defs>
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <b style={{ fontSize: 30, fontWeight: 800, lineHeight: 1 }}>{audit.score ?? "—"}</b>
          <span style={{ fontSize: 9.5, color: S.dim, fontWeight: 700, letterSpacing: ".05em", marginTop: 3 }}>AI-READINESS</span>
        </div>
      </div>
    );
  })();

  const dimCard = (label: string, n: number) => (
    <div key={label} style={{ border: `1px solid ${S.line}`, borderRadius: 12, padding: "12px 14px", background: S.panel }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: S.dim }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, margin: "3px 0 7px", color: scoreColor(n), fontVariantNumeric: "tabular-nums" }}>{n}</div>
      <div style={{ height: 5, borderRadius: 3, background: S.bg, overflow: "hidden" }}>
        <div style={{ width: `${n}%`, height: "100%", borderRadius: 3, background: scoreColor(n) }} />
      </div>
    </div>
  );

  const fold = (icon: React.ReactNode, iconBg: string, iconFg: string, title: string, hint: string, body: React.ReactNode) => (
    <details className="anl-fold" style={{ background: S.panel, border: `1px solid ${S.line}`, borderRadius: 14, marginTop: 16 }}>
      <summary style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", fontSize: 14, userSelect: "none" }}>
        <span style={{ width: 30, height: 30, borderRadius: 10, background: iconBg, color: iconFg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</span>
        <b style={{ fontSize: 14.5 }}>{title}</b>
        <span style={{ color: S.mut, fontSize: 12.5 }}>{hint}</span>
        <span style={{ marginLeft: "auto", color: S.app, fontWeight: 700, fontSize: 12.5 }}>
          <span className="anl-cl">Ansehen →</span><span className="anl-op">Zuklappen ↑</span>
        </span>
      </summary>
      <div style={{ padding: "6px 20px 16px" }}>{body}</div>
    </details>
  );

  return (
    <>
      {/* Druckkopf (nur im PDF sichtbar): Ezy-One-Logo + Meta */}
      <div className="anl-print-head" style={{ alignItems: "center", gap: 12, marginBottom: 18, paddingBottom: 14, borderBottom: `2px solid #77008C` }}>
        <div style={{ width: 34, height: 38, background: S.grad, clipPath: "polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 13 }}>EO</div>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Ezy One · Analyse</div>
          <div style={{ fontSize: 12, color: S.mut }}>{audit.firmenname} · {audit.domain} · {fmtDate(audit.created_at)} · ezyone.ch</div>
        </div>
      </div>

      <div className="anl-noprint" style={{ marginBottom: 20, display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div>
          <span style={{ fontSize: 12, color: S.app, fontWeight: 600, cursor: "pointer" }} onClick={onBack}>‹ Zurück zum Verlauf</span>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: "4px 0 0", fontFamily: "'Kamerik 105',Poppins,sans-serif" }}>{audit.domain}</h1>
          <div style={{ fontSize: 13, color: S.mut, marginTop: 4 }}>{audit.firmenname} • Analyse vom {fmtDate(audit.created_at)}</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <button style={ghostBtn} onClick={onRerun}>Re-Run</button>
          <button style={{ ...ctaBtn, display: "inline-flex", alignItems: "center", gap: 9, padding: "10px 18px", fontSize: 13 }} onClick={printPdf}>
            <span style={{ width: 16, height: 16, background: "#ffffff33", clipPath: "polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)", display: "inline-block" }} />
            PDF-Report exportieren
          </button>
        </div>
      </div>

      {/* Score-Kopf */}
      <div style={card}>
        <div style={{ display: "flex", gap: 22, alignItems: "center", flexWrap: "wrap" }}>
          {ring}
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
              Top-Befunde:{" "}
              {blocked.length
                ? <span style={{ color: S.red, fontWeight: 700 }}>AI-Crawler geblockt ({blocked.slice(0, 3).join(", ")})</span>
                : <span style={{ color: S.green, fontWeight: 700 }}>AI-Crawler erlaubt</span>}
              {" · "}
              {ent.wikidata?.found
                ? <span style={{ color: S.green, fontWeight: 700 }}>Wikidata vorhanden</span>
                : <span style={{ color: S.orange, fontWeight: 700 }}>kein Wikidata-Item</span>}
              {" · "}
              {dims.seo >= 55
                ? <span style={{ color: S.green, fontWeight: 700 }}>solides SEO-Fundament</span>
                : <span style={{ color: S.orange, fontWeight: 700 }}>schwaches SEO-Fundament</span>}
            </div>
            <div style={{ background: S.tint, border: "1px solid rgba(119,0,140,.18)", borderRadius: 12, padding: "12px 16px", fontSize: 13, marginTop: 16 }}>
              <b style={{ color: S.appLight, fontSize: 15 }}>Verpasstes AI-Suchvolumen: {fmtVol(missed)} Anfragen/Monat</b><br />
              Bei {ohneNennung} von {prompts.length} Prompts wird die Marke in keiner Engine genannt — dieses Volumen beantworten aktuell Wettbewerber und Verzeichnisse.
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginTop: 16 }}>
          {dimCard("AI-Sichtbarkeit", dims.ai)}
          {dimCard("Technik / SiteHealth", dims.technik)}
          {dimCard("Entität", dims.entitaet)}
          {dimCard("SEO-Fundament", dims.seo)}
        </div>
      </div>

      {/* Einordnung fuer bestehende EzyAI-Kunden: warum aivis hoehere Werte zeigt */}
      {d.aivisKunde?.name && (
        <div style={{ ...card, marginTop: 16, display: "flex", gap: 12, alignItems: "flex-start", borderColor: "rgba(119,0,140,.25)" }}>
          <span style={{ width: 30, height: 30, borderRadius: 10, background: S.tint, color: S.app, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>🤖</span>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            <b>{d.aivisKunde.name} ist bereits EzyAI-Kunde.</b> Das dortige Monitoring misst den kuratierten
            Prompt-Korpus <em>inklusive Brand-Prompts</em> über 30 Tage und alle Modelle — dadurch fallen Score,
            Erwähnungen und Citations höher aus. Diese Analyse misst bewusst {`${(d.prompts || []).filter((p: any) => !p.brand).length}`} neutrale
            Alternativen-Suchen: Sie zeigt, wie oft die Marke empfohlen wird, wenn <em>niemand nach ihr fragt</em>.
            Beide Werte sind korrekt — sie beantworten unterschiedliche Fragen.
          </div>
        </div>
      )}

      {/* Prompts × Engines */}
      <div style={{ ...card, marginTop: 16 }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 15.5 }}>Prompts × Engines</h3>
        <p style={{ fontSize: 12.5, color: S.mut, margin: "0 0 14px" }}>
          Jeder Prompt mit AI-Suchvolumen und Nennung je Engine{d.mentionsMakro?.total !== undefined ? ` · Makro-Erwähnungen über alle Plattformen: ${d.mentionsMakro.total}` : ""}.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontVariantNumeric: "tabular-nums" }}>
            <thead><tr>
              <th style={th}>Prompt</th><th style={{ ...th, textAlign: "right" }}>AI-Vol./Mt.</th>
              {ENGINE_COLS.map((e) => <th key={e} style={{ ...th, textAlign: "center" }}>{e}</th>)}
              <th style={th}>Stattdessen zitiert</th>
            </tr></thead>
            <tbody>
              {prompts.map((p) => {
                const cited = [...new Set(Object.values(p.engines || {}).flatMap((e: any) => e?.mention ? [] : (e?.cited || [])))]
                  .filter((c: any) => !String(c).includes(audit.domain)).slice(0, 3);
                return (
                  <tr key={p.q}>
                    <td style={td}>
                      {p.q}
                      {(p as any).brand && <span style={{ ...pillStyle(S.tint, S.app), marginLeft: 8, fontSize: 10.5 }}>Brand</span>}
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>{p.vol === null || p.vol === undefined ? "—" : Math.round(p.vol).toLocaleString("de-CH")}</td>
                    {ENGINE_COLS.map((e) => {
                      const r = p.engines?.[e];
                      return <td key={e} style={{ ...td, textAlign: "center", fontWeight: 800, color: !r || !r.ok ? S.dim : r.mention ? S.green : S.red }}>{!r || !r.ok ? "·" : r.mention ? "✓" : "–"}</td>;
                    })}
                    <td style={{ ...td, color: S.mut, fontSize: 12.5 }}>{cited.length ? cited.join(", ") : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* AI-Crawler-Zugriff je Bot (Prinzip externer robots.txt-Checker) */}
      {Array.isArray(d.technik?.botDetails) && d.technik.botDetails.length > 0 && (() => {
        const bots = d.technik.botDetails as Array<{ name: string; owner: string; status: string }>;
        const erlaubt = bots.filter((b) => b.status === "erlaubt").length;
        const blockiert = bots.filter((b) => b.status === "blockiert").length;
        const botPill = (st: string) => st === "erlaubt"
          ? <span style={pillStyle(S.greenDim, S.green)}>erlaubt</span>
          : st === "blockiert"
            ? <span style={pillStyle(S.redDim, S.red)}>blockiert</span>
            : <span style={pillStyle(S.tint, S.mut)}>nicht spezifiziert</span>;
        return fold("🤖", blockiert ? S.redDim : S.tint, blockiert ? S.red : S.app,
          `AI-Crawler-Zugriff · ${erlaubt} von ${bots.length} explizit erlaubt`,
          blockiert ? `— ${blockiert} blockiert` : "— robots.txt der Domain", (
          <div>
            <p style={{ fontSize: 12.5, color: S.mut, margin: "8px 0 10px" }}>
              Quelle: https://{audit.domain}/robots.txt — «erlaubt» = eigener User-agent-Block, nicht per <code style={{ background: S.bg, borderRadius: 4, padding: "1px 5px" }}>Disallow: /</code> gesperrt.
              «Nicht spezifiziert» = keine eigene Regel, es gelten die *-Regeln der robots.txt.
            </p>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr><th style={th}>Bot</th><th style={th}>Anbieter</th><th style={th}>Status</th></tr></thead>
                <tbody>
                  {bots.map((b) => (
                    <tr key={b.name}>
                      <td style={{ ...td, fontWeight: 600 }}>{b.name}</td>
                      <td style={{ ...td, color: S.mut }}>{b.owner}</td>
                      <td style={td}>{botPill(b.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ));
      })()}
      {d.technik && d.technik.robotsOk === false && (
        <div style={{ ...card, marginTop: 16, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 30, height: 30, borderRadius: 10, background: S.redDim, color: S.red, display: "flex", alignItems: "center", justifyContent: "center" }}>🤖</span>
          <div>
            <b style={{ fontSize: 14.5 }}>Keine robots.txt gefunden</b>
            <div style={{ fontSize: 12.5, color: S.mut }}>Ohne robots.txt gelten keine Bot-Regeln — alle Crawler dürfen lesen, aber die Steuerungsmöglichkeit fehlt.</div>
          </div>
        </div>
      )}

      {/* Issues (zugeklappt, wie EzyAI-SiteHealth) */}
      {fold("⚠", S.orangeDim, S.orange, `${issues.length} Probleme gefunden`, "— aus dem SiteHealth-Audit", (
        <div>
          {issues.map((i) => (
            <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px solid ${S.line}`, fontSize: 13 }}>
              <Sev v={i.severity} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{i.label}</div>
                <div style={{ color: S.mut, fontSize: 12.5 }}>{i.tipp}</div>
              </div>
              <span style={{ marginLeft: "auto", color: S.dim, fontSize: 12, flexShrink: 0 }}>{i.pages?.length ? `${i.pages.length} Seiten` : i.detail}</span>
            </div>
          ))}
          {issues.length === 0 && <div style={{ color: S.dim, fontSize: 12.5, padding: "8px 0" }}>Keine Probleme gefunden.</div>}
        </div>
      ))}

      {/* Geprüfte Seiten */}
      {fold("📄", S.tint, S.app, `Geprüfte Seiten · ${pages.length}`, "— OnPage-Audit je Seite", (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontVariantNumeric: "tabular-nums" }}>
            <thead><tr>
              <th style={th}>Seite</th><th style={{ ...th, textAlign: "right" }}>Score</th>
              <th style={{ ...th, textAlign: "right" }}>Probleme</th><th style={{ ...th, textAlign: "right" }}>HTTP</th>
              <th style={{ ...th, textAlign: "right" }}>Zeit</th>
            </tr></thead>
            <tbody>
              {pages.map((p) => (
                <tr key={p.path}>
                  <td style={{ ...td, maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.path}</td>
                  <td style={{ ...td, textAlign: "right" }}><ScorePill n={p.score} /></td>
                  <td style={{ ...td, textAlign: "right" }}>{p.issues}</td>
                  <td style={{ ...td, textAlign: "right", color: p.status >= 400 || p.status === 0 ? S.red : S.txt, fontWeight: p.status >= 400 || p.status === 0 ? 700 : 400 }}>{p.status || "—"}</td>
                  <td style={{ ...td, textAlign: "right" }}>{(p.ms / 1000).toFixed(1)} s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* Massnahmen + Benchmark/Anbindung */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 16, marginTop: 16 }}>
        <div style={card}>
          <h3 style={{ margin: "0 0 4px", fontSize: 15.5 }}>Top-5-Massnahmen</h3>
          <p style={{ fontSize: 12.5, color: S.mut, margin: "0 0 8px" }}>Automatisch aus den Befunden abgeleitet, nach Wirkung/Aufwand priorisiert.</p>
          {(d.massnahmen || []).map((m: any, i: number) => (
            <div key={i} style={{ display: "flex", gap: 12, padding: "11px 0", borderBottom: i < (d.massnahmen || []).length - 1 ? `1px solid ${S.line}` : "none", alignItems: "flex-start" }}>
              <span style={{ width: 24, height: 24, borderRadius: 999, background: S.grad, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, flexShrink: 0 }}>{i + 1}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{m.titel}</div>
                <div style={{ fontSize: 12.5, color: S.mut }}>{m.detail}</div>
              </div>
              <span style={{ marginLeft: "auto", flexShrink: 0 }}><Sev v={m.prio} /></span>
            </div>
          ))}
        </div>
        <div style={card}>
          <h3 style={{ margin: "0 0 4px", fontSize: 15.5 }}>Wettbewerber-Benchmark</h3>
          <p style={{ fontSize: 12.5, color: S.mut, margin: "0 0 8px" }}>Wettbewerber via AI ermittelt und in Quick-Tiefe mitanalysiert.</p>
          {[{ ...(bench.eigen || {}), domain: audit.domain, eigen: true }, ...(bench.wettbewerber || [])].map((b: any) => (
            <div key={b.domain} style={{ display: "grid", gridTemplateColumns: "150px 1fr 44px", gap: 12, alignItems: "center", padding: "7px 0", fontSize: 13 }}>
              <span style={{ fontWeight: b.eigen ? 700 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.domain}</span>
              <div style={{ height: 9, borderRadius: 5, background: S.bg, overflow: "hidden" }}>
                <div style={{ width: `${b.score ?? 0}%`, height: "100%", borderRadius: 5, background: b.eigen ? S.grad : S.lineHover }} />
              </div>
              <span style={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{b.score ?? "—"}</span>
            </div>
          ))}
          {(bench.wettbewerber || []).length > 0 && (() => {
            const top = [...bench.wettbewerber].sort((a: any, b: any) => (b.mentions || 0) - (a.mentions || 0))[0];
            return top?.mentions > (bench.eigen?.mentions || 0) ? (
              <div style={{ background: S.tint, border: "1px solid rgba(119,0,140,.18)", borderRadius: 12, padding: "12px 16px", fontSize: 13, marginTop: 14 }}>
                <b style={{ color: S.appLight }}>Pitch-Argument:</b> {top.domain} wird {top.mentions}× in AI-Antworten zitiert — {audit.domain} {bench.eigen?.mentions || 0}×.
              </div>
            ) : null;
          })()}
          <h3 style={{ margin: "20px 0 8px", fontSize: 15.5 }}>Anbindungs-Check</h3>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Chip ok={!!anb.cms} label={anb.cms ? `CMS: ${anb.cms}${anb.builder ? ` + ${anb.builder}` : ""}` : "CMS nicht erkannt"} warnIfMissing />
            <Chip ok={!!anb.ga4} label={anb.ga4 ? `GA4${anb.gaId ? ` (${anb.gaId})` : ""} erkannt` : "kein Analytics-Tag"} />
            <Chip ok={!!anb.gtm} label={anb.gtm ? `Tag Manager${anb.gtmId ? ` (${anb.gtmId})` : ""} erkannt` : "kein Tag Manager"} warnIfMissing />
            <Chip ok={!!anb.consent} label={anb.consent ? `Consent-Tool: ${anb.consent}` : "kein Consent-Tool erkannt"} warnIfMissing />
            {anb.adsTag
              ? <Chip ok label={`Ads-Tag${anb.adsId ? ` (${anb.adsId})` : ""} vorhanden`} />
              : anb.adsViaGtmMoeglich
                ? <Chip ok={false} label="Ads-Tag nicht im HTML sichtbar (evtl. im GTM-Container)" warnIfMissing />
                : <Chip ok={false} label="kein Ads-Tag" warnIfMissing />}
          </div>
          {ent.wikidata && (
            <>
              <h3 style={{ margin: "20px 0 8px", fontSize: 15.5 }}>Entität</h3>
              <div style={{ fontSize: 12.5, color: S.mut, lineHeight: 1.7 }}>
                Wikidata: {ent.wikidata.found ? <b style={{ color: S.green }}>{ent.wikidata.id} vorhanden</b> : <b style={{ color: S.orange }}>kein eindeutiges Item</b>}
                {" · "}Organization-Schema: {ent.orgSchema ? <b style={{ color: S.green }}>vorhanden</b> : <b style={{ color: S.orange }}>fehlt</b>}
                {" · "}Brand-SERP: {ent.brandPos === 1 ? <b style={{ color: S.green }}>#1 auf den eigenen Namen</b> : ent.brandPos ? <b style={{ color: S.orange }}>#{ent.brandPos}</b> : <b style={{ color: S.red }}>nicht in den Top 10</b>}
              </div>
            </>
          )}
        </div>
      </div>
      <p className="anl-noprint" style={{ fontSize: 11.5, color: S.dim, marginTop: 12 }}>
        Der PDF-Export erzeugt den vollständigen Report im Ezy-One-CI (Druckdialog → «Als PDF speichern»); alle Aufklapp-Panels werden dafür automatisch geöffnet.
      </p>
    </>
  );
}

function Chip({ ok, label, warnIfMissing }: { ok: boolean; label: string; warnIfMissing?: boolean }) {
  const fg = ok ? S.green : warnIfMissing ? S.orange : S.red;
  return (
    <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 11px", borderRadius: 99, border: `1px solid ${fg}`, color: fg, background: S.panel }}>
      {ok ? "✓" : warnIfMissing ? "△" : "✗"} {label}
    </span>
  );
}
