// Gemeinsame UI (aus EzyOneApp.jsx extrahiert, 18.08.2026 — reines
// Verschieben): Toast, Btn/Badge-Primitives und der komplette EzyPilot-Block.
// Zweck: /ezyai und /ezyai-analyse brauchen den 1.2-MB-Monolith-Chunk nicht
// mehr; der Monolith importiert dieselben Komponenten von hier.
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from "react";
import {
  AlertCircle,
  ArrowRight,
  Bot,
  CheckCircle,
  HelpCircle,
  MessageSquare,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { C } from "./theme";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { SKILL_CATALOG } from "@/ezy/data/skillCatalog";

// Parse ```agent-spec fenced JSON blocks the Co-Pilot emits when proposing agents.
function parseAgentSpecs(text) {
  const specs = [];
  const re = /```agent-spec\s*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text || "")) !== null) {
    try {
      const obj = JSON.parse(m[1].trim());
      if (obj && obj.name && obj.instructions) specs.push(obj);
    } catch {
      /* ignore malformed block */
    }
  }
  return specs;
}

// Strip agent-spec blocks from the displayed text (they're rendered as cards instead).
function stripAgentSpecs(text) {
  return String(text || "")
    .replace(/```agent-spec\s*\n[\s\S]*?```/g, "")
    .trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════════════════════════
const ToastCtx = createContext(null);
const useToast = () => useContext(ToastCtx);
// Exportiert: EzyAI (eigene Route) hängt EzyPilot ein und braucht denselben
// Toast-Context (Volkan 13.08.).
export function ToastProvider({ children }) {
  const [ts, setTs] = useState([]);
  const add = useCallback((msg, type = "info") => {
    const id = Date.now();
    setTs((p) => [...p, { id, msg, type }]);
    setTimeout(() => setTs((p) => p.filter((t) => t.id !== id)), 3500);
  }, []);
  const ic = { success: CheckCircle, error: AlertCircle, info: HelpCircle };
  const co = { success: C.green, error: C.red, info: C.blue };
  return (
    <ToastCtx.Provider value={add}>
      {children}
      <div
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {ts.map((t) => {
          const I = ic[t.type] || ic.info;
          return (
            <div
              key={t.id}
              style={{
                background: C.card,
                border: `1px solid ${co[t.type]}40`,
                borderRadius: 10,
                padding: "12px 16px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                boxShadow: "0 8px 32px rgba(0,0,0,.5)",
                animation: "slideUp .25s ease",
                minWidth: 280,
              }}
            >
              <I size={16} color={co[t.type]} />
              <span style={{ fontSize: 13, color: C.text }}>{t.msg}</span>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

function Btn({
  children,
  variant = "primary",
  size = "md",
  icon: Icon,
  onClick,
  disabled,
  style: sx,
  title,
}) {
  const base = {
    border: "none",
    cursor: disabled ? "default" : "pointer",
    borderRadius: 8,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontWeight: 600,
    transition: "all .15s",
    opacity: disabled ? 0.5 : 1,
    fontFamily: "inherit",
  };
  const sz = {
    sm: { padding: "5px 10px", fontSize: 11 },
    md: { padding: "7px 14px", fontSize: 12 },
    lg: { padding: "10px 20px", fontSize: 13 },
  };
  const va = {
    primary: { background: `linear-gradient(135deg,#71008B,#B9009C)`, color: "#fff" },
    secondary: { background: C.card, color: C.text, border: `1px solid ${C.border}` },
    ghost: { background: "transparent", color: C.textMuted },
    danger: { background: C.redDim, color: C.red },
    success: { background: C.greenDim, color: C.green },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{ ...base, ...sz[size], ...va[variant], ...sx }}
    >
      {Icon && <Icon size={size === "sm" ? 12 : 14} />}
      {children}
    </button>
  );
}
function Badge({ children, color = C.accent }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 6,
        background: `${color}18`,
        color,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

// ── EzyPilot shared store ───────────────────────────────────────────────────
// One conversation store shared by the full-page tab AND the header pop-up, so
// the chat + history stay in sync everywhere and survive reloads (localStorage).
const EzyPilotCtx = createContext(null);
const useEzyPilot = () => useContext(EzyPilotCtx);
const EZYPILOT_LS = "ezyPilot.v1";

function loadPilotState() {
  try {
    const raw = localStorage.getItem(EZYPILOT_LS);
    if (raw) {
      const p = JSON.parse(raw);
      if (Array.isArray(p.conversations))
        return {
          conversations: p.conversations,
          // pro-Kunde aktive Unterhaltung; alten Einzel-activeId verwerfen (wird neu je Kunde gesetzt)
          activeByClient:
            p.activeByClient && typeof p.activeByClient === "object" ? p.activeByClient : {},
        };
    }
  } catch {}
  return { conversations: [], activeByClient: {} };
}

export function EzyPilotProvider({ selectedClient, clients, tools, children }) {
  const toast = useToast();
  const [conversations, setConversations] = useState(() => loadPilotState().conversations);
  const [activeByClient, setActiveByClient] = useState(() => loadPilotState().activeByClient);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false); // header pop-up visibility
  // Keep latest portal context for send() without re-creating the callback.
  const ctxRef = useRef({ selectedClient, clients, tools });
  ctxRef.current = { selectedClient, clients, tools };

  // Persist on every change.
  useEffect(() => {
    try {
      localStorage.setItem(EZYPILOT_LS, JSON.stringify({ conversations, activeByClient }));
    } catch {}
  }, [conversations, activeByClient]);

  // Chat-Historie PRO KUNDE: jede Unterhaltung trägt clientId; activeByClient hält
  // die aktive Unterhaltung je Kunde. Kundenwechsel zeigt nur dessen Threads.
  const cid = selectedClient?.id || "global";
  // Einmalige Migration: alte Unterhaltungen ohne clientId dem ersten Kunden zuordnen
  // (nicht verlieren), sobald die Kundenliste geladen ist.
  const migratedRef = useRef(false);
  useEffect(() => {
    if (migratedRef.current) return;
    const fallback = (clients && clients[0] && clients[0].id) || null;
    if (!fallback) return;
    if (conversations.some((c) => !c.clientId)) {
      setConversations((cs) => cs.map((c) => (c.clientId ? c : { ...c, clientId: fallback })));
    }
    migratedRef.current = true;
  }, [clients, conversations]);

  const clientConvs = conversations.filter((c) => (c.clientId || "global") === cid);
  const activeId = activeByClient[cid] || null;
  const active = clientConvs.find((c) => c.id === activeId) || null;

  const newChat = () => {
    const id = `c_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    setConversations((cs) => [
      {
        id,
        clientId: cid,
        title: "Neue Unterhaltung",
        sessionId: null,
        messages: [],
        updatedAt: Date.now(),
      },
      ...cs,
    ]);
    setActiveByClient((m) => ({ ...m, [cid]: id }));
    return id;
  };
  const switchTo = (id) => setActiveByClient((m) => ({ ...m, [cid]: id }));
  const deleteChat = (id) => {
    setConversations((cs) => cs.filter((c) => c.id !== id));
    setActiveByClient((m) => (m[cid] === id ? { ...m, [cid]: null } : m));
  };

  const updateConv = (id, fn) => setConversations((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));

  const buildContext = () => {
    const { selectedClient, clients, tools } = ctxRef.current;
    return {
      aktiverKunde: selectedClient
        ? {
            name: selectedClient.name,
            domain: selectedClient.domain,
            branche: selectedClient.industry || null,
          }
        : null,
      alleKunden: (clients || []).map((c) => ({ name: c.name, domain: c.domain })),
      verfügbareSkills: SKILL_CATALOG.map((s) => s.skill),
      aktiveTools: (tools || []).filter((t) => t.enabled).map((t) => t.id),
    };
  };

  const send = async (text) => {
    const q = String(text || "").trim();
    if (!q || busy) return;
    // Ensure there's an active conversation.
    let convId = activeId;
    if (!convId || !conversations.find((c) => c.id === convId)) convId = newChat();
    const { selectedClient } = ctxRef.current;
    updateConv(convId, (c) => ({
      ...c,
      title: c.messages.length === 0 ? q.slice(0, 48) : c.title,
      messages: [...c.messages, { role: "user", text: q }],
      updatedAt: Date.now(),
    }));
    setBusy(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const curConv = (loadPilotState().conversations || []).find((c) => c.id === convId);
      const resumeSessionId =
        curConv?.sessionId || conversations.find((c) => c.id === convId)?.sessionId || null;
      const startRes = await fetch("/api/agent/copilot", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: q,
          context: buildContext(),
          resumeSessionId,
          activeClientId: selectedClient?.id || null,
          activeClientName: selectedClient?.name || null,
        }),
      });
      const start = await startRes.json().catch(() => ({}));
      if (!start.jobId) throw new Error(start.error || "Start fehlgeschlagen");
      let out = null;
      // 450 x 2s = 15 Min — muss ueber dem Backend-Limit (AGENT_TIMEOUT 10 Min)
      // liegen. Vorfall 23.07.: Lauf wurde nach 365s fertig, altes UI-Limit war
      // 360s — die fertige Antwort ging verloren.
      for (let i = 0; i < 450; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const pr = await fetch(`/api/agent/run-agent?jobId=${encodeURIComponent(start.jobId)}`, {
          headers: { Authorization: `Bearer ${session?.access_token || ""}` },
        });
        const pj = await pr.json().catch(() => ({}));
        if (pj.status === "done") {
          out = pj;
          break;
        }
        if (pj.status === "error") throw new Error(pj.error || "Agent-Fehler");
      }
      if (!out)
        throw new Error(
          "Zeitüberschreitung nach 15 Minuten — der Lauf wurde abgebrochen oder hängt. Bitte die Nachricht erneut senden; der Chat-Verlauf bleibt erhalten.",
        );
      const full = out.result || "";
      updateConv(convId, (c) => ({
        ...c,
        sessionId: out.sessionId || c.sessionId,
        messages: [
          ...c.messages,
          { role: "assistant", text: stripAgentSpecs(full), specs: parseAgentSpecs(full) },
        ],
        updatedAt: Date.now(),
      }));
    } catch (e) {
      updateConv(convId, (c) => ({
        ...c,
        messages: [
          ...c.messages,
          { role: "assistant", text: `⚠️ ${String(e?.message || e)}`, specs: [] },
        ],
        updatedAt: Date.now(),
      }));
    } finally {
      setBusy(false);
    }
  };

  const createAgent = async (spec) => {
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const clientId = ctxRef.current.selectedClient?.id || "global";
      const r = await fetch(`/api/agent/agents?clientId=${encodeURIComponent(clientId)}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientId,
          name: spec.name,
          description: spec.description || "",
          instructions: spec.instructions || "",
          model: spec.model || "claude-sonnet-4-6",
          skills: Array.isArray(spec.skills) ? spec.skills : [],
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (j.ok || j.agent) toast(`Agent „${spec.name}" erstellt`, "success");
      else throw new Error(j.error || "Erstellen fehlgeschlagen");
    } catch (e) {
      toast(String(e?.message || e), "error");
    }
  };

  const value = {
    conversations: clientConvs,
    active,
    activeId,
    busy,
    open,
    setOpen,
    messages: active?.messages || [],
    send,
    newChat,
    switchTo,
    deleteChat,
    createAgent,
  };
  return <EzyPilotCtx.Provider value={value}>{children}</EzyPilotCtx.Provider>;
}

