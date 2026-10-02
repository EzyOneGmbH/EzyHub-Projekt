// Rekonstruierte organische Conversions (02.10.2026, Hotel des Horlogers):
// Für Zeiträume VOR einem Tracking-Fix lassen sich organische Buchungen teils
// nachträglich schätzen (z. B. gespeicherte Herkunft minus Google-Ads-Conversions).
// Diese Werte liegen pro Kunde in clients.metadata.conv_rekonstruktion und
// werden im Conversions-Tab als eigene, klar markierte Schätzung gezeigt —
// nie in die Live-Kacheln eingerechnet.

export const CONV_REKONSTRUKTION_FELD = "conv_rekonstruktion";

export type RekonstruktionZeile = {
  monat: string; // "2026-09"
  buchungen: number | null;
  umsatz: number | null;
  waehrung: string;
  detail: string | null;
};

export type Rekonstruktion = {
  titel: string;
  stand: string | null;
  methode: string | null;
  hinweis: string | null;
  zeilen: RekonstruktionZeile[];
};

const zahl = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Liest die Rekonstruktion tolerant aus clients.metadata; null = nichts anzuzeigen. */
export function rekonstruktionVon(metadata: unknown): Rekonstruktion | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const r = (metadata as Record<string, unknown>)[CONV_REKONSTRUKTION_FELD];
  if (!r || typeof r !== "object" || Array.isArray(r)) return null;
  const o = r as Record<string, unknown>;
  const zeilen = (Array.isArray(o.zeilen) ? o.zeilen : [])
    .filter((z): z is Record<string, unknown> => !!z && typeof z === "object")
    .map((z) => ({
      monat: text(z.monat) ?? "",
      buchungen: zahl(z.buchungen),
      umsatz: zahl(z.umsatz),
      waehrung: text(z.waehrung) ?? "CHF",
      detail: text(z.detail),
    }))
    .filter((z) => /^\d{4}-\d{2}$/.test(z.monat))
    .sort((a, b) => b.monat.localeCompare(a.monat));
  if (!zeilen.length) return null;
  return {
    titel: text(o.titel) ?? "Organische Buchungen vor dem Tracking-Fix (Schätzung)",
    stand: text(o.stand),
    methode: text(o.methode),
    hinweis: text(o.hinweis),
    zeilen,
  };
}

/** "2026-09" → "September 2026" */
export function monatLabel(monat: string): string {
  const [y, m] = monat.split("-").map(Number);
  const namen = [
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
  ];
  return namen[m - 1] ? `${namen[m - 1]} ${y}` : monat;
}

const tagIso = (d: Date) => d.toISOString().slice(0, 10);
const tageZwischen = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;

/**
 * Anteil der rekonstruierten Monatswerte, der in den Zeitraum [von, bis] fällt
 * (inklusive, "YYYY-MM-DD"). Teilweise überlappende Monate zählen anteilig nach
 * Tagen. null = keine Überschneidung. Nur für die Organic-Zeile der Kanal-Tabelle.
 */
export function rekonstruktionImZeitraum(
  r: Rekonstruktion | null,
  von: string | null | undefined,
  bis: string | null | undefined,
): { buchungen: number; umsatz: number; anteilig: boolean; monate: string[] } | null {
  if (!r || !von || !bis) return null;
  let buchungen = 0;
  let umsatz = 0;
  let anteilig = false;
  const monate: string[] = [];
  for (const z of r.zeilen) {
    const [y, m] = z.monat.split("-").map(Number);
    const mStart = `${z.monat}-01`;
    const mEnde = tagIso(new Date(Date.UTC(y, m, 0)));
    const s = von > mStart ? von : mStart;
    const e = bis < mEnde ? bis : mEnde;
    if (s > e) continue;
    const f = tageZwischen(s, e) / tageZwischen(mStart, mEnde);
    if (f < 1) anteilig = true;
    buchungen += (z.buchungen ?? 0) * f;
    umsatz += (z.umsatz ?? 0) * f;
    monate.push(z.monat);
  }
  return monate.length ? { buchungen, umsatz, anteilig, monate } : null;
}
