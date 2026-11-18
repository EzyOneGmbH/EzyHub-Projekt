import { describe, it, expect } from "vitest";
import { lesePlan, planDatum } from "./blogPlan";

describe("planDatum", () => {
  it("liest beide Schreibweisen und weist ungültige Tage ab", () => {
    expect(planDatum("2027-01-12")).toBe("2027-01-12");
    expect(planDatum(" 5.1.2027 ")).toBe("2027-01-05");
    expect(planDatum("31.02.2027")).toBeNull();
    expect(planDatum("Januar 2027")).toBeNull();
  });
});

describe("lesePlan", () => {
  it("liest Zeilen mit Strich oder Tabulator, überspringt Kopf und Kommentare", () => {
    const { themen, fehler } = lesePlan(
      [
        "# Themenplan",
        "Datum | Titel | Zielgruppe | Zielfrage | Zitierfähiges Element",
        "01.12.2026 | Seminarhotel in der Region Zug | Firmen | Welches Seminarhotel bei Zug? | Kriterienliste",
        "",
        "2027-01-05\tGeneralversammlung organisieren\tVereine",
      ].join("\n"),
    );
    expect(fehler).toEqual([]);
    expect(themen).toHaveLength(2);
    expect(themen[0]).toMatchObject({
      date: "2026-12-01",
      title: "Seminarhotel in der Region Zug",
      audience: "Firmen",
      target_question: "Welches Seminarhotel bei Zug?",
      citable_element: "Kriterienliste",
      keyword: "",
    });
    expect(themen[1]).toMatchObject({
      date: "2027-01-05",
      audience: "Vereine",
      target_question: "",
    });
  });

  it("meldet fehlerhafte Zeilen mit Nummer", () => {
    const { themen, fehler } = lesePlan("bald | Titel hier\n01.02.2027 | x");
    expect(themen).toHaveLength(0);
    expect(fehler).toEqual(["Zeile 1: Datum fehlt oder ist ungültig", "Zeile 2: Titel fehlt"]);
  });

  it("begrenzt die Anzahl", () => {
    const text = Array.from(
      { length: 25 },
      (_, i) => `2027-01-${String(i + 1).padStart(2, "0")} | Thema ${i + 1}`,
    );
    expect(lesePlan(text.join("\n")).fehler).toEqual(["Höchstens 24 Themen auf einmal"]);
  });
});
