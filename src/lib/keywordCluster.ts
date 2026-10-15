// Keyword-Clustering nach Suchabsicht (15.10.2026, Volkan Punkt 9).
// Die KI gruppiert nur (Name, Absicht, Keywords); alle Kennzahlen rechnet dieser
// Code deterministisch aus Ranking- und Search-Console-Daten nach.

export type ClusterEingabe = {
  kw: string;
  pos: number | null;
  url: string | null;
  volume: number | null;
  impressions: number | null;
  clicks: number | null;
};

export type KiCluster = { name: string; intent: string; keywords: string[]; hinweis?: string };

export type Cluster = KiCluster & {
  anzahl: number;
  volumen: number;
  impressionen: number;
  klicks: number;
  bestePos: number | null;
  seiten: string[];
  kannibalisierung: boolean;
  luecke: boolean;
};

const INTENTS = ["informational", "commercial", "transactional", "navigational", "local"];
const norm = (s: unknown) =>
  String(s ?? "")
    .trim()
    .toLowerCase();

/** Ranking-Keywords + nicht getrackte GSC-Queries, nach Wichtigkeit gekuerzt. */
export function clusterEingabe(
  rankKeywords:
    | Array<{ kw?: string; pos?: number | null; url?: string | null; volume?: number | null }>
    | null
    | undefined,
  gscQueries:
    | Array<{
        query?: string;
        position?: number | null;
        pageUrl?: string | null;
        impressions?: number | null;
        clicks?: number | null;
      }>
    | null
    | undefined,
  limit = 300,
): ClusterEingabe[] {
  const gscMap = new Map<string, any>();
  for (const q of gscQueries || []) if (q?.query) gscMap.set(norm(q.query), q);
  const out = new Map<string, ClusterEingabe>();
  for (const k of rankKeywords || []) {
    const n = norm(k.kw);
    if (!n || out.has(n)) continue;
    const g = gscMap.get(n);
    out.set(n, {
      kw: n,
      pos: k.pos ?? null,
      url: k.url || g?.pageUrl || null,
      volume: k.volume ?? null,
      impressions: g?.impressions ?? null,
      clicks: g?.clicks ?? null,
    });
  }
  for (const [n, q] of gscMap) {
    if (out.has(n)) continue;
    out.set(n, {
      kw: n,
      pos: q.position != null ? Math.round(Number(q.position) * 10) / 10 : null,
      url: q.pageUrl || null,
      volume: null,
      impressions: q.impressions ?? null,
      clicks: q.clicks ?? null,
    });
  }
  const gewicht = (e: ClusterEingabe) => (e.volume ?? 0) + (e.impressions ?? 0) / 10;
  return [...out.values()].sort((a, b) => gewicht(b) - gewicht(a)).slice(0, limit);
}

/** JSON-Array aus der KI-Antwort holen (auch in ```-Fence oder mit Vor-/Nachtext). */
export function parseKiCluster(text: string): KiCluster[] {
  const roh = String(text || "");
  const start = roh.indexOf("[");
  const ende = roh.lastIndexOf("]");
  if (start < 0 || ende <= start) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(roh.slice(start, ende + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((c: any) => ({
      name: String(c?.name || "").trim(),
      intent: INTENTS.includes(norm(c?.intent)) ? norm(c?.intent) : "informational",
      keywords: Array.isArray(c?.keywords) ? c.keywords.map(norm).filter(Boolean) : [],
      hinweis: c?.hinweis ? String(c.hinweis).trim() : undefined,
    }))
    .filter((c) => c.name && c.keywords.length);
}

/** Kennzahlen je Cluster aus den echten Daten; Keywords ohne Datenzeile werden verworfen. */
export function clusterKennzahlen(ki: KiCluster[], eingabe: ClusterEingabe[]): Cluster[] {
  const map = new Map(eingabe.map((e) => [e.kw, e]));
  const vergeben = new Set<string>();
  const out: Cluster[] = [];
  for (const c of ki) {
    const zeilen = c.keywords
      .filter((k) => map.has(k) && !vergeben.has(k))
      .map((k) => {
        vergeben.add(k);
        return map.get(k)!;
      });
    if (!zeilen.length) continue;
    const top20 = zeilen.filter((z) => z.pos != null && z.pos > 0 && z.pos <= 20);
    const seiten = [...new Set(top20.map((z) => z.url).filter(Boolean) as string[])];
    const positionen = zeilen.map((z) => z.pos).filter((p): p is number => p != null && p > 0);
    out.push({
      ...c,
      keywords: zeilen.map((z) => z.kw),
      anzahl: zeilen.length,
      volumen: zeilen.reduce((s, z) => s + (z.volume ?? 0), 0),
      impressionen: zeilen.reduce((s, z) => s + (z.impressions ?? 0), 0),
      klicks: zeilen.reduce((s, z) => s + (z.clicks ?? 0), 0),
      bestePos: positionen.length ? Math.min(...positionen) : null,
      seiten,
      kannibalisierung: seiten.length >= 2,
      luecke: top20.length === 0,
    });
  }
  return out.sort((a, b) => b.volumen + b.impressionen / 10 - (a.volumen + a.impressionen / 10));
}
