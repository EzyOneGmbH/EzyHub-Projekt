// Tests für den Doppelstart-Guard externer Messungen (2026-08-18).
import { describe, expect, it } from "vitest";
import { isMeasurementRunning, startGuarded } from "./useMeasurement";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("startGuarded (Doppelstart-Guard)", () => {
  it("startet den ersten Lauf und blockt den zweiten, solange er läuft", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fn = async () => {
      calls += 1;
      await gate;
      return "fertig";
    };
    const a = startGuarded("c1|pagespeed", fn);
    const b = startGuarded("c1|pagespeed", fn);
    expect(a.started).toBe(true);
    expect(b.started).toBe(false);
    expect(isMeasurementRunning("c1|pagespeed")).toBe(true);
    // Beide Aufrufer teilen sich dasselbe Promise — kein zweiter POST.
    expect(b.promise).toBe(a.promise);
    release();
    await expect(a.promise).resolves.toBe("fertig");
    expect(calls).toBe(1);
    expect(isMeasurementRunning("c1|pagespeed")).toBe(false);
  });

  it("erlaubt einen neuen Lauf, sobald der vorige beendet ist", async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      return calls;
    };
    await startGuarded("c2|ahrefs", fn).promise;
    await startGuarded("c2|ahrefs", fn).promise;
    expect(calls).toBe(2);
  });

  it("gibt den Key auch nach einem Fehler wieder frei", async () => {
    const fail = async () => {
      throw new Error("HTTP 500");
    };
    const r = startGuarded("c3|pagespeed", fail);
    await expect(r.promise).rejects.toThrow("HTTP 500");
    await tick();
    expect(isMeasurementRunning("c3|pagespeed")).toBe(false);
    const again = startGuarded("c3|pagespeed", async () => "ok");
    expect(again.started).toBe(true);
    await expect(again.promise).resolves.toBe("ok");
  });

  it("trennt Läufe pro Kunde und Messart", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const langsam = async () => gate;
    startGuarded("kundeA|pagespeed", langsam);
    const andererKunde = startGuarded("kundeB|pagespeed", async () => "b");
    const andereArt = startGuarded("kundeA|ahrefs", async () => "c");
    expect(andererKunde.started).toBe(true);
    expect(andereArt.started).toBe(true);
    release();
  });
});
