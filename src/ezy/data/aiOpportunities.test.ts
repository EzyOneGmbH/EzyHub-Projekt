import { describe, expect, it } from "vitest";
import { fnv1a, oppFingerprint, OPP_STATUS } from "./aiOpportunities";
import { resolveRange, previousPeriod, isoDay } from "./rangeStore";

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

  it("traegt die Art als lesbares Praefix", () => {
    expect(oppFingerprint("sh", "issue-42")).toMatch(/^sh:[0-9a-f]{8}$/);
  });

  it("fnv1a liefert 8 Hex-Zeichen, auch bei fuehrenden Nullen", () => {
    expect(fnv1a("")).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1a("abc")).toMatch(/^[0-9a-f]{8}$/);
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
