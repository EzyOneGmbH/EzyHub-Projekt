import { describe, expect, it } from "vitest";
import {
  fnv1a,
  sha256Hex,
  oppFingerprint,
  oppFingerprintLegacy,
  gapKey,
  isResurfaceDue,
  OPP_STATUS,
} from "./aiOpportunities";
import { resolveRange, previousPeriod, isoDay } from "./rangeStore";

// SHA-256 gegen die offiziellen FIPS-180-4-Testvektoren — die Fingerprints
// hängen an dieser Implementierung, sie muss exakt Standard sein.
describe("sha256Hex", () => {
  it("Standard-Testvektoren", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("verarbeitet UTF-8 (Umlaute) korrekt", () => {
    // printf 'zürich' | sha256sum
    expect(sha256Hex("zürich")).toBe(
      "201f10d5d64518d86d2d3a47d28675d1c788762c5345df643dadec71d4e0a91e",
    );
  });

  it("Block-Grenzfälle (55/56/64 Zeichen) laufen sauber", () => {
    for (const n of [55, 56, 63, 64, 65, 120]) {
      expect(sha256Hex("a".repeat(n))).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

// Der Fingerprint ist der Anker des Chancen-Workflows: dieselbe automatisch
// erkannte Chance muss über Reloads und neue Messläufe hinweg denselben
// Fingerprint ergeben, sonst verliert sie ihren Bearbeitungsstatus.
describe("oppFingerprint", () => {
  it("ist deterministisch", () => {
    expect(oppFingerprint("gap", "Konkurrent AG")).toBe(oppFingerprint("gap", "Konkurrent AG"));
  });

  it("ignoriert Whitespace- und Gross-/Kleinschreibungs-Kosmetik", () => {
    expect(oppFingerprint("opp", "  Beste   Treuhand Zürich ")).toBe(
      oppFingerprint("opp", "beste treuhand zürich"),
    );
  });

  it("trennt nach Chancen-Art und Kern", () => {
    expect(oppFingerprint("gap", "x")).not.toBe(oppFingerprint("opp", "x"));
    expect(oppFingerprint("gap", "rival-a")).not.toBe(oppFingerprint("gap", "rival-b"));
  });

  it("traegt die Art als lesbares Praefix (v2 = 24 Hex aus SHA-256)", () => {
    expect(oppFingerprint("sh", "issue-42")).toMatch(/^sh:[0-9a-f]{24}$/);
  });

  it("v2 und Legacy-Format sind verschieden, Legacy bleibt stabil", () => {
    // Bestehende DB-Zeilen tragen das FNV-Format — das Legacy-Mapping haengt
    // daran, dass oppFingerprintLegacy exakt die alten Werte reproduziert.
    expect(oppFingerprintLegacy("gap", "Konkurrent AG")).toMatch(/^gap:[0-9a-f]{8}$/);
    expect(oppFingerprintLegacy("gap", "Konkurrent AG")).not.toBe(
      oppFingerprint("gap", "Konkurrent AG"),
    );
    expect(oppFingerprintLegacy("gap", "  Konkurrent   AG ")).toBe(
      oppFingerprintLegacy("gap", "konkurrent ag"),
    );
  });

  it("fnv1a liefert 8 Hex-Zeichen, auch bei fuehrenden Nullen", () => {
    expect(fnv1a("")).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1a("abc")).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("gapKey", () => {
  it("trennt verschiedene Themen gegen denselben Rivalen", () => {
    const a = oppFingerprint("gap", gapKey("Rival AG", "Thema Preise", "korpus-ch", ["f1"]));
    const b = oppFingerprint("gap", gapKey("Rival AG", "Thema Standorte", "korpus-ch", ["f1"]));
    expect(a).not.toBe(b);
  });

  it("Fragen-Reihenfolge ist egal (Messlauf-Stabilität)", () => {
    expect(gapKey("R", "T", "Q", ["Frage B?", "Frage A?"])).toBe(
      gapKey("R", "T", "Q", ["frage a?", "  Frage   B? "]),
    );
  });

  it("leere/fehlende Fragen kippen den Schlüssel nicht", () => {
    expect(gapKey("R", "T", "Q", ["f1", null, undefined, "  "])).toBe(gapKey("R", "T", "Q", ["f1"]));
  });
});

describe("isResurfaceDue", () => {
  const today = "2026-08-21";
  it("fällig = Datum erreicht und nicht abgeschlossen", () => {
    expect(isResurfaceDue("pausiert", "2026-08-21", today)).toBe(true);
    expect(isResurfaceDue("offen", "2026-08-01", today)).toBe(true);
    expect(isResurfaceDue("in_bearbeitung", "2026-09-01", today)).toBe(false);
  });
  it("erledigt/verworfen oder ohne Datum nie fällig", () => {
    expect(isResurfaceDue("erledigt", "2026-08-01", today)).toBe(false);
    expect(isResurfaceDue("verworfen", "2026-08-01", today)).toBe(false);
    expect(isResurfaceDue("offen", null, today)).toBe(false);
  });
});

describe("OPP_STATUS", () => {
  it("deckt den vollstaendigen Workflow ab", () => {
    expect(OPP_STATUS.map((s) => s.id)).toEqual([
      "offen",
      "in_bearbeitung",
      "pausiert",
      "erledigt",
      "verworfen",
    ]);
  });
});

describe("resolveRange", () => {
  const now = new Date(2026, 7, 18, 12, 0, 0); // 18.08.2026 lokal

  it("Preset: letzte N Tage bis heute", () => {
    const r = resolveRange({ label: "7 Tage", days: 7, preset: "7d" }, now);
    expect(r.days).toBe(7);
    expect(isoDay(r.end)).toBe("2026-08-18");
    expect(isoDay(r.start)).toBe("2026-08-12");
  });

  it("Custom: exakte Daten bleiben erhalten (kein Runden auf 7/30/90)", () => {
    const r = resolveRange(
      {
        label: "01.06. – 14.06.",
        days: 14,
        preset: "custom",
        start: new Date(2026, 5, 1).toISOString(),
        end: new Date(2026, 5, 14).toISOString(),
      },
      now,
    );
    expect(r.preset).toBe("custom");
    expect(r.days).toBe(14);
    expect(isoDay(r.start)).toBe("2026-06-01");
    expect(isoDay(r.end)).toBe("2026-06-14");
  });

  it("kaputter Custom faellt auf 30 Tage zurueck", () => {
    const r = resolveRange({ label: "x", days: NaN as any, preset: "custom" }, now);
    expect(r.days).toBe(30);
    expect(isoDay(r.end)).toBe("2026-08-18");
  });

  it("null (kein Store-Eintrag) = 30 Tage", () => {
    expect(resolveRange(null, now).days).toBe(30);
  });
});

describe("previousPeriod", () => {
  it("liegt direkt vor der aktuellen Periode und ist gleich lang", () => {
    const cur = resolveRange({ label: "7 Tage", days: 7, preset: "7d" }, new Date(2026, 7, 18));
    const prev = previousPeriod(cur);
    expect(isoDay(prev.end)).toBe("2026-08-11");
    expect(isoDay(prev.start)).toBe("2026-08-05");
  });
});
