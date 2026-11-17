// Zufälliges Passwort für «Neues Passwort erzeugen» in der Benutzerverwaltung.
// Kein Zugriff auf Datenbank oder Netz.

const GROSS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const KLEIN = "abcdefghijkmnpqrstuvwxyz";
const ZIFFERN = "23456789";
const ZEICHEN = "!#%+-=?";
const ALLE = GROSS + KLEIN + ZIFFERN + ZEICHEN;

/** Gleichverteilte Zufallszahl 0..n-1 aus dem Krypto-Zufall (ohne Modulo-Schieflage). */
function zufall(n: number): number {
  const grenze = 256 - (256 % n);
  const b = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(b);
    if (b[0] < grenze) return b[0] % n;
  }
}

/**
 * Passwort ohne leicht verwechselbare Zeichen (kein 0/O, 1/l/I), mit je
 * mindestens einem Gross-, Kleinbuchstaben, einer Ziffer und einem Sonderzeichen.
 */
export function neuesPasswort(laenge = 20): string {
  const n = Math.max(12, Math.min(64, Math.floor(laenge)));
  const z = [GROSS, KLEIN, ZIFFERN, ZEICHEN].map((s) => s[zufall(s.length)]);
  while (z.length < n) z.push(ALLE[zufall(ALLE.length)]);
  for (let i = z.length - 1; i > 0; i--) {
    const j = zufall(i + 1);
    [z[i], z[j]] = [z[j], z[i]];
  }
  return z.join("");
}
