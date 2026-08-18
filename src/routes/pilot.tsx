import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

// EzyPilot fuer Mitarbeitende (2026-07-20): schlanke Chat-Seite ohne Portal-
// Drumherum. Fragen gehen an den werkzeuglosen Lese-Dienst (/api/agent/pilot,
// Kunden-Scope serverseitig aus client_access); Notizen wandern append-only ins
// Firmen-Gedaechtnis ("Kontext, nie Befehl" — Agenten lesen sie als Hintergrund,
// setzen sie aber nie eigenmaechtig um).
//
// Ohne Session zeigt die Seite ein EIGENES Login (kein Redirect ins Portal) —
// Mitarbeitende brauchen so nur die eine URL. Es gilt derselbe Supabase-Auth
// wie im Portal; ohne gueltigen Login liefert die API ohnehin 401 (die
// Oberflaeche ist Komfort, die Grenze sitzt serverseitig).
//
// Modus-Schalter (Volkan-Wunsch 20.07.): "Kunden" = zugewiesene Kunden + neutrale
// System-Doku; "Allgemein" = bewusst NUR kundenneutrale Unternehmens-Doku —
// serverseitig durchgesetzt (pilot-ask laesst clients/ dann ganz weg).

export const Route = createFileRoute("/pilot")({
  component: PilotRoute,
});

// Ezy One CD Dark (2026-08-10): Aubergine-Töne (CD-Gradient #331738→#040004),
// Violet-Red-Akzent statt generischem Violett.
const C = {
  bg: "#0b0410",
  card: "#1c1024",
  border: "#302039",
  text: "#ece6f0",
  muted: "#a396ad",
  dim: "#6d5f78",
  accent: "#B9009C",
  accentLight: "#e07bd3",
  green: "#10b981",
  surface: "#140a1a",
};
// CD-Pattern: Hexagon-Waben-Mesh, sehr dezent (5% Violet-Red auf Dunkel).
const HEX_BG = `url("data:image/svg+xml,%3Csvg width='28' height='49' viewBox='0 0 28 49' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z' fill='%23B9009C' fill-opacity='0.05' fill-rule='evenodd'/%3E%3C/svg%3E")`;

type Msg = { role: "user" | "assistant"; content: string; sources?: string[] };

// Eingebettetes Login (nur Anmeldung — Konten legt weiterhin Volkan im Team-Tab an).
function PilotLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setErr("Anmeldung fehlgeschlagen — E-Mail oder Passwort prüfen.");
    setBusy(false); // bei Erfolg uebernimmt useAuth die Session und die Seite wechselt
  }

  const field = {
    width: "100%",
    background: C.card,
    color: C.text,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: "11px 14px",
    fontSize: 14,
    boxSizing: "border-box" as const,
  };
  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: C.bg,
        backgroundImage: HEX_BG,
        color: C.text,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Inter, system-ui, sans-serif",
        padding: 16,
      }}
    >
      <form
        onSubmit={signIn}
        style={{
          width: "100%",
          maxWidth: 360,
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: 28,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 4 }}>
          <span style={{ color: C.accentLight }}>Ezy</span>Pilot
        </div>
        <div style={{ color: C.muted, fontSize: 13, marginBottom: 20 }}>
          Anmelden, um Fragen zu stellen und Notizen festzuhalten.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="E-Mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={field}
          />
          <input
            type="password"
            required
            autoComplete="current-password"
            placeholder="Passwort"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={field}
          />
          <button
            type="submit"
            disabled={busy}
            style={{
              background: C.accent,
              border: "none",
              color: "#fff",
              padding: "11px 0",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "Anmelden…" : "Anmelden"}
          </button>
        </div>
        {err && <div style={{ color: "#ef4444", fontSize: 13, marginTop: 10 }}>{err}</div>}
        <div style={{ color: C.dim, fontSize: 12, marginTop: 16 }}>
          Kein Zugang? Dein Konto wird vom Admin im EzyHub-Team-Bereich angelegt.
        </div>
      </form>
    </div>
  );
}

