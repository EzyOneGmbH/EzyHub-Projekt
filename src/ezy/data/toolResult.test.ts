// Tests für die zentrale Tool-Ergebnis-Normalisierung (2026-08-18).
import { describe, expect, it } from "vitest";
import { normalizeToolResult } from "./toolResult";

describe("normalizeToolResult", () => {
  it("reicht Strings direkt durch", () => {
    expect(normalizeToolResult("# Hallo").text).toBe("# Hallo");
    expect(normalizeToolResult("   ").text).toBeNull();
  });

  it("findet content/markdown/text/output/result/data in Prioritätsreihenfolge", () => {
    expect(normalizeToolResult({ content: "A", text: "B" }).text).toBe("A");
    expect(normalizeToolResult({ markdown: "M" }).text).toBe("M");
    expect(normalizeToolResult({ text: "T" }).text).toBe("T");
    expect(normalizeToolResult({ output: "O" }).text).toBe("O");
    expect(normalizeToolResult({ result: "R" }).text).toBe("R");
    expect(normalizeToolResult({ data: "D" }).text).toBe("D");
  });

  it("löst verschachtelte Provider-Antworten auf", () => {
    expect(normalizeToolResult({ data: { result: { markdown: "tief" } } }).text).toBe("tief");
    expect(normalizeToolResult({ result: { content: "x" } }).text).toBe("x");
  });

  it("versteht OpenAI-artige choices[]", () => {
    expect(
      normalizeToolResult({ choices: [{ message: { content: "vom LLM" } }] }).text,
    ).toBe("vom LLM");
    expect(normalizeToolResult({ choices: [{ text: "legacy" }] }).text).toBe("legacy");
  });

  it("fügt Anthropic-artige content-Blöcke zusammen", () => {
    expect(
      normalizeToolResult({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }).text,
    ).toBe("a\n\nb");
    expect(normalizeToolResult(["zeile1", "zeile2"]).text).toBe("zeile1\n\nzeile2");
  });

  it("behandelt message NICHT als Inhalt (Status-Text der Routen)", () => {
    expect(normalizeToolResult({ message: "Live-Lauf abgeschlossen" }).text).toBeNull();
  });

  it("liefert null für rein strukturierte Ergebnisse und markiert sie", () => {
    const r = normalizeToolResult({ metrics: { lcp: 1.2 }, errors: {} });
    expect(r.text).toBeNull();
    expect(r.hasStructured).toBe(true);
  });

  it("ist robust gegen null/undefined/Zahlen", () => {
    expect(normalizeToolResult(null).text).toBeNull();
    expect(normalizeToolResult(undefined).text).toBeNull();
    expect(normalizeToolResult(42).text).toBeNull();
    expect(normalizeToolResult(null).hasStructured).toBe(false);
  });

  it("bricht bei zyklischen Strukturen nicht ab", () => {
    const a: any = { data: {} };
    a.data.parent = a;
    expect(normalizeToolResult(a).text).toBeNull();
  });

  it("behält raw unverändert", () => {
    const payload = { content: "x", meta: 1 };
    expect(normalizeToolResult(payload).raw).toBe(payload);
  });
});