// Shared chat surface (messages + input + suggestions). Used by tab and pop-up.
function EzyPilotChat({ compact = false }) {
  const { messages, busy, send, createAgent, active } = useEzyPilot();
  const [input, setInput] = useState("");
  const scrollRef = useRef(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const submit = () => {
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    send(q);
  };

  const suggestions = [
    "Wie entwickelt sich der Traffic?",
    "Erstelle einen Agenten für monatliche SEO-Reports",
    "Was wurde für diesen Kunden bisher gemacht?",
    "Welche Tools gibt es im Portal?",
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: compact ? "4px 2px" : "4px 2px",
        }}
      >
        {messages.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "16px 0" }}>
            <div style={{ fontSize: 13, color: C.textMuted }}>
              Frag mich etwas, oder starte mit:
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => send(s)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: C.rPill,
                    border: "1px solid rgba(43,0,51,.10)",
                    background: C.card,
                    color: C.text,
                    fontSize: 12.5,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    textAlign: "left",
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            {/* Redesign 1b (Screen 2e): Nutzer = Gradient-Bubble mit spitzer
              Ecke rechts unten, EzyPilot = weisse Bubble mit spitzer Ecke links. */}
            <div
              style={{
                maxWidth: "85%",
                background: msg.role === "user" ? C.grad : C.card,
                color: msg.role === "user" ? "#fff" : C.text,
                border: msg.role === "user" ? "none" : `1px solid ${C.border}`,
                borderRadius: msg.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                boxShadow:
                  msg.role === "user" ? "0 8px 20px -12px rgba(119,0,140,.5)" : C.cardShadow,
                padding: msg.role === "user" ? "12px 16px" : "14px 18px",
                fontSize: compact ? 13 : 14,
                lineHeight: 1.55,
                whiteSpace: "pre-wrap",
              }}
            >
              {msg.text}
              {(msg.specs || []).map((spec, si) => (
                <div
                  key={si}
                  style={{
                    marginTop: 10,
                    background: C.bg,
                    border: `1px solid ${C.accent}55`,
                    borderRadius: 10,
                    padding: 12,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <Bot size={15} color={C.accent} />
                    <span style={{ fontWeight: 700, color: C.text, fontSize: 13 }}>
                      {spec.name}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 8 }}>
                    {spec.description}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
                    {(spec.skills || []).map((sk) => (
                      <span
                        key={sk}
                        style={{
                          fontSize: 10,
                          padding: "2px 7px",
                          borderRadius: 5,
                          background: C.accentDim,
                          color: C.accentLight,
                        }}
                      >
                        {sk}
                      </span>
                    ))}
                  </div>
                  <Btn size="sm" icon={Plus} onClick={() => createAgent(spec)}>
                    Diesen Agenten erstellen
                  </Btn>
                </div>
              ))}
            </div>
          </div>
        ))}
        {busy && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div
              style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: "18px 18px 18px 4px",
                boxShadow: C.cardShadow,
                padding: "10px 14px",
                fontSize: 13,
                color: C.textMuted,
              }}
            >
              EzyPilot denkt nach…
            </div>
          </div>
        )}
      </div>
      {/* Redesign 1b (Screen 2e): Glas-Eingabebar mit Gradient-Sende-Kachel */}
      <div
        style={{
          display: "flex",
          gap: 10,
          marginTop: 12,
          alignItems: "flex-end",
          background: "rgba(255,255,255,.85)",
          backdropFilter: "blur(16px)",
          border: "1px solid rgba(43,0,51,.10)",
          borderRadius: 16,
          padding: "8px 8px 8px 16px",
          boxShadow: "0 12px 32px -20px rgba(43,0,51,.3)",
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Frage stellen oder „Erstelle einen Agenten der …"
          rows={compact ? 1 : 2}
          style={{
            flex: 1,
            padding: "8px 0",
            border: "none",
            background: "transparent",
            color: C.text,
            fontSize: 13.5,
            fontFamily: "inherit",
            outline: "none",
            resize: "none",
            boxSizing: "border-box",
          }}
        />
        <button
          onClick={submit}
          disabled={busy || !input.trim()}
          title="Senden"
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            border: "none",
            background: C.grad,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: busy || !input.trim() ? "default" : "pointer",
            opacity: busy || !input.trim() ? 0.5 : 1,
            flexShrink: 0,
          }}
        >
          <ArrowRight size={17} color="#fff" />
        </button>
      </div>
    </div>
  );
}

