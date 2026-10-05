// Sprach-Umschaltung (Volkan 05.10.2026): aktive Sprache (de | en | fr).
// Gespeichert pro Browser (localStorage) und — sobald eingeloggt — im
// Benutzerprofil (Supabase user_metadata.lang), damit sie geräteübergreifend gilt.
// Ein Wechsel lädt die Seite neu: so startet die Übersetzung sauber auf dem
// frischen Stand, und zurück auf Deutsch ist garantiert der Originaltext.

export type Sprache = "de" | "en" | "fr";
export const SPRACHEN: Array<{ id: Sprache; kurz: string; name: string }> = [
  { id: "de", kurz: "DE", name: "Deutsch" },
  { id: "en", kurz: "EN", name: "English" },
  { id: "fr", kurz: "FR", name: "Français" },
];
export const SPRACH_KEY = "ezy.lang.v1";

export function istSprache(v: unknown): v is Sprache {
  return v === "de" || v === "en" || v === "fr";
}

export function aktuelleSprache(): Sprache {
  try {
    const v = typeof window !== "undefined" ? window.localStorage.getItem(SPRACH_KEY) : null;
    return istSprache(v) ? v : "de";
  } catch {
    return "de";
  }
}

export async function setzeSprache(lang: Sprache, opts: { neuLaden?: boolean } = {}) {
  try {
    window.localStorage.setItem(SPRACH_KEY, lang);
  } catch {
    /* privater Modus — gilt dann nur bis zum Neuladen */
  }
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getSession();
    if (data.session) await supabase.auth.updateUser({ data: { lang } });
  } catch {
    /* Profil-Sync ist best effort */
  }
  if (opts.neuLaden !== false) window.location.reload();
}

/** Wörterbuch der Sprache laden (eigener Chunk je Sprache). */
export async function ladeEintraege(lang: Sprache): Promise<Record<string, string>> {
  if (lang === "en") return (await import("./en.json")).default as Record<string, string>;
  if (lang === "fr") return (await import("./fr.json")).default as Record<string, string>;
  return {};
}

/**
 * Inline-Skript für <head>: setzt <html lang> sofort und blendet die Seite bis
 * zur ersten Übersetzung aus (max. 1.5 s), damit kein deutscher Text aufblitzt.
 */
export const SPRACH_BOOT_SKRIPT = `(function(){try{var l=localStorage.getItem("${SPRACH_KEY}");if(l==="en"||l==="fr"){document.documentElement.lang=l;document.documentElement.setAttribute("data-i18n-warten","");setTimeout(function(){document.documentElement.removeAttribute("data-i18n-warten")},1500)}}catch(e){}})();`;
