// Gemeinsamer GA4-Helfer (21.09.2026, Volkan): EIN Ort fuer die Auswertung der
// runReport-Antwort-Metadaten der GA4 Data API (v1beta) und fuer die
// Property-Liste der Admin API — damit alle GA4-Routen dieselbe
// Coverage-Kennzeichnung liefern (analog gscRows().coverage in gsc.server.ts).
//
// Quellen (Stand 21.09.2026):
//  - ResponseMetaData.dataTruncationReasons (neu 14.09.2026):
//    https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/ResponseMetaData#FIELDS.data_truncation_reasons
//    Jeder Eintrag traegt dataTruncationType (z. B. DATA_TRUNCATION_TYPE_DATE_RANGE,
//    _PROPERTY, _CONVERSIONS, _GOOGLE_ADS, _DATA_DRIVEN_ATTRIBUTION, ...),
//    optional dataTruncationMessage, dataTruncationDate, dataTruncationDateRanges.
//  - dataLossFromOtherRow: Zeilen wurden in «(other)» zusammengefasst.
//  - samplingMetadatas: nur befuellt, wenn der Report gesampelt wurde.
//  - PropertySummary.can_edit (Admin API, neu 18.06.2026):
//    https://developers.google.com/analytics/devguides/config/admin/v1/changelog

export const GA4_DATA_API = "https://analyticsdata.googleapis.com/v1beta";
export const GA4_ADMIN_API = "https://analyticsadmin.googleapis.com/v1beta";

/** runReport-Endpunkt einer Property (ID mit oder ohne "properties/"). */
export function ga4RunReportUrl(property: string): string {
  const id = String(property).replace(/^properties\//, "");
  return `${GA4_DATA_API}/properties/${encodeURIComponent(id)}:runReport`;
}

export type Ga4Coverage = {
  /** true = Google hat Daten abgeschnitten (mind. ein dataTruncationReason) */
  truncated: boolean;
  /** Kuerzungsgruende: "<dataTruncationType>[: <Meldung>][ (von..bis)]" */
  gruende: string[];
  /** true = Report basiert auf einer Stichprobe (samplingMetadatas) */
  sampling: boolean;
  /** true = Zeilen wurden in «(other)» zusammengefasst */
  dataLossFromOtherRow: boolean;
  /** Waehrung/Zeitzone der Property laut Antwort (null, wenn nicht geliefert) */
  currencyCode: string | null;
  timeZone: string | null;
};

type ResponseMetaData = {
  dataLossFromOtherRow?: boolean;
  samplingMetadatas?: Array<{
    samplesReadCount?: string | number;
    samplingSpaceSize?: string | number;
  }>;
  dataTruncationReasons?: Array<{
    dataTruncationType?: string;
    dataTruncationMessage?: string;
    dataTruncationDate?: string;
    dataTruncationDateRanges?: Array<{ startDate?: string; endDate?: string }>;
  }>;
  currencyCode?: string;
  timeZone?: string;
};

/** Liest responseMetaData einer runReport-Antwort in ein Coverage-Objekt (pure). */
export function ga4Coverage(antwort: unknown): Ga4Coverage {
  const md = ((antwort as { responseMetaData?: ResponseMetaData } | null)?.responseMetaData ??
    {}) as ResponseMetaData;
  const reasons = Array.isArray(md.dataTruncationReasons) ? md.dataTruncationReasons : [];
  const gruende = reasons.map((r) => {
    const typ = String(r?.dataTruncationType || "DATA_TRUNCATION_TYPE_UNSPECIFIED");
    const msg = String(r?.dataTruncationMessage || "").trim();
    const bereiche = (r?.dataTruncationDateRanges ?? [])
      .map((d) => `${d?.startDate ?? "?"}..${d?.endDate ?? "?"}`)
      .join(", ");
    const datum = r?.dataTruncationDate ? String(r.dataTruncationDate) : "";
    let s = typ;
    if (msg) s += `: ${msg}`;
    if (bereiche) s += ` (${bereiche})`;
    else if (datum) s += ` (${datum})`;
    return s;
  });
  const samples = Array.isArray(md.samplingMetadatas) ? md.samplingMetadatas : [];
  // Laut Doku ist samplingMetadatas nur bei gesampelten Reports befuellt; zur
  // Sicherheit zaehlt ein Eintrag nur, wenn nicht nachweislich alles gelesen wurde.
  const sampling = samples.some((s) => {
    const read = Number(s?.samplesReadCount);
    const space = Number(s?.samplingSpaceSize);
    if (Number.isFinite(read) && Number.isFinite(space) && space > 0) return read < space;
    return true;
  });
  return {
    truncated: gruende.length > 0,
    gruende,
    sampling,
    dataLossFromOtherRow: md.dataLossFromOtherRow === true,
    currencyCode: md.currencyCode ? String(md.currencyCode) : null,
    timeZone: md.timeZone ? String(md.timeZone) : null,
  };
}

/** Vereinigt die Coverage mehrerer Reports einer Route (Kuerzung irgendwo = gekuerzt). */
export function mergeGa4Coverage(liste: Ga4Coverage[]): Ga4Coverage {
  const gruende = [...new Set(liste.flatMap((c) => c.gruende))];
  return {
    truncated: liste.some((c) => c.truncated),
    gruende,
    sampling: liste.some((c) => c.sampling),
    dataLossFromOtherRow: liste.some((c) => c.dataLossFromOtherRow),
    currencyCode: liste.find((c) => c.currencyCode)?.currencyCode ?? null,
    timeZone: liste.find((c) => c.timeZone)?.timeZone ?? null,
  };
}

/**
 * Sammler fuer Routen mit mehreren runReport-Aufrufen:
 *   const cov = ga4CoverageSammler();
 *   const json = cov.erfasse(await r.json());   // gibt die Antwort unveraendert zurueck
 *   ... coverage: cov.coverage()
 */
export function ga4CoverageSammler() {
  const liste: Ga4Coverage[] = [];
  return {
    erfasse<T>(antwort: T): T {
      liste.push(ga4Coverage(antwort));
      return antwort;
    },
    coverage(): Ga4Coverage {
      return mergeGa4Coverage(liste);
    },
    anzahl(): number {
      return liste.length;
    },
  };
}

// ── Admin API: accountSummaries → Property-Liste inkl. canEdit ─────────────
export type Ga4PropertySummary = {
  id: string;
  displayName: string;
  account: string;
  /** Admin-API PropertySummary.can_edit (REST: canEdit); null = vom Server nicht geliefert */
  canEdit: boolean | null;
};

/** Liest accountSummaries (Admin API v1beta) in eine flache, sortierte Property-Liste (pure). */
export function parseAccountSummaries(json: unknown): Ga4PropertySummary[] {
  const j = (json ?? {}) as {
    accountSummaries?: Array<{
      displayName?: string;
      propertySummaries?: Array<{
        property?: string;
        displayName?: string;
        canEdit?: boolean;
        can_edit?: boolean;
      }>;
    }>;
  };
  const properties = (j.accountSummaries ?? []).flatMap((a) =>
    (a.propertySummaries ?? []).map((p): Ga4PropertySummary => {
      const roh = p.canEdit ?? p.can_edit;
      return {
        id: String(p.property ?? "").replace(/^properties\//, ""),
        displayName: p.displayName ?? "",
        account: a.displayName ?? "",
        canEdit: typeof roh === "boolean" ? roh : null,
      };
    }),
  );
  properties.sort((a, b) => (a.account + a.displayName).localeCompare(b.account + b.displayName));
  return properties;
}
