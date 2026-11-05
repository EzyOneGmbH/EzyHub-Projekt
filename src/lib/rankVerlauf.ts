// Verlauf Top 3 / Top 10 (05.11.2026, Volkan: «nur für Mitarbeiter ein Diagramm
// der Keywords in Top 3 und Top 10, wie beim organischen Traffic»). Je Messtag
// dieselbe Zählung wie die Kacheln (zaehleRankKacheln): letzter Rankings-Lauf
// des Tages + jüngster gsc_queries-Lauf bis Ende dieses Tages.
import { zaehleRankKacheln, type GscQuery, type RankKeyword } from "./rankKacheln";

export type LaufKopf = { id: string; created_at: string };
export type VerlaufPunkt = { date: string; top3: number; top10: number };

/** Tag (YYYY-MM-DD) in Zürcher Zeit. */
export function tagZuerich(iso: string): string {
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" });
}

/**
 * Wählt je Tag den letzten Rankings-Lauf und dazu den jüngsten GSC-Lauf, der
 * nicht später angelegt wurde. Ergebnis aufsteigend nach Tag.
 */
export function waehleLaeufe(
  rankings: LaufKopf[],
  gsc: LaufKopf[],
): Array<{ date: string; rankingId: string; gscId: string | null }> {
  const jeTag = new Map<string, LaufKopf>();
  for (const r of rankings) {
    const d = tagZuerich(r.created_at);
    const alt = jeTag.get(d);
    if (!alt || r.created_at > alt.created_at) jeTag.set(d, r);
  }
  const gscSortiert = [...gsc].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return [...jeTag.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, r]) => {
      let g: LaufKopf | null = null;
      for (const x of gscSortiert) {
        if (x.created_at <= r.created_at) g = x;
        else break;
      }
      return { date, rankingId: r.id, gscId: g?.id ?? null };
    });
}

/** Punkte des Verlaufs; Tage ohne zählbare Zeilen fallen weg. */
export function rankVerlauf(
  auswahl: Array<{ date: string; rankingId: string; gscId: string | null }>,
  keywordsJeLauf: Map<string, RankKeyword[] | null | undefined>,
  gscJeLauf: Map<string, GscQuery[] | null | undefined>,
): VerlaufPunkt[] {
  const out: VerlaufPunkt[] = [];
  for (const a of auswahl) {
    const z = zaehleRankKacheln(
      keywordsJeLauf.get(a.rankingId),
      a.gscId ? gscJeLauf.get(a.gscId) : null,
    );
    if (z) out.push({ date: a.date, top3: z.top3, top10: z.top10 });
  }
  return out;
}

const plusTag = (ymd: string) =>
  new Date(Date.parse(`${ymd}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);

/**
 * Tagesreihe bis einschliesslich `bis` (gestern, 05.11.2026 Volkan: «immer bis
 * zum gestrigen Tag»): spätere Punkte fallen weg, Tage ohne Messlauf tragen den
 * letzten bekannten Stand (wie die Kacheln, die den letzten Lauf zeigen).
 */
export function bisTag(punkte: VerlaufPunkt[], bis: string): VerlaufPunkt[] {
  const p = [...punkte].filter((x) => x.date <= bis).sort((a, b) => a.date.localeCompare(b.date));
  if (!p.length) return [];
  const out: VerlaufPunkt[] = [];
  let i = 0;
  let letzter = p[0];
  for (let d = p[0].date; d <= bis; d = plusTag(d)) {
    while (i < p.length && p[i].date <= d) letzter = p[i++];
    out.push({ date: d, top3: letzter.top3, top10: letzter.top10 });
  }
  return out;
}