// History list (conversations) — shared by tab sidebar and pop-up dropdown.
function EzyPilotHistory({ compact = false }) {
  const { conversations, activeId, switchTo, newChat, deleteChat } = useEzyPilot();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <button
        onClick={() => newChat()}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "9px 12px",
          borderRadius: 8,
          border: `1px dashed ${C.border}`,
          background: "transparent",
          color: C.accentLight,
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 600,
          fontFamily: "inherit",
        }}
      >
        <Plus size={14} /> Neue Unterhaltung
      </button>
      {conversations.length === 0 && (
        <div style={{ fontSize: 12, color: C.textDim, padding: "8px 4px" }}>Noch kein Verlauf.</div>
      )}
      {conversations.map((c) => (
        <div
          key={c.id}
          onClick={() => switchTo(c.id)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            borderRadius: 8,
            cursor: "pointer",
            background: c.id === activeId ? C.accentDim : "transparent",
            border: `1px solid ${c.id === activeId ? C.accent + "55" : "transparent"}`,
          }}
        >
          <MessageSquare
            size={13}
            color={c.id === activeId ? C.accentLight : C.textDim}
            style={{ flexShrink: 0 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 12.5,
                color: c.id === activeId ? C.accentLight : C.text,
                fontWeight: c.id === activeId ? 600 : 400,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {c.title || "Unterhaltung"}
            </div>
            <div style={{ fontSize: 10.5, color: C.textDim }}>{c.messages.length} Nachrichten</div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              deleteChat(c.id);
            }}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: C.textDim,
              padding: 2,
              flexShrink: 0,
            }}
            title="Löschen"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

