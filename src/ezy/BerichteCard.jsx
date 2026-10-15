// SEO-Berichte aus Vorlagen + teilbare Links (15.10.2026, Volkan Punkt 10) —
// NUR Team-Ansicht (Aufrufer gated mit istTeam). Berichte erscheinen NICHT auf
// der Berichtsseite des Kundenportals; Kunden sehen sie nur über einen Link.
import { useEffect, useState } from "react";
import { ezyFetch } from "@/ezy/data/api";
import { markdownToHtml } from "@/ezy/lib/markdown";
import { C } from "./theme";

const VORLAGEN = [
  ["monatsreport", "SEO-Monatsreport"],
  ["rankings", "Ranking-Report"],
  ["quickwins", "Quick-Wins-Report"],
];

export default function BerichteCard({ clientId }) {
  const [berichte, setBerichte] = useState([]);
  const [vorlage, setVorlage] = useState("monatsreport");
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState(null);
  const [link, setLink] = useState(null);

  const laden = () =>
    ezyFetch(`/api/admin/seo-bericht?clientId=${encodeURIComponent(clientId)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) {
          setBerichte(j.berichte || []);
          setSel((s) => s || j.berichte?.[0]?.id || null);
        }
      })
      .catch(() => {});

  useEffect(() => {
    setBerichte([]);
    setSel(null);
    setInfo(null);
    setLink(null);
    if (clientId) laden();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const post = async (body) => {
    const r = await ezyFetch("/api/admin/seo-bericht", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, ...body }),
    });
    return r.json().catch(() => ({}));
  };

  const erstellen = async () => {
    if (busy) return;
    setBusy(true);
    setInfo(null);
    setLink(null);
    try {
      const j = await post({ action: "create", vorlage });
      if (j?.ok) {
        setBerichte((b) => [j.bericht, ...b].slice(0, 10));
        setSel(j.bericht.id);
      } else setInfo({ fehler: true, text: j?.error || "Bericht konnte nicht erstellt werden" });
    } finally {
      setBusy(false);
    }
  };

  const teilen = async () => {
    if (busy || !sel) return;
    setBusy(true);
    setInfo(null);
    try {
      const j = await post({ action: "share", berichtId: sel, days: 30 });
      if (j?.ok) {
        const url = `${window.location.origin}${j.url}`;
        setLink(url);
        try {
          await navigator.clipboard.writeText(url);
          setInfo({ fehler: false, text: "Link kopiert (30 Tage gültig)." });
        } catch {
          setInfo({ fehler: false, text: "Link erstellt (30 Tage gültig)." });
        }
      } else setInfo({ fehler: true, text: j?.error || "Link konnte nicht erstellt werden" });
    } finally {
      setBusy(false);
    }
  };

  const aktuell = berichte.find((b) => b.id === sel) || null;
  const knopf = (onClick, label, primaer) => (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      style={{
        padding: "5px 12px",
        fontSize: 12,
        fontWeight: 600,
        borderRadius: 8,
        border: `1px solid ${C.accent}`,
        background: primaer ? C.accent : "transparent",
        color: primaer ? "#fff" : C.accent,
        cursor: busy ? "wait" : "pointer",
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: C.textMuted, marginBottom: 4 }}>
        Berichte aus Vorlagen{" "}
        <span style={{ fontSize: 11, fontWeight: 400, color: C.textDim }}>(nur Team)</span>
      </div>
      <div style={{ fontSize: 11, color: C.textDim, marginBottom: 10 }}>
        Aus den gespeicherten Messdaten. Kunden sehen einen Bericht nur über einen Freigabe-Link (30
        Tage gültig, widerrufbar) — nicht im Kundenportal.
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select
          value={vorlage}
          onChange={(e) => setVorlage(e.target.value)}
          style={{
            fontSize: 12,
            padding: "5px 8px",
            borderRadius: 8,
            border: `1px solid ${C.border}`,
            background: C.surface,
            color: C.text,
          }}
        >
          {VORLAGEN.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        {knopf(erstellen, busy ? "Erstellt…" : "Bericht erstellen", true)}
        {berichte.length > 0 && (
          <select
            value={sel || ""}
            onChange={(e) => {
              setSel(e.target.value);
              setLink(null);
              setInfo(null);
            }}
            style={{
              fontSize: 12,
              padding: "5px 8px",
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              background: C.surface,
              color: C.text,
              maxWidth: 320,
            }}
          >
            {berichte.map((b) => (
              <option key={b.id} value={b.id}>
                {b.titel}
              </option>
            ))}
          </select>
        )}
        {aktuell && knopf(teilen, "Freigabe-Link", false)}
        {info && (
          <span style={{ fontSize: 12, color: info.fehler ? C.orange : C.green }}>{info.text}</span>
        )}
      </div>
      {link && (
        <div style={{ marginTop: 8, fontSize: 12, wordBreak: "break-all", color: C.textMuted }}>
          {link}
        </div>
      )}
      {aktuell && (
        <div
          className="ezy-md"
          style={{
            marginTop: 12,
            padding: 14,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            background: C.bg,
            fontSize: 13,
            color: C.text,
            maxHeight: 420,
            overflowY: "auto",
          }}
          dangerouslySetInnerHTML={{ __html: markdownToHtml(aktuell.markdown || "") }}
        />
      )}
    </div>
  );
}
