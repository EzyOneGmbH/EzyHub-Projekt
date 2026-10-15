// Kundenkontext (15.10.2026, Volkan Punkt 8) — NUR Team-Ansicht (Aufrufer gated
// mit istTeam). Ziele, Zielgruppe, Wettbewerber, Tonalität, Notizen; gespeichert
// im agent-service, jeder Agenten-Lauf des Kunden bekommt ihn als Kontext-Block.
import { useEffect, useState } from "react";
import { ezyFetch } from "@/ezy/data/api";
import { C } from "./theme";

const FELDER = [
  [
    "goals",
    "Ziele",
    "Was soll SEO/GEO für diesen Kunden erreichen? (z. B. mehr Direktbuchungen Winter, Seminaranfragen)",
  ],
  ["audience", "Zielgruppe", "Wer sucht? (z. B. Familien aus DE/CH, Business-Reisende Zürich)"],
  ["competitors", "Wettbewerber", "Wichtigste Mitbewerber (Namen/Domains), je Zeile einer"],
  [
    "tone",
    "Tonalität / Sprache",
    "z. B. Sie-Form, Schweizer Schreibweise (ss), herzlich, keine Superlative",
  ],
  [
    "notes",
    "Notizen",
    "Was Agenten wissen müssen (No-Gos, Saisonzeiten, laufende Aktionen, Absprachen)",
  ],
];

export default function KundenkontextCard({ clientId }) {
  const [offen, setOffen] = useState(false);
  const [werte, setWerte] = useState(null);
  const [stand, setStand] = useState(null);
  const [status, setStatus] = useState(null); // {fehler, text}
  const [speichert, setSpeichert] = useState(false);

  useEffect(() => {
    let abgebrochen = false;
    setWerte(null);
    setStand(null);
    setStatus(null);
    if (!clientId) return;
    ezyFetch(`/api/admin/client-kontext?clientId=${encodeURIComponent(clientId)}`)
      .then((r) => r.json())
      .then((j) => {
        if (abgebrochen) return;
        const c = j?.ok ? j.context : null;
        setWerte({
          goals: c?.goals || "",
          audience: c?.audience || "",
          competitors: c?.competitors || "",
          tone: c?.tone || "",
          notes: c?.notes || "",
        });
        setStand(c?.updatedAt ? { at: c.updatedAt, by: c.updatedBy } : null);
        if (!j?.ok) setStatus({ fehler: true, text: j?.error || "Kontext nicht ladbar" });
      })
      .catch(() => !abgebrochen && setStatus({ fehler: true, text: "Kontext nicht ladbar" }));
    return () => {
      abgebrochen = true;
    };
  }, [clientId]);

  const ausgefuellt = werte ? FELDER.filter(([f]) => String(werte[f] || "").trim()).length : 0;

  const speichern = async () => {
    if (!werte || speichert) return;
    setSpeichert(true);
    setStatus(null);
    try {
      const r = await ezyFetch("/api/admin/client-kontext", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, context: werte }),
      });
      const j = await r.json().catch(() => ({}));
      if (j?.ok) {
        setStand({ at: j.updatedAt, by: j.updatedBy });
        setStatus({ fehler: false, text: "Gespeichert — gilt ab dem nächsten Agenten-Lauf." });
      } else setStatus({ fehler: true, text: j?.error || "Speichern fehlgeschlagen" });
    } catch {
      setStatus({ fehler: true, text: "Speichern fehlgeschlagen" });
    } finally {
      setSpeichert(false);
    }
  };

  return (
    <div
      style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 }}
    >
      <div
        onClick={() => setOffen((v) => !v)}
        style={{ display: "flex", justifyContent: "space-between", cursor: "pointer", gap: 8 }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: C.textMuted }}>
          Kundenkontext für Agenten{" "}
          <span style={{ fontSize: 11, fontWeight: 400, color: C.textDim }}>(nur Team)</span>
        </div>
        <div style={{ fontSize: 11, color: C.textDim }}>
          {werte ? `${ausgefuellt}/5 Felder` : "lädt…"}
          {stand?.at ? ` · Stand ${new Date(stand.at).toLocaleDateString("de-CH")}` : ""}
          {offen ? " ▲" : " ▼"}
        </div>
      </div>
      {offen && werte && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 11, color: C.textDim }}>
            Wird jedem Agenten-Lauf dieses Kunden als Hintergrundwissen mitgegeben (keine Befehle).
            Für Kunden-Logins nicht sichtbar.
          </div>
          {FELDER.map(([f, label, hinweis]) => (
            <label key={f} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{label}</span>
              <textarea
                value={werte[f]}
                onChange={(e) => setWerte((w) => ({ ...w, [f]: e.target.value }))}
                placeholder={hinweis}
                rows={f === "notes" ? 4 : 2}
                maxLength={4000}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "8px 10px",
                  fontSize: 13,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  background: C.bg,
                  color: C.text,
                  resize: "vertical",
                  fontFamily: "inherit",
                }}
              />
            </label>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={speichern}
              disabled={speichert}
              style={{
                padding: "6px 14px",
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 8,
                border: "none",
                background: C.accent,
                color: "#fff",
                cursor: speichert ? "wait" : "pointer",
              }}
            >
              {speichert ? "Speichert…" : "Speichern"}
            </button>
            {stand?.by && (
              <span style={{ fontSize: 11, color: C.textDim }}>zuletzt von {stand.by}</span>
            )}
            {status && (
              <span style={{ fontSize: 12, color: status.fehler ? C.orange : C.green }}>
                {status.text}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
