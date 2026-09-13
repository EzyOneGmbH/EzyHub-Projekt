// Einheitliche Zeitraumlogik (13.09.2026, Volkan) fuer EzyRank, EzyPerformance,
// GSC, GA4 und Google Ads. Isomorph (Browser + Server), rein, UTC-basiert.
//
// Vertrag: Ein Zeitraum ist IMMER ein exakter, INKLUSIVER Kalendertag-Bereich
// [startDate, endDate] im Format YYYY-MM-DD. "Letzte N Tage" bedeutet genau N
// Kalendertage: startDate = endDate - (N - 1). Das frueher verbreitete
// «heute minus N» lieferte N+1 Tage (Off-by-one) — ebenso GA4s
// "NdaysAgo".."today" (= N+1 Tage) und GAQL "today-N".."today".
//
// Benutzerdefinierte Zeitraeume werden exakt uebernommen (nie auf "days"
// abgerundet), validiert und begrenzt; Fehler landen als ZeitraumFehler beim
// Aufrufer (HTTP 400), statt stillschweigend einen Naeherungswert zu liefern.

export const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const TAG_MS = 86_400_000;

export type Zeitraum = {
  startDate: string;
  endDate: string;
  /** Anzahl Kalendertage inklusive beider Enden. */
  days: number;
  /** "custom" = exakt uebergeben, "days" = aus «letzte N Tage» abgeleitet. */
  quelle: "custom" | "days";
};

export class ZeitraumFehler extends Error {
  status = 400 as const;
}

export function istYmd(s: unknown): s is string {
  if (typeof s !== "string" || !YMD_RE.test(s)) return false;
  const ms = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(ms) && ymdUtc(new Date(ms)) === s;
}

export function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function heuteYmd(jetztMs: number = Date.now()): string {
  return ymdUtc(new Date(jetztMs));
}

/** Kalendertage addieren (negativ = subtrahieren), UTC, ohne DST-Effekte. */
export function addDays(ymd: string, n: number): string {
  const ms = Date.parse(`${ymd}T00:00:00Z`);
  if (!Number.isFinite(ms)) throw new ZeitraumFehler(`Ungültiges Datum: ${ymd}`);
  return ymdUtc(new Date(ms + n * TAG_MS));
}

/** Kalendertage von start bis end, beide inklusive (start == end → 1). */
export function tageInklusiv(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  return Math.round((b - a) / TAG_MS) + 1;
}

export type ZeitraumOptionen = {
  startDate?: string | null;
  endDate?: string | null;
  days?: number | string | null;
  /** Default fuer «letzte N Tage», wenn weder Range noch days angegeben. */
  defaultDays?: number;
  /** Obergrenze fuer Kalendertage (Custom UND days). */
  maxDays?: number;
  /** Datenpuffer: endDate = heute - endLagDays (z. B. GSC 3 Tage). */
  endLagDays?: number;
  /** Testbarkeit: «jetzt» in ms. */
  jetztMs?: number;
};

/**
 * Zentrale Auswertung von Zeitraum-Parametern:
 *  - startDate+endDate (YYYY-MM-DD) → exakt, inklusiv, validiert
 *  - sonst days (1..maxDays) → genau N Kalendertage bis endDate (heute - Lag)
 * Wirft ZeitraumFehler bei ungueltigen/zu langen/verdrehten Angaben.
 */
export function zeitraum(opts: ZeitraumOptionen = {}): Zeitraum {
  const maxDays = opts.maxDays ?? 366;
  const lag = Math.max(0, Math.floor(opts.endLagDays ?? 0));
  const heute = heuteYmd(opts.jetztMs);
  const hatStart = opts.startDate != null && opts.startDate !== "";
  const hatEnd = opts.endDate != null && opts.endDate !== "";
  if (hatStart || hatEnd) {
    if (!istYmd(opts.startDate) || !istYmd(opts.endDate))
      throw new ZeitraumFehler("startDate und endDate müssen beide als YYYY-MM-DD angegeben sein");
    const startDate = opts.startDate;
    const endDate = opts.endDate;
    if (startDate > endDate) throw new ZeitraumFehler("startDate liegt nach endDate");
    if (endDate > heute) throw new ZeitraumFehler("endDate liegt in der Zukunft");
    const days = tageInklusiv(startDate, endDate);
    if (days > maxDays) throw new ZeitraumFehler(`Zeitraum zu lang (max. ${maxDays} Tage)`);
    return { startDate, endDate, days, quelle: "custom" };
  }
  const roh = opts.days == null || opts.days === "" ? (opts.defaultDays ?? 28) : Number(opts.days);
  if (!Number.isInteger(roh) || roh < 1 || roh > maxDays)
    throw new ZeitraumFehler(`days muss eine ganze Zahl zwischen 1 und ${maxDays} sein`);
  const endDate = lag ? addDays(heute, -lag) : heute;
  const startDate = addDays(endDate, -(roh - 1));
  return { startDate, endDate, days: roh, quelle: "days" };
}

/** Gleich langer Zeitraum unmittelbar davor (fuer Deltas/Vergleiche). */
export function vorperiode(z: Pick<Zeitraum, "startDate" | "days">): Zeitraum {
  const endDate = addDays(z.startDate, -1);
  const startDate = addDays(endDate, -(z.days - 1));
  return { startDate, endDate, days: z.days, quelle: "custom" };
}

/** GA4 runReport dateRanges — immer explizite Daten, nie "NdaysAgo". */
export function ga4DateRange(z: Pick<Zeitraum, "startDate" | "endDate">) {
  return { startDate: z.startDate, endDate: z.endDate };
}

/** GAQL-Filter fuer Google Ads (segments.date ist inklusiv). */
export function gaqlBetween(z: Pick<Zeitraum, "startDate" | "endDate">): string {
  return `segments.date BETWEEN '${z.startDate}' AND '${z.endDate}'`;
}

/** Query-Parameter (URLSearchParams oder Objekt) in Optionen ueberfuehren. */
export function zeitraumAusParams(
  p: { get(name: string): string | null } | Record<string, unknown>,
  defaults: Omit<ZeitraumOptionen, "startDate" | "endDate" | "days"> = {},
): Zeitraum {
  const lies = (k: string): string | null =>
    typeof (p as any).get === "function"
      ? (p as any).get(k)
      : (p as Record<string, unknown>)[k] == null
        ? null
        : String((p as Record<string, unknown>)[k]);
  return zeitraum({
    ...defaults,
    // Akzeptierte Schreibweisen: startDate/endDate (kanonisch), start/end, from/to.
    startDate: lies("startDate") ?? lies("start") ?? lies("from"),
    endDate: lies("endDate") ?? lies("end") ?? lies("to"),
    days: lies("days"),
  });
}
