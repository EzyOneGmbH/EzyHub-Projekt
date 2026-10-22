import { useRangeData } from "@/ezy/data/rangeStore";
import { ezyFetch } from "@/ezy/data/api";

// EzyRank-Zeitraum-Stand (22.10.2026): Rankings (letzte DataForSEO-Messung bis
// Zeitraum-Ende), GSC je Keyword und Brand-Split über den gewählten Zeitraum —
// gleiche Server-Funktionen wie der SEO-Report-Endpoint.

const tagLokal = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  const x = new Date(d);
  if (isNaN(x.getTime())) return null;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

export type ZeitraumStand = {
  ok: true;
  period: { from: string; to: string };
  rankings: {
    measured_on: string | null;
    compare_measured_on: string | null;
    prev7_measured_on: string | null;
    prev28_measured_on: string | null;
    distribution: {
      current: ZeitraumVerteilung | null;
      previous: ZeitraumVerteilung | null;
    };
    keywords: Array<{
      kw: string;
      position: number | null;
      url: string | null;
      volume: number | null;
      posPrev7: number | null;
      posPrev28: number | null;
      gsc: { clicks: number; impressions: number; position: number | null } | null;
    }>;
  };
  gsc: {
    range: { from: string; to: string };
    brand_regex: string | null;
    brand: { clicks: number; impressions: number; queries: number };
    nonbrand: { clicks: number; impressions: number; queries: number };
    buckets_nonbrand: Record<
      "top3" | "top10" | "pos11to20" | "pos21plus",
      { queries: number; clicks: number; impressions: number }
    >;
    queries_untracked: Array<{
      query: string;
      clicks: number;
      impressions: number;
      position: number | null;
    }>;
  } | null;
};

export type ZeitraumVerteilung = {
  top3: number;
  top10: number;
  top20: number;
  top100: number;
  total_tracked: number;
};

/**
 * @param dateRange gewählter Zeitraum ({ start, end })
 * @param vergleichBis Ende des Vergleichs (aktiver Vergleich) bzw. Zeitraum-Anfang
 */
export function useEzyZeitraum(
  clientId: string | undefined,
  dateRange: { start?: Date; end?: Date; days?: number } | null | undefined,
  vergleichBis: Date | null | undefined,
): { data: ZeitraumStand | null; loading: boolean } {
  const ende = dateRange?.end ?? new Date(Date.now() - 864e5);
  const start =
    dateRange?.start ?? new Date(ende.getTime() - ((dateRange?.days ?? 30) - 1) * 864e5);
  const von = tagLokal(start);
  const bis = tagLokal(ende);
  const vgl = tagLokal(vergleichBis);
  const key =
    clientId && von && bis ? `ezyrank-zeitraum:${clientId}:${von}..${bis}:${vgl ?? "-"}` : null;
  const { data, loading } = useRangeData<ZeitraumStand>(key, async () => {
    const r = await ezyFetch("/api/admin/ezyrank-zeitraum", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, startDate: von, endDate: bis, compareEnd: vgl }),
    });
    const j = await r.json().catch(() => null);
    return j?.ok ? (j as ZeitraumStand) : null;
  });
  return { data, loading };
}
