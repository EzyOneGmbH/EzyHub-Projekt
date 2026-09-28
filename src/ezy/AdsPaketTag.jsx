// EzyPerformance-Paket als Tag (28.09.2026): Starter / Medium / Performance.
// Anzeige ueberall; Owner/Admin koennen per Klick waehlen (editable).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { ezyFetch } from "@/ezy/data/api";
import { ADS_PAKETE, adsPaketLabel, adsPaketVon } from "@/lib/adsPakete";
import { C } from "./theme";

export const CLIENTS_CHANGED_EVENT = "ezy:clients-changed";

const FARBE = {
  starter: { fg: C.cyan, bg: C.cyanDim },
  medium: { fg: C.blue, bg: C.blueDim },
  performance: { fg: C.accent, bg: C.accentDim },
};

export function AdsPaketChip({ paket, size = "sm", interaktiv = false, offen = false }) {
  const f = FARBE[paket];
  const gross = size === "md";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: gross ? 11.5 : 10.5,
        fontWeight: 700,
        lineHeight: 1.2,
        letterSpacing: ".01em",
        color: f ? f.fg : C.textDim,
        background: f ? f.bg : "transparent",
        border: f ? `1px solid transparent` : `1px dashed ${C.inputBorder}`,
        borderRadius: 999,
        padding: gross ? "3px 10px" : "2px 8px",
        whiteSpace: "nowrap",
      }}
    >
      {f ? adsPaketLabel(paket) : "+ Paket"}
      {interaktiv && (
        <ChevronDown
          size={11}
          style={{
            display: "inline-block",
            transform: offen ? "rotate(180deg)" : "none",
            transition: "transform .15s",
          }}
        />
      )}
    </span>
  );
}

/** Tag mit optionaler Auswahl. Ohne Paket und ohne Bearbeitungsrecht: nichts. */
export function AdsPaketTag({ client, editable = false, size = "sm" }) {
  const [paket, setPaket] = useState(() => adsPaketVon(client?.metadata));
  const [offen, setOffen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState("");
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => setPaket(adsPaketVon(client?.metadata)), [client?.metadata]);
  // Menue per Portal mit fester Position: in Tabellen (sticky Zelle, overflow)
  // wuerde ein absolut positioniertes Menue abgeschnitten. Beim Scrollen wird
  // es mitgefuehrt statt geschlossen (ein Scroll direkt nach dem Klick hat es
  // sonst sofort wieder zugemacht).
  const platziere = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const breite = 180;
    const hoehe = 190;
    const top = r.bottom + 6 + hoehe > window.innerHeight ? r.top - 6 - hoehe : r.bottom + 6;
    setPos({ top, left: Math.max(8, Math.min(r.left, window.innerWidth - breite - 8)) });
  };
  useEffect(() => {
    if (!offen) return;
    const zu = (e) => {
      if (ref.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOffen(false);
    };
    const esc = (e) => e.key === "Escape" && setOffen(false);
    document.addEventListener("mousedown", zu);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", platziere, true);
    window.addEventListener("resize", platziere);
    return () => {
      document.removeEventListener("mousedown", zu);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", platziere, true);
      window.removeEventListener("resize", platziere);
    };
  }, [offen]);
  const oeffne = () => {
    platziere();
    setOffen((v) => !v);
  };

  if (!editable) return paket ? <AdsPaketChip paket={paket} size={size} /> : null;

  const waehle = async (neu) => {
    setOffen(false);
    if (neu === paket || !client?.id) return;
    const vorher = paket;
    setPaket(neu);
    setBusy(true);
    setFehler("");
    try {
      const res = await ezyFetch("/api/ads-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id, paket: neu }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json?.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      window.dispatchEvent(new CustomEvent(CLIENTS_CHANGED_EVENT));
    } catch (e) {
      setPaket(vorher);
      setFehler(`Paket nicht gespeichert: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span
      ref={ref}
      style={{ position: "relative", display: "inline-block" }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        disabled={busy}
        title={fehler || "Paket wählen"}
        aria-haspopup="listbox"
        aria-expanded={offen}
        onClick={oeffne}
        style={{
          border: "none",
          background: "none",
          padding: 0,
          cursor: busy ? "wait" : "pointer",
          opacity: busy ? 0.6 : 1,
          fontFamily: "inherit",
          outline: fehler ? `2px solid ${C.red}` : "none",
          borderRadius: 999,
        }}
      >
        <AdsPaketChip paket={paket} size={size} interaktiv offen={offen} />
      </button>
      {offen &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              zIndex: 1000,
              minWidth: 170,
              background: "#fff",
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              boxShadow: "0 12px 32px -12px rgba(43,0,51,.28)",
              padding: 5,
            }}
          >
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                color: C.textDim,
                textTransform: "uppercase",
                letterSpacing: ".06em",
                padding: "5px 8px 4px",
              }}
            >
              EzyPerformance-Paket
            </div>
            {[...ADS_PAKETE.map((p) => p.id), null].map((id) => (
              <button
                key={id ?? "kein"}
                type="button"
                role="option"
                aria-selected={paket === id}
                onClick={() => waehle(id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  width: "100%",
                  border: "none",
                  background: paket === id ? C.cardHover : "transparent",
                  borderRadius: 7,
                  padding: "7px 8px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 12.5,
                  color: id ? C.text : C.textMuted,
                  textAlign: "left",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = C.cardHover)}
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = paket === id ? C.cardHover : "transparent")
                }
              >
                {id ? <AdsPaketChip paket={id} /> : "Kein Paket"}
                {paket === id && (
                  <Check size={14} color={C.accent} style={{ display: "inline-block" }} />
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </span>
  );
}
