import { describe, it, expect } from "vitest";
import {
  ga4Coverage,
  ga4CoverageSammler,
  ga4RunReportUrl,
  mergeGa4Coverage,
  parseAccountSummaries,
} from "./ga4.server";

// GA4-Coverage (21.09.2026): responseMetaData.dataTruncationReasons (neu
// 14.09.2026) + dataLossFromOtherRow + samplingMetadatas → ein Coverage-Objekt
// wie bei GSC, gegen Fake-Antworten ohne/mit Kuerzung.

const ohneKuerzung = {
  rows: [{ metricValues: [{ value: "123" }] }],
  responseMetaData: { currencyCode: "CHF", timeZone: "Europe/Zurich" },
  kind: "analyticsData#runReport",
};

const mitKuerzung = {
  rows: [],
  responseMetaData: {
    dataLossFromOtherRow: true,
    samplingMetadatas: [{ samplesReadCount: "1000", samplingSpaceSize: "5000" }],
    dataTruncationReasons: [
      {
        dataTruncationType: "DATA_TRUNCATION_TYPE_DATE_RANGE",
        dataTruncationMessage: "Daten vor dem Aufbewahrungsfenster wurden entfernt.",
        dataTruncationDateRanges: [{ startDate: "2024-01-01", endDate: "2024-06-30" }],
      },
      { dataTruncationType: "DATA_TRUNCATION_TYPE_GOOGLE_ADS", dataTruncationDate: "2023-09-01" },
    ],
    currencyCode: "CHF",
    timeZone: "Europe/Zurich",
  },
};

describe("ga4Coverage (pure)", () => {
  it("ohne Metadaten-Befund: nicht gekuerzt, kein Sampling, Waehrung/Zeitzone uebernommen", () => {
    expect(ga4Coverage(ohneKuerzung)).toEqual({
      truncated: false,
      gruende: [],
      sampling: false,
      dataLossFromOtherRow: false,
      currencyCode: "CHF",
      timeZone: "Europe/Zurich",
    });
  });

  it("mit dataTruncationReasons: gekuerzt, Gruende lesbar, Sampling und (other)-Verlust erkannt", () => {
    const c = ga4Coverage(mitKuerzung);
    expect(c.truncated).toBe(true);
    expect(c.gruende).toEqual([
      "DATA_TRUNCATION_TYPE_DATE_RANGE: Daten vor dem Aufbewahrungsfenster wurden entfernt. (2024-01-01..2024-06-30)",
      "DATA_TRUNCATION_TYPE_GOOGLE_ADS (2023-09-01)",
    ]);
    expect(c.sampling).toBe(true);
    expect(c.dataLossFromOtherRow).toBe(true);
  });

  it("vollstaendig gelesene samplingMetadatas gelten nicht als Stichprobe", () => {
    const c = ga4Coverage({
      responseMetaData: {
        samplingMetadatas: [{ samplesReadCount: "10", samplingSpaceSize: "10" }],
      },
    });
    expect(c.sampling).toBe(false);
  });

  it("robust gegen fehlende/ungueltige Antworten", () => {
    expect(ga4Coverage(null).truncated).toBe(false);
    expect(ga4Coverage({}).gruende).toEqual([]);
    expect(ga4Coverage({ responseMetaData: { dataTruncationReasons: [{}] } }).gruende).toEqual([
      "DATA_TRUNCATION_TYPE_UNSPECIFIED",
    ]);
  });
});

describe("mergeGa4Coverage / ga4CoverageSammler", () => {
  it("eine gekuerzte Antwort unter mehreren macht die Route gekuerzt; Gruende dedupliziert", () => {
    const cov = ga4CoverageSammler();
    expect(cov.erfasse(ohneKuerzung)).toBe(ohneKuerzung); // Antwort unveraendert durchgereicht
    cov.erfasse(mitKuerzung);
    cov.erfasse(mitKuerzung);
    const c = cov.coverage();
    expect(cov.anzahl()).toBe(3);
    expect(c.truncated).toBe(true);
    expect(c.gruende).toHaveLength(2);
    expect(c.sampling).toBe(true);
    expect(c.dataLossFromOtherRow).toBe(true);
    expect(c.currencyCode).toBe("CHF");
  });

  it("leere Liste ergibt eine saubere Null-Coverage", () => {
    expect(mergeGa4Coverage([])).toEqual({
      truncated: false,
      gruende: [],
      sampling: false,
      dataLossFromOtherRow: false,
      currencyCode: null,
      timeZone: null,
    });
  });
});

describe("ga4RunReportUrl", () => {
  it("akzeptiert ID mit und ohne properties/-Praefix", () => {
    expect(ga4RunReportUrl("properties/123")).toBe(
      "https://analyticsdata.googleapis.com/v1beta/properties/123:runReport",
    );
    expect(ga4RunReportUrl("123")).toBe(ga4RunReportUrl("properties/123"));
  });
});

describe("parseAccountSummaries (Admin API, PropertySummary.canEdit seit 18.06.2026)", () => {
  it("liefert canEdit je Property und null, wenn das Feld fehlt (aeltere Antworten)", () => {
    const out = parseAccountSummaries({
      accountSummaries: [
        {
          displayName: "EzyOne",
          propertySummaries: [
            { property: "properties/2", displayName: "Zwei", canEdit: false },
            { property: "properties/1", displayName: "Eins", canEdit: true },
            { property: "properties/3", displayName: "Drei" },
          ],
        },
      ],
    });
    expect(out.map((p) => [p.id, p.canEdit])).toEqual([
      ["3", null],
      ["1", true],
      ["2", false],
    ]);
    expect(out[1]).toEqual({ id: "1", displayName: "Eins", account: "EzyOne", canEdit: true });
  });

  it("leere/fehlende Listen ergeben []", () => {
    expect(parseAccountSummaries({})).toEqual([]);
    expect(parseAccountSummaries(null)).toEqual([]);
  });
});
