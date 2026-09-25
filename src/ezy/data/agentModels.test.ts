import { describe, expect, it } from "vitest";
import {
  CODEX_NICHT_ANGEMELDET,
  DEFAULT_AGENT_MODEL,
  FALLBACK_PROVIDERS,
  badgeFuer,
  codexSperre,
  defaultModelFuer,
  labelFuer,
  modelleFuer,
  normalisiereModelle,
  providerVon,
} from "./agentModels";

describe("agentModels — Katalog", () => {
  it("Default ist Claude · Sonnet 5", () => {
    expect(DEFAULT_AGENT_MODEL).toEqual({ provider: "claude", model: "claude-sonnet-5" });
    expect(defaultModelFuer("claude")).toBe("claude-sonnet-5");
    expect(defaultModelFuer("codex")).toBe("standard");
  });

  it("Fallback enthaelt die vereinbarten Modelle je Anbieter", () => {
    expect(modelleFuer("claude").map((m) => m.id)).toEqual([
      "claude-sonnet-5",
      "claude-opus-4-8",
      "claude-haiku-4-5",
      "claude-fable-5-1",
    ]);
    expect(modelleFuer("codex").map((m) => m.id)).toEqual(["standard"]);
    expect(FALLBACK_PROVIDERS.map((p) => p.abrechnung)).toEqual(["Claude-Abo", "ChatGPT-Abo"]);
  });

  it("keine Eszett-Schreibweise in Labels/Hinweisen", () => {
    expect(JSON.stringify(FALLBACK_PROVIDERS)).not.toMatch(/ß/);
  });
});

describe("agentModels — Helfer", () => {
  it("providerVon: explizit > Modell-Id > claude", () => {
    expect(providerVon({ provider: "codex", model: "claude-sonnet-5" })).toBe("codex");
    expect(providerVon({ model: "standard" })).toBe("codex");
    expect(providerVon({ model: "claude-opus-4-8" })).toBe("claude");
    expect(providerVon("gpt-5-codex")).toBe("codex");
    expect(providerVon("")).toBe("claude");
    expect(providerVon(null)).toBe("claude");
    expect(providerVon({ provider: "unsinn", model: "etwas" })).toBe("claude");
  });

  it("alte Ids bestehender Agenten werden korrekt angezeigt", () => {
    expect(labelFuer("claude-sonnet-4-6")).toBe("Sonnet 4.6");
    expect(labelFuer("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
    expect(labelFuer("claude-fable-5")).toBe("Fable 5");
    expect(providerVon("claude-sonnet-4-6")).toBe("claude");
    expect(badgeFuer({ model: "claude-sonnet-4-6" })).toBe("Claude · Sonnet 4.6");
    expect(labelFuer("unbekannt-x")).toBe("unbekannt-x");
  });

  it("badgeFuer: «Claude · Sonnet 5» / «Codex · Standard»", () => {
    expect(badgeFuer({ model: "claude-sonnet-5" })).toBe("Claude · Sonnet 5");
    expect(badgeFuer({ provider: "codex", model: "standard" })).toBe("Codex · Standard");
    expect(badgeFuer({ provider: "codex" })).toBe("Codex · Standard");
    expect(badgeFuer({})).toBe("Claude · Sonnet 5");
  });
});

describe("agentModels — Server-Antwort", () => {
  it("ohne Antwort gilt der Fallback", () => {
    const k = normalisiereModelle(null);
    expect(k.ausFallback).toBe(true);
    expect(k.providers.map((p) => p.id)).toEqual(["claude", "codex"]);
    expect(k.aufgaben).toEqual([]);
    expect(k.codex).toBeNull();
  });

  it("uebernimmt Server-Modelle, Aufgaben und Codex-Status; verwirft Ungueltiges", () => {
    const k = normalisiereModelle({
      providers: [
        {
          id: "claude",
          label: "Claude",
          abrechnung: "Claude-Abo",
          verfuegbar: true,
          modelle: [{ id: "claude-sonnet-5", label: "Sonnet 5", hinweis: "x" }],
        },
        { id: "fremd", modelle: [] },
      ],
      aufgaben: [
        {
          id: "audit",
          label: "SEO-Audit",
          empfehlung: { provider: "codex", model: "standard" },
          begruendung: "Viel Lesen",
        },
        { id: "kaputt", empfehlung: { provider: "x", model: 1 } },
      ],
      codex: { installiert: true, angemeldet: false },
    });
    expect(k.ausFallback).toBe(false);
    expect(k.providers.find((p) => p.id === "claude")!.modelle.map((m) => m.id)).toEqual([
      "claude-sonnet-5",
    ]);
    // Codex fehlt in der Antwort -> aus dem Fallback ergaenzt.
    expect(k.providers.find((p) => p.id === "codex")!.modelle[0].id).toBe("standard");
    expect(k.aufgaben.map((a) => a.id)).toEqual(["audit"]);
    expect(codexSperre(k.codex, k.providers)).toBe(CODEX_NICHT_ANGEMELDET);
  });

  it("codexSperre: nur explizites false sperrt", () => {
    expect(codexSperre(null)).toBeNull();
    expect(codexSperre({ installiert: true, angemeldet: true })).toBeNull();
    expect(codexSperre({})).toBeNull();
    expect(
      codexSperre(null, [FALLBACK_PROVIDERS[0], { ...FALLBACK_PROVIDERS[1], verfuegbar: false }]),
    ).toMatch(/nicht verfügbar/);
  });
});

describe("normalisiereModelle: Objekt-Form des agent-service", () => {
  it("wandelt providers/empfehlungen-Objekte um, leere Codex-Id = standard", () => {
    const r = normalisiereModelle({
      ok: true,
      providers: {
        claude: {
          abrechnung: "Claude-Abo",
          standard: "claude-sonnet-5",
          modelle: [{ id: "claude-sonnet-5", label: "Claude Sonnet 5" }],
        },
        codex: {
          abrechnung: "ChatGPT-Abo",
          standard: "",
          modelle: [
            { id: "", label: "Standard" },
            { id: "gpt-6-luna", label: "GPT-6 Luna" },
          ],
        },
      },
      empfehlungen: {
        audit: { provider: "claude", model: "claude-sonnet-5", begruendung: "Subagenten" },
        recherche_geo: { provider: "codex", model: "", begruendung: "Abo" },
      },
    });
    const codex = r.providers.find((p) => p.id === "codex")!;
    expect(codex.modelle.map((m) => m.id)).toEqual(["standard", "gpt-6-luna"]);
    expect(r.aufgaben.map((a) => a.id)).toEqual(["audit", "recherche_geo"]);
    expect(r.aufgaben[1].empfehlung).toEqual({ provider: "codex", model: "standard" });
    expect(r.aufgaben[0].label).toBe("SEO-Audit & Analyse");
  });
});
