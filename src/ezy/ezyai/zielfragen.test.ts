import { describe, it, expect } from "vitest";
import { standAus, zielAuswertung, type ZielDef, type ZielMessung } from "./zielfragen";

const def = (
  id: string,
  prompt: string,
  topic: string,
  language = "de",
  active = true,
): ZielDef => ({
  id,
  prompt,
  topic,
  language,
  active,
});
const mess = (
  prompt: string,
  platform: string,
  status: string | null,
  checked_at = "2026-11-18T08:00:00Z",
): ZielMessung => ({ prompt, platform, status, checked_at });

describe("standAus", () => {
  it("unterscheidet Quelle, Nennung und keine Nennung", () => {
    expect(standAus("Referenziert")).toBe("quelle");
    expect(standAus("Erwähnt")).toBe("genannt");
    expect(standAus(null)).toBe("nicht");
    expect(standAus("Nicht erwähnt")).toBe("nicht");
  });
});

describe("zielAuswertung", () => {
  const defs = [
    def("1", "Welches Seminarhotel bei Zug?", "Seminarhotel Zug"),
    def("2", "Quel hôtel de séminaire près de Zoug ?", "Seminarhotel Zug", "fr"),
    def("3", "Wo führen wir die GV durch?", "Generalversammlung"),
    def("4", "Welches Tagungshotel ist barrierefrei?", "Barrierefrei"),
  ];

  it("zählt ein Thema als genannt, sobald eine Sprache in einem System genannt wird", () => {
    const a = zielAuswertung(defs, [
      mess("Welches Seminarhotel bei Zug?", "Grok", null),
      mess("Quel hôtel de séminaire près de Zoug ?", "Grok", "Erwähnt"),
      mess("Wo führen wir die GV durch?", "Grok", "Referenziert"),
      mess("Wo führen wir die GV durch?", "Gemini", null),
    ]);
    expect(a.total).toBe(3);
    expect(a.gemessen).toBe(2);
    expect(a.genannt).toBe(2);
    expect(a.quelle).toBe(1);
    expect(a.systeme).toEqual(["Gemini", "Grok"]);
    const zug = a.themen.find((t) => t.thema === "Seminarhotel Zug")!;
    expect(zug.zeilen.map((z) => z.sprache)).toEqual(["de", "fr"]);
    expect(zug.zeilen[0].zellen).toEqual({ Gemini: "offen", Grok: "nicht" });
    expect(a.themen.find((t) => t.thema === "Barrierefrei")!.gemessen).toBe(false);
  });

  it("nimmt je Frage und System die jüngste Antwort", () => {
    const a = zielAuswertung(defs, [
      mess("Wo führen wir die GV durch?", "Grok", "Erwähnt", "2026-11-12T08:00:00Z"),
      mess("Wo führen wir die GV durch?", "Grok", null, "2026-11-18T08:00:00Z"),
    ]);
    expect(a.genannt).toBe(0);
    expect(a.stand).toBe("2026-11-18T08:00:00Z");
  });

  it("zählt pausierte Fragen nicht mit", () => {
    const a = zielAuswertung(
      [def("1", "Frage A", "Thema A", "de", false), def("2", "Frage B", "Thema B")],
      [mess("Frage A", "Grok", "Erwähnt"), mess("Frage B", "Grok", null)],
    );
    expect(a.total).toBe(1);
    expect(a.genannt).toBe(0);
    expect(a.themen).toHaveLength(2);
  });

  it("kommt mit leeren Eingaben zurecht", () => {
    const a = zielAuswertung([], []);
    expect(a).toMatchObject({ total: 0, genannt: 0, quelle: 0, stand: null, systeme: [] });
  });
});
