// Sprach-Umschaltung (Volkan 05.10.2026): Schalter DE | EN | FR und der
// Start der Übersetzung im Root. translate="no" schützt den Schalter selbst.
import { useEffect, useRef, useState } from "react";
import {
  SPRACHEN,
  SPRACH_KEY,
  aktuelleSprache,
  istSprache,
  ladeEintraege,
  setzeSprache,
  type Sprache,
} from "./sprache";

type Variante = "auto" | "segment" | "menu";

/**
 * Sprachschalter für die Kopfzeilen (Volkan 06.10.2026: «im Header, überall»).
 * variante="auto": Desktop = Segment DE | EN | FR, Handy (≤ 760 px) = kompakte
 * Pille «DE ▾» mit Auswahlmenü — die Umschaltung macht CSS (styles.css).
 */
export function SprachSwitch({
  kompakt = false,
  hell = false,
  variante = "segment",
}: {
  kompakt?: boolean;
  hell?: boolean;
  variante?: Variante;
}) {
  if (variante === "auto")
    return (
      <>
        <span className="sprach-seg">
          <SprachSegment kompakt={kompakt} hell={hell} />
        </span>
        <span className="sprach-menu">
          <SprachMenue hell={hell} />
        </span>
      </>
    );
  if (variante === "menu") return <SprachMenue hell={hell} />;
  return <SprachSegment kompakt={kompakt} hell={hell} />;
}

function useAktiveSprache() {
  const [aktiv, setAktiv] = useState<Sprache>("de");
  useEffect(() => setAktiv(aktuelleSprache()), []);
  const waehle = (id: Sprache) => {
    if (id === aktiv) return;
    setAktiv(id);
    void setzeSprache(id);
  };
  return { aktiv, waehle };
}

function SprachSegment({ kompakt, hell }: { kompakt: boolean; hell: boolean }) {
  const { aktiv, waehle } = useAktiveSprache();
  const rand = hell ? "rgba(255,255,255,.35)" : "rgba(43,0,51,.12)";
  return (
    <div
      translate="no"
      role="radiogroup"
      aria-label="Sprache / Language / Langue"
      style={{
        display: "inline-flex",
        gap: 2,
        padding: 2,
        borderRadius: 999,
        border: `1px solid ${rand}`,
        background: hell ? "rgba(255,255,255,.12)" : "#fff",
        flexShrink: 0,
      }}
    >
      {SPRACHEN.map((s) => {
        const an = s.id === aktiv;
        return (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={an}
            aria-label={s.name}
            title={s.name}
            onClick={() => waehle(s.id)}
            style={{
              minWidth: kompakt ? 32 : 38,
              minHeight: kompakt ? 26 : 30,
              padding: "0 8px",
              borderRadius: 999,
              border: "none",
              cursor: an ? "default" : "pointer",
              fontFamily: "inherit",
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: ".04em",
              background: an ? "#77008C" : "transparent",
              color: an ? "#fff" : hell ? "#fff" : "#6d6473",
            }}
          >
            {s.kurz}
          </button>
        );
      })}
    </div>
  );
}

function SprachMenue({ hell }: { hell: boolean }) {
  const { aktiv, waehle } = useAktiveSprache();
  const [offen, setOffen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!offen) return;
    const zu = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOffen(false);
    };
    document.addEventListener("pointerdown", zu);
    return () => document.removeEventListener("pointerdown", zu);
  }, [offen]);
  const kurz = SPRACHEN.find((s) => s.id === aktiv)?.kurz || "DE";
  return (
    <div ref={ref} translate="no" style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={offen}
        aria-label="Sprache / Language / Langue"
        onClick={() => setOffen((o) => !o)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          minHeight: 34,
          padding: "0 10px",
          borderRadius: 999,
          border: `1px solid ${hell ? "rgba(255,255,255,.35)" : "rgba(43,0,51,.12)"}`,
          background: hell ? "rgba(255,255,255,.12)" : "#fff",
          color: hell ? "#fff" : "#161217",
          fontFamily: "inherit",
          fontSize: 12,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        {kurz}
        <span aria-hidden style={{ fontSize: 9, opacity: 0.6 }}>
          ▾
        </span>
      </button>
      {offen && (
        <div
          role="menu"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            minWidth: 150,
            background: "#fff",
            border: "1px solid rgba(43,0,51,.12)",
            borderRadius: 12,
            boxShadow: "0 12px 32px -12px rgba(43,0,51,.35)",
            padding: 4,
            zIndex: 300,
          }}
        >
          {SPRACHEN.map((s) => (
            <button
              key={s.id}
              type="button"
              role="menuitemradio"
              aria-checked={s.id === aktiv}
              onClick={() => {
                setOffen(false);
                waehle(s.id);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                minHeight: 40,
                padding: "0 12px",
                border: "none",
                borderRadius: 8,
                background: s.id === aktiv ? "rgba(119,0,140,.08)" : "transparent",
                color: s.id === aktiv ? "#77008C" : "#161217",
                fontFamily: "inherit",
                fontSize: 13.5,
                fontWeight: s.id === aktiv ? 700 : 500,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span style={{ width: 24, fontWeight: 700 }}>{s.kurz}</span>
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Startet die Übersetzung nach der Hydration (einmal im Root gemountet). */
export function SprachInit() {
  useEffect(() => {
    let aus = false;
    const lang = aktuelleSprache();
    const fertig = () => document.documentElement.removeAttribute("data-i18n-warten");
    // Profil-Sprache übernehmen, wenn auf diesem Gerät noch nichts gewählt ist.
    void (async () => {
      try {
        if (window.localStorage.getItem(SPRACH_KEY)) return;
        const { supabase } = await import("@/integrations/supabase/client");
        const { data } = await supabase.auth.getSession();
        const p = data.session?.user?.user_metadata?.lang;
        if (istSprache(p) && p !== "de") await setzeSprache(p);
      } catch {
        /* best effort */
      }
    })();
    if (lang === "de") {
      fertig();
      return;
    }
    void (async () => {
      try {
        const [{ baueWoerterbuch }, { starteDomUebersetzung, lenkeDatumsLocaleUm }, eintraege] =
          await Promise.all([import("./uebersetzer"), import("./dom"), ladeEintraege(lang)]);
        if (aus) return;
        lenkeDatumsLocaleUm(lang);
        starteDomUebersetzung(baueWoerterbuch(eintraege));
      } finally {
        fertig();
      }
    })();
    return () => {
      aus = true;
    };
  }, []);
  return null;
}
