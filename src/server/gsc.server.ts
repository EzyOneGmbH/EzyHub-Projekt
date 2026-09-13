// Gemeinsamer Search-Console-Client (13.09.2026, Volkan): EIN Ort fuer
// searchAnalytics/query, damit alle Aufrufer dieselbe Zeitraum- und Coverage-
// Semantik haben.
//
// Grundsaetze:
//  - Zeitraum ist IMMER exakt und inklusiv (startDate..endDate, YYYY-MM-DD).
//  - GESAMTTOTALE (Klicks/Impressionen/CTR/Position) kommen aus einer eigenen
//    Abfrage OHNE Dimension. Summen ueber Query-Zeilen sind systematisch zu
//    klein: GSC liefert maximal rowLimit Zeilen und blendet anonymisierte
//    Queries («(other)») ganz aus.
//  - QUERY-ZEILEN werden separat (paginiert ueber startRow, bis 25'000 je
//    Seite) fuer Tabellen/Rankings geladen; das Resultat traegt eine
//    Coverage-Kennzeichnung (Zeilenlimit, geliefert, gekuerzt, Anteil der
//    Totale, der durch die Zeilen abgedeckt ist).
import { redactSecrets } from "./google-oauth.server";

export const GSC_API = "https://searchconsole.googleapis.com/webmasters/v3/sites";
/** Maximale Zeilen je einzelnem GSC-Request (API-Grenze). */
export const GSC_PAGE_MAX = 25_000;
/** GSC-Datenpuffer: die letzten ~2 Tage sind unvollstaendig. */
export const GSC_END_LAG_DAYS = 3;

export type GscRow = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type GscTotals = {
  clicks: number;
  impressions: number;
  /** 0..1 */
  ctr: number;
  position: number;
  /** Herkunft der Totale — "aggregate" = eigene Abfrage ohne Dimension. */
  quelle: "aggregate";
};

export type GscCoverage = {
  /** angefragte Obergrenze (ueber alle Seiten) */
  rowLimit: number;
  /** tatsaechlich gelieferte Zeilen */
  rows: number;
  /** true = es gaebe (wahrscheinlich) mehr Zeilen als geliefert */
  truncated: boolean;
  /** Anzahl API-Seiten (startRow-Pagination) */
  pages: number;
  /** Anteil der Gesamt-Klicks/-Impressionen, den die Zeilen abdecken (0..1), null ohne Totale */
  clicksAnteil: number | null;
  impressionsAnteil: number | null;
};

type Basis = {
  site: string;
  accessToken: string;
  startDate: string;
  endDate: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Optionale Filter — NUR Felder der offiziellen Search-Analytics-API. */
  filter?: GscFilter;
};

/**
 * Request-Vertrag = offizielle Search-Analytics-API (searchanalytics.query).
 * Es gibt dort KEIN orderBy: Zeilen kommen nativ nach Klicks absteigend;
 * andere Sortierungen (z. B. Impressionen) werden lokal gemacht
 * (sortiereNach). Unbekannte Felder quittiert Google mit HTTP 400 —
 * deshalb wird der Body ausschliesslich aus dieser Allowlist gebaut.
 */
export const GSC_REQUEST_FELDER = [
  "startDate",
  "endDate",
  "dimensions",
  "type",
  "dimensionFilterGroups",
  "aggregationType",
  "rowLimit",
  "startRow",
  "dataState",
] as const;
export type GscRequestFeld = (typeof GSC_REQUEST_FELDER)[number];

export type GscFilter = {
  type?: "web" | "image" | "video" | "news" | "discover" | "googleNews";
  dimensionFilterGroups?: Array<{
    groupType?: "and";
    filters: Array<{
      dimension: "country" | "device" | "page" | "query" | "searchAppearance";
      operator?:
        | "equals"
        | "notEquals"
        | "contains"
        | "notContains"
        | "includingRegex"
        | "excludingRegex";
      expression: string;
    }>;
  }>;
  aggregationType?: "auto" | "byPage" | "byProperty" | "byNewsShowcasePanel";
  dataState?: "final" | "all";
};

export type GscRequest = {
  startDate: string;
  endDate: string;
  dimensions: string[];
  rowLimit: number;
  startRow?: number;
} & GscFilter;

/** Baut den Request-Body strikt aus der Allowlist (pure, vitest-gedeckt). */
export function baueGscRequest(b: Basis, teil: Record<string, unknown>): GscRequest {
  const roh: Record<string, unknown> = {
    startDate: b.startDate,
    endDate: b.endDate,
    ...(b.filter ?? {}),
    ...teil,
  };
  const out: Record<string, unknown> = {};
  for (const k of GSC_REQUEST_FELDER) if (roh[k] !== undefined) out[k] = roh[k];
  return out as GscRequest;
}

