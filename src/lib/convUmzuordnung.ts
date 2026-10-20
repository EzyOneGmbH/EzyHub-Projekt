// Manuelle Kanal-Umzuordnung einzelner Buchungen (20.10.2026, Hotel Bären):
// GA4 kennt bei manchen Buchungen die Herkunft nicht («Unassigned», Sitzungs-
// bruch auf der Buchungsmaschine). Ezy One kann solche Buchungen pro Kunde
// gezielt einem Kanal zuordnen — gespeichert in clients.metadata.conv_umzuordnung:
//   { hinweis?, eintraege: [{ datum: "2026-10-05", nummer?, umsatz, von, nach }] }
// Angewendet wird nur in der Anzeige (Conversions-Tab): die Buchung wird beim
// alten Kanal abgezogen und beim neuen dazugezählt (Detailliste + Kanal-
// Tabelle), markiert mit `umgeordnet`. GA4 selbst bleibt unverändert.

export const CONV_UMZUORDNUNG_FELD = "conv_umzuordnung";

export type UmzuordnungEintrag = {
  datum: string; // "YYYY-MM-DD"
  nummer: string | null;
  umsatz: number;
  von: string;
  nach: string;
};

export type Umzuordnung = { hinweis: string | null; eintraege: UmzuordnungEintrag[] };

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Liest die Umzuordnung tolerant aus clients.metadata; null = nichts zu tun. */
export function umzuordnungVon(metadata: unknown): Umzuordnung | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const u = (metadata as Record<string, unknown>)[CONV_UMZUORDNUNG_FELD];
  if (!u || typeof u !== "object" || Array.isArray(u)) return null;
  const o = u as Record<string, unknown>;
  const eintraege = (Array.isArray(o.eintraege) ? o.eintraege : [])
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => ({
      datum: text(e.datum) ?? "",
      nummer: text(e.nummer),
      umsatz: Number(e.umsatz) || 0,
      von: text(e.von) ?? "Unassigned",
      nach: text(e.nach) ?? "",
    }))
    .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.datum) && e.nach && e.von !== e.nach);
  return eintraege.length ? { hinweis: text(o.hinweis), eintraege } : null;
}

type Zeile = Record<string, unknown> & {
  date?: string;
  eventName?: string;
  channel?: string;
  count?: number;
  value?: number;
};
type Kanal = Record<string, unknown> & {
  channel?: string;
  conversions?: number | null;
  revenue?: number | null;
};

const gleich = (a: unknown, b: unknown) =>
  String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();

/**
 * Wendet die Umzuordnung auf ein ga4_conversions-Ergebnis an (rows + channels).
 * Liefert ein neues Objekt plus die angewendeten Einträge; ohne Treffer bleibt
 * das Ergebnis unverändert. Ein Eintrag zählt im Zeitraum, wenn sein Datum in
 * result.range liegt (ohne range: wenn eine passende Kaufzeile existiert).
 */
export function umzuordnungAnwenden<T extends Record<string, unknown>>(
  result: T | null | undefined,
  u: Umzuordnung | null,
): { result: T | null | undefined; angewendet: UmzuordnungEintrag[] } {
  if (!result || !u) return { result, angewendet: [] };
  const range = (result.range ?? null) as { from?: string; to?: string } | null;
  let rows: Zeile[] = Array.isArray(result.rows)
    ? (result.rows as Zeile[]).map((r) => ({ ...r }))
    : [];
  const channels: Kanal[] | null = Array.isArray(result.channels)
    ? (result.channels as Kanal[]).map((c) => ({ ...c }))
    : null;
  const angewendet: UmzuordnungEintrag[] = [];

  for (const e of u.eintraege) {
    const tag = e.datum.replace(/-/g, "");
    const quelle = rows.find(
      (r) =>
        r.eventName === "purchase" &&
        r.date === tag &&
        gleich(r.channel, e.von) &&
        Number(r.count) > 0,
    );
    const imZeitraum =
      range?.from && range?.to ? e.datum >= range.from && e.datum <= range.to : !!quelle;
    if (!imZeitraum) continue;

    if (quelle) {
      quelle.count = Number(quelle.count) - 1;
      quelle.value = Math.max(0, Math.round((Number(quelle.value) - e.umsatz) * 100) / 100);
      rows.push({
        ...quelle,
        channel: e.nach,
        source: /organic/i.test(e.nach) ? "google" : String(quelle.source ?? ""),
        count: 1,
        value: e.umsatz,
        umgeordnet: true,
        transactionId: e.nummer,
      });
    }
    if (channels) {
      const alt = channels.find((c) => gleich(c.channel, e.von));
      if (alt && alt.conversions != null) {
        alt.conversions = Math.max(0, Number(alt.conversions) - 1);
        alt.revenue = Math.max(0, Math.round((Number(alt.revenue || 0) - e.umsatz) * 100) / 100);
      }
      let neu = channels.find((c) => gleich(c.channel, e.nach));
      if (!neu) {
        neu = { channel: e.nach, sessions: 0, conversions: 0, revenue: 0 };
        channels.push(neu);
      }
      neu.conversions = (Number(neu.conversions) || 0) + 1;
      neu.revenue = Math.round(((Number(neu.revenue) || 0) + e.umsatz) * 100) / 100;
      neu.umgeordnet = (Number(neu.umgeordnet) || 0) + 1;
    }
    angewendet.push(e);
  }
  if (!angewendet.length) return { result, angewendet };
  rows = rows
    .filter((r) => !(r.eventName === "purchase" && Number(r.count) <= 0))
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
  return { result: { ...result, rows, ...(channels ? { channels } : {}) }, angewendet };
}
