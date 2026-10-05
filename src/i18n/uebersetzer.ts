// Sprach-Umschaltung (Volkan 05.10.2026): reiner Übersetzungs-Kern, testbar.
// Quelle sind die deutschen Oberflächentexte aus dem Code (scripts/i18n-extract.mjs
// → quellen.json); en.json/fr.json bilden Quelltext → Übersetzung ab. Texte mit
// Platzhaltern ({0}, {1} …) werden zu Mustern, damit z. B. «17 Kunden» → «17 clients».
// Übersetzt wird NUR, was exakt einem bekannten Oberflächentext entspricht —
// Kundendaten (Namen, Keywords, Berichte) bleiben dadurch unberührt.

export type Woerterbuch = {
  exakt: Map<string, string>;
  muster: Array<{ re: RegExp; ziel: string }>;
  /** Alle Übersetzungen — damit bereits übersetzte Texte nicht erneut angefasst werden. */
  ziele: Set<string>;
};

export const normiere = (t: string) => t.replace(/\s+/g, " ").trim();

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function baueWoerterbuch(eintraege: Record<string, string>): Woerterbuch {
  const exakt = new Map<string, string>();
  const muster: Array<{ re: RegExp; ziel: string; laenge: number }> = [];
  const ziele = new Set<string>();
  for (const [quelle, ziel] of Object.entries(eintraege || {})) {
    if (!quelle || typeof ziel !== "string" || !ziel.trim()) continue;
    const q = normiere(quelle);
    const z = normiere(ziel);
    if (q === z) continue;
    ziele.add(z);
    if (/\{\d+\}/.test(q)) {
      const literal = q.replace(/\{\d+\}/g, "");
      // Muster nur mit genug festem Text — «{0} %» o. Ä. würde alles treffen.
      if ((literal.match(/[A-Za-zÄÖÜäöüéèà]/g) || []).length < 3) continue;
      const teile = q.split(/(\{\d+\})/);
      const reihenfolge: number[] = [];
      const quelleRe = teile
        .map((t) => {
          const m = t.match(/^\{(\d+)\}$/);
          if (m) {
            reihenfolge.push(Number(m[1]));
            return "(.+?)";
          }
          return escape(t);
        })
        .join("");
      // Platzhalter im Ziel auf die Gruppen-Position umschreiben ({n} → $k).
      const zielTpl = z.replace(/\{(\d+)\}/g, (_, n) => {
        const k = reihenfolge.indexOf(Number(n));
        return k >= 0 ? `$${k + 1}` : "";
      });
      muster.push({ re: new RegExp(`^${quelleRe}$`), ziel: zielTpl, laenge: literal.length });
    } else {
      exakt.set(q, z);
    }
  }
  muster.sort((a, b) => b.laenge - a.laenge);
  return { exakt, muster: muster.map(({ re, ziel }) => ({ re, ziel })), ziele };
}

/**
 * Übersetzt einen Text (z. B. den Inhalt eines DOM-Textknotens). Führende und
 * folgende Leerzeichen bleiben erhalten. null = nichts zu tun.
 */
export function uebersetze(text: string, wb: Woerterbuch | null): string | null {
  if (!wb || !text) return null;
  const kern = normiere(text);
  if (!kern || kern.length < 2 || !/[A-Za-zÄÖÜäöü]/.test(kern)) return null;
  if (wb.ziele.has(kern) && !wb.exakt.has(kern)) return null;
  let neu = wb.exakt.get(kern) ?? null;
  if (neu == null) {
    for (const m of wb.muster) {
      if (m.re.test(kern)) {
        neu = kern.replace(m.re, m.ziel);
        break;
      }
    }
  }
  if (neu == null || neu === kern) return null;
  const vorne = text.match(/^\s*/)?.[0] ?? "";
  const hinten = text.match(/\s*$/)?.[0] ?? "";
  return `${vorne}${neu}${hinten}`;
}
