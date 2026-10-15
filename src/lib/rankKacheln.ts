// Top-3/Top-10-Zaehlung EINER Quelle fuer Kunden-Dashboard, Agentur-Kacheln und
// Agentur-Tabelle (15.10.2026, Volkan: Agentur-Uebersicht wie Dashboard 2.4.15).
// Basis = Zeilen der Rankings-Tabelle: getrackte Keywords mit ihrer Position
// (Crawl, sonst GSC-Ø) UNION GSC-Non-Brand-Queries, die nicht getrackt sind
// (Position dfsPos, sonst GSC-Ø). Dedup nach normalisiertem Keyword.

export type RankKeyword = { kw?: string | null; pos?: number | null };
export type GscQuery = {
  query?: string | null;
  position?: number | null;
  dfsPos?: number | null;
};

const norm = (s: unknown) =>
  String(s ?? "")
    .trim()
    .toLowerCase();

/** Positionen aller Tabellenzeilen (null = ohne Position). */
export function rankTabellenPositionen(
  keywords: RankKeyword[] | null | undefined,
  gscQueries: GscQuery[] | null | undefined,
): Array<number | null> {
  const out: Array<number | null> = [];
  const seen = new Set<string>();
  for (const k of keywords || []) {
    seen.add(norm(k.kw));
    out.push(k.pos ?? null);
  }
  for (const q of gscQueries || []) {
    const n = norm(q.query);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(q.dfsPos != null ? q.dfsPos : (q.position ?? null));
  }
  return out;
}

export function zaehleRankKacheln(
  keywords: RankKeyword[] | null | undefined,
  gscQueries: GscQuery[] | null | undefined,
): { top3: number; top10: number } | null {
  const pos = rankTabellenPositionen(keywords, gscQueries);
  if (!pos.length) return null;
  const in_ = (max: number) =>
    pos.filter((p) => p != null && Number(p) > 0 && Number(p) <= max).length;
  return { top3: in_(3), top10: in_(10) };
}
