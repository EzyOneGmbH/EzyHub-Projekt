// Sprach-Umschaltung (Volkan 05.10.2026): Schalter DE | EN | FR und der
// Start der Übersetzung im Root. translate="no" schützt den Schalter selbst.
import { useEffect, useState } from "react";
import {
  SPRACHEN,
  SPRACH_KEY,
  aktuelleSprache,
  istSprache,
  ladeEintraege,
  setzeSprache,
  type Sprache,
} from "./sprache";

export function SprachSwitch({
  kompakt = false,
  hell = false,
}: {
  kompakt?: boolean;
  hell?: boolean;
}) {
  const [aktiv, setAktiv] = useState<Sprache>("de");
  useEffect(() => setAktiv(aktuelleSprache()), []);
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
            onClick={() => {
              if (an) return;
              setAktiv(s.id);
              void setzeSprache(s.id);
            }}
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