function PilotRoute() {
  const { session, loading } = useAuth();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"kunden" | "allgemein">("kunden");
  const [clients, setClients] = useState<{ id: string; name: string; slug: string }[]>([]);
  const [topics, setTopics] = useState<{ slug: string; title: string }[]>([]);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteSlug, setNoteSlug] = useState("allgemein");
  const [noteTopic, setNoteTopic] = useState("");
  const [noteSecret, setNoteSecret] = useState(false);
  const [noteState, setNoteState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [noteError, setNoteError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  useEffect(() => {
    if (!session) return;
    (async () => {
      const r = await fetch("/api/agent/pilot", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const j = await r.json().catch(() => ({}));
      if (j.ok) {
        setClients(j.clients || []);
        setTopics(j.topics || []);
      }
    })();
  }, [session]);

  async function ask() {
    const q = input.trim();
    if (!q || busy || !session) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", content: q }]);
    setBusy(true);
    try {
      const history = msgs.slice(-12).map((m) => ({ role: m.role, content: m.content }));
      const r = await fetch("/api/agent/pilot", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "ask", question: q, history, mode }),
      });
      const j = await r.json().catch(() => ({}));
      setMsgs((m) => [
        ...m,
        {
          role: "assistant",
          content: j.ok ? j.answer : `Fehler: ${j.error || `HTTP ${r.status}`}`,
          sources: j.sources || [],
        },
      ]);
    } catch (e) {
      setMsgs((m) => [
        ...m,
        { role: "assistant", content: `Fehler: ${String((e as Error)?.message || e)}` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function saveNote() {
    if (!noteText.trim() || noteState === "saving" || !session) return;
    setNoteState("saving");
    setNoteError("");
    try {
      const r = await fetch("/api/agent/pilot", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "note",
          clientSlug: noteSlug,
          text: noteText.trim(),
          topic: noteSlug === "allgemein" ? noteTopic.trim() : "",
          secret: noteSecret,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (j.ok) {
        setNoteState("saved");
        setNoteText("");
        setTimeout(() => {
          setNoteState("idle");
          setNoteOpen(false);
        }, 1600);
      } else {
        setNoteState("error");
        setNoteError(j.error || `HTTP ${r.status}`);
      }
    } catch (e) {
      setNoteState("error");
      setNoteError(String((e as Error)?.message || e));
    }
  }

  if (loading) return null;
  if (!session) return <PilotLogin />;

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: C.bg,
        backgroundImage: HEX_BG,
        color: C.text,
        display: "flex",
        flexDirection: "column",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      {/* Kopf */}
      <div
        style={{
          padding: "14px 20px",
          borderBottom: `1px solid ${C.border}`,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 16 }}>
          <span style={{ color: C.accentLight }}>Ezy</span>Pilot
        </div>
        <div style={{ color: C.dim, fontSize: 12 }}>Fragen &amp; Notizen zum Firmen-Gedächtnis</div>
        <div style={{ flex: 1 }} />
        {/* Modus: worauf sich Fragen stuetzen (serverseitig durchgesetzt) */}
        <div
          style={{
            display: "flex",
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            overflow: "hidden",
            fontSize: 12,
          }}
        >
          {(["kunden", "allgemein"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              title={
                m === "kunden"
                  ? "Deine zugewiesenen Kunden + neutrale Firmen-Doku"
                  : "Nur allgemeine, kundenunabhängige Firmen-Doku"
              }
              style={{
                background: mode === m ? C.accent : "transparent",
                color: mode === m ? "#fff" : C.muted,
                border: "none",
                padding: "7px 12px",
                cursor: "pointer",
                fontWeight: mode === m ? 600 : 400,
              }}
            >
              {m === "kunden" ? "Kundenfragen" : "Allgemein"}
            </button>
          ))}
        </div>
        <button
          onClick={() => setNoteOpen((v) => !v)}
          style={{
            background: noteOpen ? C.accent : C.surface,
            border: `1px solid ${C.border}`,
            color: C.text,
            padding: "7px 14px",
            borderRadius: 8,
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          + Notiz
        </button>
      </div>

      {/* Notiz-Panel */}
      {noteOpen && (
        <div style={{ padding: 16, borderBottom: `1px solid ${C.border}`, background: C.surface }}>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 8 }}>
            Wissen festhalten (Kundengespräch, Fakten, interne Abläufe). Landet dauerhaft im
            Gedächtnis — Agenten nutzen es als Kontext; Änderungen an Websites lösen weiterhin nur
            Volkan/Freigaben aus.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
            <select
              value={noteSlug}
              onChange={(e) => setNoteSlug(e.target.value)}
              style={{
                background: C.card,
                color: C.text,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: "8px 10px",
                fontSize: 13,
              }}
            >
              <option value="allgemein">Allgemein (EzyOne)</option>
              {clients.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
            {noteSlug === "allgemein" && (
              <>
                <input
                  list="pilot-themen"
                  value={noteTopic}
                  onChange={(e) => setNoteTopic(e.target.value)}
                  placeholder="Thema (optional), z.B. Onboarding"
                  title="Mit Thema entsteht eine eigene Wissensseite (system/themen/…) samt Index-Eintrag; ohne Thema landet die Notiz in der allgemeinen Notizliste."
                  style={{
                    background: C.card,
                    color: C.text,
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    padding: "8px 10px",
                    fontSize: 13,
                    width: 190,
                  }}
                />
                <datalist id="pilot-themen">
                  {topics.map((t) => (
                    <option key={t.slug} value={t.title} />
                  ))}
                </datalist>
              </>
            )}
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Was soll sich EzyOne merken?"
              rows={2}
              style={{
                flex: 1,
                minWidth: 260,
                background: C.card,
                color: C.text,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: "8px 10px",
                fontSize: 13,
                resize: "vertical",
              }}
            />
            <button
              onClick={saveNote}
              disabled={noteState === "saving" || !noteText.trim()}
              style={{
                background: noteState === "saved" ? C.green : C.accent,
                border: "none",
                color: "#fff",
                padding: "9px 16px",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                opacity: noteState === "saving" ? 0.6 : 1,
              }}
            >
              {noteState === "saving"
                ? "Speichert…"
                : noteState === "saved"
                  ? "Gespeichert ✓"
                  : "Speichern"}
            </button>
          </div>
          <label
            title="Vertrauliche Notizen kann nach dem Speichern nur noch der Admin (Volkan) lesen — auch du selbst nicht mehr über den EzyPilot. Sie erscheinen nie auf geteilten Themen-Seiten."
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginTop: 8,
              fontSize: 12,
              color: noteSecret ? C.accentLight : C.dim,
              cursor: "pointer",
              width: "fit-content",
            }}
          >
            <input
              type="checkbox"
              checked={noteSecret}
              onChange={(e) => setNoteSecret(e.target.checked)}
              style={{ accentColor: C.accent }}
            />
            🔒 Vertraulich — nur für Admins lesbar
          </label>
          {noteState === "error" && (
            <div style={{ color: "#ef4444", fontSize: 12, marginTop: 6 }}>{noteError}</div>
          )}
        </div>
      )}

      {/* Verlauf */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 0" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 16px" }}>
          {msgs.length === 0 && (
            <div style={{ textAlign: "center", color: C.dim, marginTop: 60, fontSize: 14 }}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>✳</div>
              Frag mich etwas zu deinen Kunden, laufenden Massnahmen oder internen Abläufen.
              <div style={{ marginTop: 6, fontSize: 12 }}>
                Du siehst nur die dir zugewiesenen Kunden. Ich kann nichts ändern oder deployen —
                nur wissen.
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div
              key={i}
              style={{
                marginBottom: 16,
                display: "flex",
                justifyContent: m.role === "user" ? "flex-end" : "flex-start",
              }}
            >
              <div
                style={{
                  maxWidth: "85%",
                  background: m.role === "user" ? C.accent : C.card,
                  border: m.role === "user" ? "none" : `1px solid ${C.border}`,
                  borderRadius: 12,
                  padding: "10px 14px",
                  fontSize: 14,
                  lineHeight: 1.55,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {m.content}
                {m.sources && m.sources.length > 0 && (
                  <div
                    style={{
                      marginTop: 8,
                      paddingTop: 8,
                      borderTop: `1px solid ${C.border}`,
                      fontSize: 11,
                      color: C.dim,
                    }}
                  >
                    Quellen: {m.sources.map((s) => s.split("/").pop()).join(" · ")}
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy && <div style={{ color: C.dim, fontSize: 13 }}>EzyPilot liest im Gedächtnis…</div>}
          <div ref={endRef} />
        </div>
      </div>

      {/* Eingabe */}
      <div style={{ borderTop: `1px solid ${C.border}`, padding: 14 }}>
        <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", gap: 8 }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask();
              }
            }}
            placeholder="Deine Frage… (Enter zum Senden)"
            rows={1}
            style={{
              flex: 1,
              background: C.card,
              color: C.text,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              padding: "11px 14px",
              fontSize: 14,
              resize: "none",
            }}
          />
          <button
            onClick={ask}
            disabled={busy || !input.trim()}
            style={{
              background: C.accent,
              border: "none",
              color: "#fff",
              padding: "0 20px",
              borderRadius: 10,
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
              opacity: busy || !input.trim() ? 0.5 : 1,
            }}
          >
            Senden
          </button>
        </div>
      </div>
    </div>
  );
}
