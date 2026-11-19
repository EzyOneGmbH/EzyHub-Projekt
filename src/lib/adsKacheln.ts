// EzyPerformance — Kennzahlen der Kunden-Kacheln in der Agentur-Übersicht
// (Volkan 19.11.2026: «Kacheln und Performance stündlich aktuell»).
//
// Zwei Quellen, gleiche Form:
//  1) Übersichts-Zeilen (/api/google/ads-overview) — derselbe stündlich
//     vorgewärmte Stand wie die Performance-Tabelle, Zeitraum der Kopfzeile.
//  2) Gespeicherte Snapshots (audit_runs «google_ads», alle 4 h) — für das
//     Kundenportal (Rolle viewer darf die Übersichts-Route nicht aufrufen) und
//     als Ausweichweg, wenn die Route nicht antwortet.

export type AdsKachel = {
  /** Werbekosten im Zeitraum (CHF). */
  budget: number;
  /** Conversion-Wert im Zeitraum (CHF). */
  revenue: number;
  roas: number;
  /** Datenstand als YYYY-MM-DD (Datum-Chip der Kachel). */
  date: string;
};

type OverviewZeile = {
  clientId?: string | null;
  cur?: { cost?: number | null; conversionValue?: number | null } | null;
  error?: string | null;
};

type SnapshotZeile = {
  client_id?: string | null;
  created_at?: string | null;
  t?: { cost?: number | null; conversionValue?: number | null } | null;
  roas?: number | null;
};

const zahl = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Übersichts-Zeilen → Kachelwerte. Liefert ein Konto gerade einen Fehler
 * (Ads-API kurz nicht erreichbar), bleibt der zuletzt gezeigte Wert desselben
 * Zeitraums stehen (`vorher`), statt die Kachel zu leeren.
 */
export function adsKachelnAusOverview(
  rows: ReadonlyArray<OverviewZeile> | null | undefined,
  stand: string,
  vorher: Record<string, AdsKachel> | null | undefined = null,
): Record<string, AdsKachel> {
  const out: Record<string, AdsKachel> = {};
  for (const r of rows ?? []) {
    const id = r?.clientId;
    if (!id) continue;
    if (r.cur) {
      const budget = zahl(r.cur.cost);
      const revenue = zahl(r.cur.conversionValue);
      out[id] = { budget, revenue, roas: budget > 0 ? revenue / budget : 0, date: stand };
    } else if (vorher?.[id]) {
      out[id] = vorher[id];
    }
  }
  return out;
}

/** Snapshot-Zeilen (neueste zuerst) → Kachelwerte; je Kunde gewinnt die erste Zeile. */
export function adsKachelnAusSnapshots(
  rows: ReadonlyArray<SnapshotZeile> | null | undefined,
): Record<string, AdsKachel> {
  const out: Record<string, AdsKachel> = {};
  for (const row of rows ?? []) {
    const id = row?.client_id;
    if (!id || out[id]) continue;
    out[id] = {
      budget: zahl(row.t?.cost),
      revenue: zahl(row.t?.conversionValue),
      roas: zahl(row.roas),
      date: String(row.created_at || "").slice(0, 10),
    };
  }
  return out;
}