// Full-page EzyPilot tab: history sidebar + chat.
function EzyPilotPage({ selectedClient }) {
  return (
    <div style={{ display: "flex", gap: 16, height: "calc(100vh - 140px)" }}>
      {/* History sidebar */}
      <div
        className="ezypilot-sidebar"
        style={{
          width: 240,
          flexShrink: 0,
          overflowY: "auto",
          borderRight: `1px solid ${C.border}`,
          paddingRight: 14,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: C.textDim,
            textTransform: "uppercase",
            letterSpacing: ".5px",
            margin: "2px 4px 10px",
          }}
        >
          Verlauf
        </div>
        <EzyPilotHistory />
      </div>
      {/* Chat */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: C.accentDim,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Sparkles size={19} color={C.accent} />
          </div>
          <div>
            <h1 style={{ fontSize: 19, fontWeight: 700, margin: 0, color: C.text }}>EzyPilot</h1>
            <div style={{ fontSize: 12, color: C.textMuted }}>
              Opus 4.8 · Daten- & Portal-Fragen, Agenten bauen, Obsidian-Gedächtnis
              {selectedClient ? ` · Kontext: ${selectedClient.name}` : ""}
            </div>
          </div>
        </div>
        <EzyPilotChat />
      </div>
    </div>
  );
}

// Header pop-up: floating chat with a collapsible history list.
export function EzyPilotPopup() {
  const { open, setOpen } = useEzyPilot();
  const [showHistory, setShowHistory] = useState(false);
  if (!open) return null;
  return (
    <div
      className="ezypilot-popup"
      style={{
        position: "fixed",
        bottom: 20,
        right: 20,
        width: "min(420px, calc(100vw - 40px))",
        height: "min(620px, calc(100vh - 100px))",
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 16,
        boxShadow: "0 20px 60px rgba(0,0,0,.5)",
        zIndex: 200,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 16px",
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: C.accentDim,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Sparkles size={16} color={C.accent} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>EzyPilot</div>
          <div style={{ fontSize: 10.5, color: C.textDim }}>Opus 4.8</div>
        </div>
        <button
          onClick={() => setShowHistory((v) => !v)}
          title="Verlauf"
          style={{
            background: showHistory ? C.accentDim : "none",
            border: "none",
            cursor: "pointer",
            color: showHistory ? C.accentLight : C.textMuted,
            padding: 6,
            borderRadius: 6,
          }}
        >
          <MessageSquare size={16} />
        </button>
        <button
          onClick={() => setOpen(false)}
          title="Schliessen"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: C.textMuted,
            padding: 6,
          }}
        >
          <X size={18} />
        </button>
      </div>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {showHistory && (
          <div
            style={{
              width: 150,
              flexShrink: 0,
              overflowY: "auto",
              borderRight: `1px solid ${C.border}`,
              padding: 8,
            }}
          >
            <EzyPilotHistory compact />
          </div>
        )}
        <div
          style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, padding: 14 }}
        >
          <EzyPilotChat compact />
        </div>
      </div>
    </div>
  );
}

