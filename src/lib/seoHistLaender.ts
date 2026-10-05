// Laenderauswahl im Widget «Sichtbarkeit (organisch)» (05.10.2026): seo_history
// speichert je Monat ga4ByCountry {CH: n, DE: n, …}; aeltere Laeufe nur
// ga4OrganicCH → als {CH} behandelt.
export type SeoHistMonat = {
  month: string;
  ga4Organic?: number | null;
  ga4OrganicCH?: number | null;
  ga4ByCountry?: Record<string, number> | null;
};

function jeLand(m: SeoHistMonat): Record<string, number> {
  if (m.ga4ByCountry && typeof m.ga4ByCountry === "object") return m.ga4ByCountry;
  return m.ga4OrganicCH != null ? { CH: Number(m.ga4OrganicCH) } : {};
}

/** Laender mit organischem Traffic, absteigend nach Summe ueber alle Monate. */
export function laenderMitTraffic(months: SeoHistMonat[]): { code: string; total: number }[] {
  const sum = new Map<string, number>();
  for (const m of months) {
    for (const [code, n] of Object.entries(jeLand(m))) {
      if (Number(n) > 0) sum.set(code, (sum.get(code) ?? 0) + Number(n));
    }
  }
  return [...sum.entries()]
    .map(([code, total]) => ({ code, total }))
    .sort((a, b) => b.total - a.total || a.code.localeCompare(b.code));
}

/** Besuche eines Landes im Monat; null wenn der Lauf keine Laenderdaten hat. */
export function besucheLand(m: SeoHistMonat, code: string): number | null {
  const hatDaten = (m.ga4ByCountry && typeof m.ga4ByCountry === "object") || (code === "CH" && m.ga4OrganicCH != null);
  if (!hatDaten) return null;
  return Number(jeLand(m)[code] ?? 0);
}

export function landName(code: string): string {
  try {
    return new Intl.DisplayNames(["de-CH"], { type: "region" }).of(code) || code;
  } catch {
    return code;
  }
}