/** Lokale Sortierung (absteigend) — Ersatz fuer das nicht existierende orderBy. */
export function sortiereNach<T extends { clicks?: number; impressions?: number }>(
  rows: T[],
  feld: "clicks" | "impressions",
): T[] {
  return [...rows].sort((a, b) => (Number(b[feld]) || 0) - (Number(a[feld]) || 0));
}

export class GscFehler extends Error {
  constructor(
    message: string,
    public status: number,
    public body: string,
  ) {
    super(message);
  }
}

async function gscCall(b: Basis, teil: Record<string, unknown>): Promise<{ rows?: GscRow[] }> {
  const f = b.fetchImpl ?? globalThis.fetch;
  const res = await f(`${GSC_API}/${encodeURIComponent(b.site)}/searchAnalytics/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${b.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(baueGscRequest(b, teil)),
    signal: AbortSignal.timeout(b.timeoutMs ?? 30_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new GscFehler(redactSecrets(`GSC HTTP ${res.status}: ${t}`), res.status, t);
  }
  return (await res.json().catch(() => ({}))) as { rows?: GscRow[] };
}

/** Gesamttotale des Zeitraums — eigene Abfrage OHNE Dimension (eine Zeile). */
export async function gscTotals(b: Basis): Promise<GscTotals> {
  const j = await gscCall(b, { dimensions: [], rowLimit: 1 });
  const r = j.rows?.[0];
  return {
    clicks: Number(r?.clicks ?? 0),
    impressions: Number(r?.impressions ?? 0),
    ctr: Number(r?.ctr ?? 0),
    position: Number(r?.position ?? 0),
    quelle: "aggregate",
  };
}

/**
 * Zeilen mit Dimensionen, paginiert ueber startRow. rowLimit = Obergrenze
 * ueber alle Seiten (Default 25'000); pageSize wird auf die API-Grenze gekappt.
 * truncated = letzte Seite war voll (es kann weitere Zeilen geben).
 * Sortierung: nativ nach Klicks absteigend (API-Vertrag); fuer Impressionen
 * o. ae. die gelieferten Zeilen lokal mit sortiereNach ordnen.
 */
export async function gscRows(
  b: Basis & {
    dimensions: string[];
    rowLimit?: number;
    pageSize?: number;
    totals?: Pick<GscTotals, "clicks" | "impressions"> | null;
  },
): Promise<{ rows: GscRow[]; coverage: GscCoverage }> {
  const limit = Math.max(1, Math.floor(b.rowLimit ?? GSC_PAGE_MAX));
  const pageSize = Math.min(GSC_PAGE_MAX, Math.max(1, Math.floor(b.pageSize ?? GSC_PAGE_MAX)));
  const rows: GscRow[] = [];
  let pages = 0;
  let letzteSeiteVoll = false;
  while (rows.length < limit) {
    const n = Math.min(pageSize, limit - rows.length);
    const j = await gscCall(b, {
      dimensions: b.dimensions,
      rowLimit: n,
      startRow: rows.length,
    });
    pages++;
    const seite = j.rows ?? [];
    rows.push(...seite);
    letzteSeiteVoll = seite.length >= n;
    if (seite.length < n) break;
  }
  const t = b.totals ?? null;
  const sum = (k: "clicks" | "impressions") => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const anteil = (k: "clicks" | "impressions") =>
    t && t[k] > 0 ? Math.min(1, Math.round((sum(k) / t[k]) * 1000) / 1000) : null;
  return {
    rows,
    coverage: {
      rowLimit: limit,
      rows: rows.length,
      truncated: letzteSeiteVoll && rows.length >= limit,
      pages,
      clicksAnteil: anteil("clicks"),
      impressionsAnteil: anteil("impressions"),
    },
  };
}

/** Totale aus Zeilen (nur fuer Teilmengen wie Brand/Non-Brand, NIE als Gesamttotale). */
export function summiereZeilen(rows: Array<Pick<GscRow, "clicks" | "impressions" | "position">>) {
  const t = rows.reduce(
    (a, r) => {
      a.clicks += Number(r.clicks) || 0;
      a.impressions += Number(r.impressions) || 0;
      a.posSum += (Number(r.position) || 0) * (Number(r.impressions) || 0);
      return a;
    },
    { clicks: 0, impressions: 0, posSum: 0 },
  );
  return {
    clicks: t.clicks,
    impressions: t.impressions,
    ctr: t.impressions > 0 ? t.clicks / t.impressions : 0,
    position: t.impressions > 0 ? t.posSum / t.impressions : 0,
  };
}
