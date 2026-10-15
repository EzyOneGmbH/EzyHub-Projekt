// Striking Distance (15.10.2026, Volkan Punkt 5; Idee aus open-seo, MIT):
// Search-Console-Begriffe, die bereits auf Ø-Position 5–20 ranken — dort bringt
// eine Content-Verbesserung am ehesten echten Traffic. Potenzial = zusaetzliche
// Klicks im Zeitraum, wenn der Begriff auf Platz 3 kaeme (typische CTR-Kurve).

export type GscZeile = {
  query?: string | null;
  position?: number | null;
  clicks?: number | null;
  impressions?: number | null;
  pageUrl?: string | null;
};

export type StrikingZeile = {
  query: string;
  position: number;
  clicks: number;
  impressions: number;
  pageUrl: string | null;
  potenzial: number;
  getrackt: boolean;
};

// Typische organische CTR je Position (Desktop+Mobil gemittelt, gerundet).
const CTR: Record<number, number> = {
  1: 0.28,
  2: 0.15,
  3: 0.1,
  4: 0.07,
  5: 0.05,
  6: 0.04,
  7: 0.03,
  8: 0.025,
  9: 0.02,
  10: 0.018,
};
export function ctrBeiPosition(pos: number): number {
  const p = Math.max(1, Math.round(pos));
  return CTR[p] ?? (p <= 20 ? 0.01 : 0.005);
}

export function strikingDistance(
  rows: GscZeile[] | null | undefined,
  getrackt: Set<string> = new Set(),
  opts: { min?: number; max?: number; limit?: number } = {},
): StrikingZeile[] {
  const min = opts.min ?? 5;
  const max = opts.max ?? 20;
  const out: StrikingZeile[] = [];
  const gesehen = new Set<string>();
  for (const r of rows || []) {
    const query = String(r.query ?? "").trim();
    const n = query.toLowerCase();
    const pos = Number(r.position);
    if (!query || gesehen.has(n) || !Number.isFinite(pos) || pos < min || pos > max) continue;
    gesehen.add(n);
    const impressions = Number(r.impressions) || 0;
    const clicks = Number(r.clicks) || 0;
    const potenzial = Math.max(
      0,
      Math.round(impressions * (ctrBeiPosition(3) - ctrBeiPosition(pos))),
    );
    out.push({
      query,
      position: Math.round(pos * 10) / 10,
      clicks,
      impressions,
      pageUrl: r.pageUrl ?? null,
      potenzial,
      getrackt: getrackt.has(n),
    });
  }
  out.sort((a, b) => b.potenzial - a.potenzial || b.impressions - a.impressions);
  return out.slice(0, opts.limit ?? 25);
}
