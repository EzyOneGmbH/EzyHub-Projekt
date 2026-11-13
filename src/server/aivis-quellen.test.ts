// KI-Sichtbarkeit: Gemini-Quellen aus dem Grounding und Stand der KI-Systeme.
import { describe, expect, it } from "vitest";
import {
  engineBefund,
  engineStaende,
  engineTeileMit,
  fehlerKurz,
  groundingRefs,
  hostGehoertZu,
  vereint,
} from "@/server/aivis-quellen.server";

const W = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/";

describe("groundingRefs", () => {
  it("liest Quellen mit Domain aus dem Titel, ohne Doppelte", () => {
    const refs = groundingRefs({
      groundingMetadata: {
        groundingChunks: [
          { web: { uri: `${W}a`, title: "www.Beispiel.ch" } },
          { web: { uri: `${W}b`, title: "beispiel.ch" } },
          { web: { uri: `${W}c`, title: "Ein Seitentitel" } },
          { web: { uri: "kein-link", title: "x.ch" } },
          { retrievedContext: {} },
        ],
      },
    });
    expect(refs).toEqual([
      { uri: `${W}a`, host: "beispiel.ch" },
      { uri: `${W}c`, host: "" },
    ]);
  });
  it("kommt ohne Grounding aus", () => {
    expect(groundingRefs(null)).toEqual([]);
    expect(groundingRefs({ content: {} })).toEqual([]);
  });
});

describe("hostGehoertZu", () => {
  it("erkennt Domain und Subdomain, aber keine fremde Domain", () => {
    expect(hostGehoertZu("beispiel.ch", "www.beispiel.ch")).toBe(true);
    expect(hostGehoertZu("blog.beispiel.ch", "beispiel.ch")).toBe(true);
    expect(hostGehoertZu("keinbeispiel.ch", "beispiel.ch")).toBe(false);
    expect(hostGehoertZu("", "beispiel.ch")).toBe(false);
  });
});

describe("vereint", () => {
  it("führt Listen ohne Doppelte zusammen", () => {
    expect(vereint(["https://a.ch/", "b"], undefined, ["https://a.ch", "", "c"])).toEqual([
      "https://a.ch/",
      "b",
      "c",
    ]);
  });
});

describe("fehlerKurz", () => {
  it("entfernt Adressen, Schlüssel und Tokens", () => {
    const t = fehlerKurz(
      "HTTP 400 https://x.googleapis.com/v1?key=AIzaSyGEHEIM1234 key=AIzaSyGEHEIM1234 " +
        "Bearer abc.def sk-ant-geheim12345 xai-geheim12345",
      400,
    );
    expect(t).not.toMatch(/GEHEIM|geheim|abc\.def|googleapis/);
    expect(t).toContain("HTTP 400");
  });
  it("kürzt lange Texte", () => {
    expect(fehlerKurz("x".repeat(500)).length).toBe(140);
  });
});

describe("engineStaende", () => {
  it("hält gefragt, beantwortet und den Grund fest", () => {
    expect(
      engineStaende([
        { name: "Gemini", gefragt: 10, beantwortet: 10 },
        { name: "Claude", gefragt: 10, beantwortet: 0, fehler: "credit balance is too low" },
        { name: "Perplexity", gefragt: 10, beantwortet: 0 },
        { name: "Grok", gefragt: 0, beantwortet: 0 },
      ]),
    ).toEqual({
      Gemini: { gefragt: 10, beantwortet: 10 },
      Claude: { gefragt: 10, beantwortet: 0, fehler: "credit balance is too low" },
      Perplexity: { gefragt: 10, beantwortet: 0, fehler: "kein Key gesetzt oder leere Antwort" },
    });
  });
});

describe("engineTeileMit", () => {
  it("ergänzt Abschnitte und ersetzt denselben Abschnitt je System", () => {
    const a = engineTeileMit(undefined, 0, { Gemini: { gefragt: 5, beantwortet: 5 } });
    const b = engineTeileMit(a, 5, { Gemini: { gefragt: 5, beantwortet: 4 } });
    const c = engineTeileMit(b, 0, { Claude: { gefragt: 5, beantwortet: 0, fehler: "x" } });
    expect(c).toEqual({
      "0": {
        Gemini: { gefragt: 5, beantwortet: 5 },
        Claude: { gefragt: 5, beantwortet: 0, fehler: "x" },
      },
      "5": { Gemini: { gefragt: 5, beantwortet: 4 } },
    });
  });
});

describe("engineBefund", () => {
  const eng = (claude: number) => ({
    "0": {
      Gemini: { gefragt: 10, beantwortet: 10 },
      Claude: {
        gefragt: 10,
        beantwortet: claude,
        ...(claude ? {} : { fehler: "credit balance is too low" }),
      },
    },
  });
  it("meldet ein stummes System mit Grund, nur die neueste Messung je Kunde zählt", () => {
    const out = engineBefund(
      [
        { client_id: "a", snapshot_date: "2026-11-09", eng: eng(10) },
        { client_id: "a", snapshot_date: "2026-11-12", eng: eng(0) },
        { client_id: "b", snapshot_date: "2026-11-11", eng: eng(0) },
      ],
      14,
    );
    expect(out.status).toBe("fehlerhaft");
    expect(out.detail).toBe(
      "Ohne Antwort: Claude (credit balance is too low). Antworten: Gemini 20/20. Stand 12.11.2026, 2 Kunden",
    );
  });
  it("ist in Ordnung, wenn jedes System antwortet", () => {
    expect(
      engineBefund([{ client_id: "a", snapshot_date: "2026-11-12", eng: eng(7) }], 14),
    ).toEqual({
      status: "vorhanden",
      detail: "Antworten: Gemini 10/10, Claude 7/10. Stand 12.11.2026, 1 Kunde",
    });
  });
  it("ist ohne Messung oder ohne Systemstand nicht prüfbar", () => {
    expect(engineBefund([], 14).status).toBe("nicht_pruefbar");
    expect(
      engineBefund([{ client_id: "a", snapshot_date: "2026-11-12", eng: null }], 14).status,
    ).toBe("nicht_pruefbar");
  });
});
