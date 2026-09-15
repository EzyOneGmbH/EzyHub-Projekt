// source_url-Bereinigung fuer die Conversions API (15.09.2026).
// OpenAI verlangt eine HTTP(S)-Adresse aus NUR Ursprung und Pfad
// (developers.openai.com/ads, Verification-Checklist). Vorher liess unser
// Zod-Schema jede formal gueltige URL durch — auch "javascript:" und
// Abfrageparameter mit personenbezogenen Daten, die wir ungefiltert an
// OpenAI weitergereicht haetten.
import { describe, it, expect } from "vitest";
import { AdsEventSchema } from "./ingest-schemas.server";

function bereinigt(url: string): string | null {
  const r = AdsEventSchema.safeParse({ type: "lead_created", source_url: url });
  return r.success ? ((r.data as { source_url?: string }).source_url ?? null) : null;
}

describe("source_url-Bereinigung", () => {
  it("laesst eine saubere Adresse unveraendert", () => {
    expect(bereinigt("https://kunde.ch/danke")).toBe("https://kunde.ch/danke");
  });

  it("verwirft den Abfrageteil samt personenbezogener Daten", () => {
    expect(bereinigt("https://kunde.ch/danke?email=max@test.ch&utm_source=chatgpt")).toBe(
      "https://kunde.ch/danke",
    );
  });

  it("verwirft den Anker", () => {
    expect(bereinigt("https://kunde.ch/danke#bestaetigung")).toBe("https://kunde.ch/danke");
  });

  it("behaelt den Pfad inklusive Unterseiten", () => {
    expect(bereinigt("https://kunde.ch/de/kontakt/danke?x=1")).toBe(
      "https://kunde.ch/de/kontakt/danke",
    );
  });

  it("behaelt einen abweichenden Port im Ursprung", () => {
    expect(bereinigt("http://kunde.ch:8080/danke?a=b")).toBe("http://kunde.ch:8080/danke");
  });

  it.each([
    ["ftp://kunde.ch/x", "fremdes Schema"],
    ["javascript:alert(1)", "Skript-Schema"],
    ["data:text/html,<b>x", "Daten-Schema"],
    ["nonsense", "gar keine URL"],
  ])("weist %s ab (%s)", (url) => {
    expect(bereinigt(url)).toBeNull();
  });

  it("bleibt optional — ein Event ohne source_url ist weiterhin gueltig", () => {
    const r = AdsEventSchema.safeParse({ type: "lead_created" });
    expect(r.success).toBe(true);
  });
});
