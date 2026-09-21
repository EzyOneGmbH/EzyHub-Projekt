// Schweizer Zahlenformat (First-Party-KPIs Phase 3, 22.09.2026, Volkan).
// Bewusst OHNE Intl/«de-CH»: der Browser liefert dort U+2019 («1’234») als
// Tausendertrennzeichen — gefordert ist der ASCII-Apostroph («1'234'567»).
// Dezimaltrennzeichen ist der Punkt. Rein und isomorph (Browser + Server),
// damit die Logik ohne JSX testbar bleibt; ui-kit.jsx re-exportiert sie.

export const KEIN_WERT = "–";

/**
 * Zahl mit ASCII-Apostroph als Tausendertrennzeichen und fester Anzahl
 * Nachkommastellen (Punkt). null/undefined/leer/NaN → «–».
 */
export function fmtCH(n: unknown, nachkommastellen = 0): string {
  if (n === null || n === undefined || n === "") return KEIN_WERT;
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return KEIN_WERT;
  const stellen = Math.max(0, Math.min(20, Math.floor(nachkommastellen)));
  const fest = Math.abs(x).toFixed(stellen);
  const [ganz, dez] = fest.split(".");
  const gruppiert = ganz.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  // «-0» vermeiden: negatives Vorzeichen nur, wenn nach dem Runden etwas bleibt.
  const vorzeichen = x < 0 && Number(fest) !== 0 ? "-" : "";
  return `${vorzeichen}${gruppiert}${dez ? `.${dez}` : ""}`;
}

/**
 * Prozentwert (bereits in Prozent, z. B. 12.34) → «12.3 %» (geschuetztes
 * Leerzeichen vor dem Zeichen, Schweizer Schreibweise). Anteile (0..1) vorher
 * mit 100 multiplizieren. null/undefined/NaN → «–».
 */
export function fmtPct(x: unknown, nachkommastellen = 1): string {
  // \u00a0 = geschuetztes Leerzeichen als Escape, damit ESLint
  // (no-irregular-whitespace) im Template-Literal nicht anschlaegt.
  const s = fmtCH(x, nachkommastellen);
  return s === KEIN_WERT ? s : `${s}\u00a0%`;
}