// Header button (right side) that toggles the EzyPilot pop-up.
export function EzyPilotButton() {
  const { open, setOpen } = useEzyPilot();
  return (
    <button
      onClick={() => setOpen((v) => !v)}
      title="EzyPilot öffnen"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "8px 13px",
        borderRadius: 8,
        border: `1px solid ${open ? C.accent : C.border}`,
        background: open
          ? C.accentDim
          : `linear-gradient(135deg, ${C.accent}, ${C.accentLight || C.accent})`,
        color: open ? C.accentLight : "#fff",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
      }}
    >
      <Sparkles size={15} />
      EzyPilot
    </button>
  );
}

// Redesign 1b (Screen 2h): EzyPilot als runder Gradient-Button — Top-Bar
// (mobil) und Bottom-Tab-Bar-Zentrum. Reine Kreis-Variante von EzyPilotButton.
export function EzyPilotFab({ size = 40, elevated = false }) {
  const { open, setOpen } = useEzyPilot();
  return (
    <button
      onClick={() => setOpen((v) => !v)}
      title="EzyPilot öffnen"
      aria-label="EzyPilot öffnen"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: "none",
        background: C.grad,
        color: "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        flexShrink: 0,
        boxShadow: elevated ? "0 8px 20px -8px rgba(119,0,140,.6)" : "none",
      }}
    >
      <Sparkles size={Math.round(size * 0.42)} />
    </button>
  );
}

export { useToast, Btn, Badge, EzyPilotPage, useEzyPilot };
