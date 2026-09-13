import { describe, it, expect } from "vitest";
import { SlidingWindowLimiter } from "./rate-limit.server";

describe("SlidingWindowLimiter", () => {
  it("laesst limit Treffer im Fenster zu und bremst den naechsten", () => {
    const l = new SlidingWindowLimiter(3, 1000);
    const t0 = 1_000_000;
    expect(l.hit("k", t0).ok).toBe(true);
    expect(l.hit("k", t0 + 10).ok).toBe(true);
    expect(l.hit("k", t0 + 20).ok).toBe(true);
    const vierter = l.hit("k", t0 + 30);
    expect(vierter.ok).toBe(false);
    expect(vierter.retryAfterMs).toBeGreaterThan(0);
    expect(vierter.retryAfterMs).toBeLessThanOrEqual(1000);
  });

  it("gibt Treffer frei, sobald sie aus dem Fenster gleiten", () => {
    const l = new SlidingWindowLimiter(2, 1000);
    const t0 = 5_000;
    l.hit("k", t0);
    l.hit("k", t0 + 100);
    expect(l.hit("k", t0 + 500).ok).toBe(false);
    // erster Treffer (t0) ist bei t0+1001 draussen -> wieder Platz
    expect(l.hit("k", t0 + 1001).ok).toBe(true);
  });

  it("trennt Schluessel voneinander", () => {
    const l = new SlidingWindowLimiter(1, 1000);
    expect(l.hit("a", 1).ok).toBe(true);
    expect(l.hit("b", 1).ok).toBe(true);
    expect(l.hit("a", 2).ok).toBe(false);
  });

  it("deckelt die Anzahl Schluessel (aelteste fliegen raus)", () => {
    const l = new SlidingWindowLimiter(1, 1000, 2);
    l.hit("a", 1);
    l.hit("b", 1);
    l.hit("c", 1); // verdraengt "a"
    expect(l.hit("a", 2).ok).toBe(true); // "a" ist wieder frisch
  });
});
