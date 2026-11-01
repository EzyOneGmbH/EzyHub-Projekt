import { describe, expect, it } from "vitest";
import {
  ACTION_RECS,
  REC_PLAYBOOK,
  REC_TEXTE,
  baueAktionen,
  ohneEszett,
  prioritaet,
  recVonTyp,
} from "./contentMassnahmen";
import { jsonAusText, luecken, normalisiereEmpfehlung } from "@/server/content-actions.server";

const zeile = (o: Record<string, unknown>) => ({
  id: "x",
  url: "https://h.ch/a",
  title: "A",
  primary_keyword: "kw",
  clicks_28: 3,
  peak_clicks_28: 9,
  position_28: 14.2,
  impr_28: 800,
  ...o,
});

describe("contentMassnahmen", () => {
  it("Texte wie im Modal", () => {
    expect(REC_TEXTE.push_expand.t).toBe("Striking Distance – ausbauen");
    expect(REC_PLAYBOOK.push_expand.schritte[0]).toMatch(/^Top 5 der SERP/);
    expect(ACTION_RECS).toHaveLength(8);
  });

  it("baut Massnahmen nur für handlungsbedürftige Artikel, nach Priorität", () => {
    const a = baueAktionen([
      zeile({ recommendation: "push_expand" }),
      zeile({ url: "https://h.ch/b", recommendation: "stable_hold" }),
      zeile({ url: "https://h.ch/c", recommendation: "not_indexed", impr_28: 0 }),
    ]);
    expect(a.map((x) => x.action_id)).toEqual([
      "not_indexed|https://h.ch/c",
      "striking_distance|https://h.ch/a",
    ]);
    expect(a[1]).toMatchObject({
      type: "striking_distance",
      label: "Striking Distance – ausbauen",
      clicks_28d: 3,
      clicks_peak: 9,
      position_avg: 14.2,
      impressions_28d: 800,
      done_when: REC_PLAYBOOK.push_expand.exit,
    });
    expect(baueAktionen([])).toEqual([]);
  });

  it("Priorität: Stufen überschneiden sich nicht", () => {
    const ni = prioritaet({ recommendation: "not_indexed", impr_28: 0 });
    const sd = prioritaet({ recommendation: "push_expand", impr_28: 1e9, peak_clicks_28: 1e9 });
    expect(ni).toBe(80);
    expect(sd).toBeLessThan(50);
    expect(prioritaet({ recommendation: "stable_hold" })).toBe(0);
  });

  it("Typ-Namen", () => {
    expect(recVonTyp("striking_distance")).toBe("push_expand");
    expect(recVonTyp("push_expand")).toBe("push_expand");
    expect(recVonTyp("quatsch")).toBeNull();
  });

  it("ß → ss rekursiv", () => {
    expect(ohneEszett({ a: ["Größe"], b: "Maß" })).toEqual({ a: ["Grösse"], b: "Mass" });
  });
});

describe("Empfehlung normalisieren", () => {
  it("liest JSON aus Code-Block und filtert interne Links", () => {
    const j = jsonAusText(
      '```json\n{"summary":"S.","title_variants":["a","b","c"],"meta_description":"M","internal_links":[{"from_url":"https://h.ch/stark/","anchor":"x"},{"from_url":"https://fremd.ch/","anchor":"y"}],"faq":[{"q":"Q","a":"A"}]}\n```',
    );
    const e = normalisiereEmpfehlung(
      j,
      [{ url: "https://h.ch/stark" }],
      [{ position: 1, url: "https://k.ch", title: "K", headings: ["H2: x"] }],
    );
    expect(e.internal_links).toEqual([
      { from_url: "https://h.ch/stark", from_title: "", anchor: "x" },
    ]);
    expect(e.serp_top5).toEqual([{ position: 1, url: "https://k.ch", title: "K" }]);
    expect(luecken(e)).toEqual([]);
    expect(luecken(normalisiereEmpfehlung({}, [], []))).toEqual([
      "summary",
      "title_variants",
      "meta_description",
    ]);
  });
});
