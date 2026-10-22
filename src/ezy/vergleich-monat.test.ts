// Vergleich «Vormonat» (22.10.2026): ganzer Kalendermonat → ganzer Vormonat,
// sonst unverändert gleicher Zeitraum im Vormonat.
import { describe, expect, it } from "vitest";
import { computeCompareRange } from "./ui-kit";

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

describe("computeCompareRange prevMonth", () => {
  it("September → ganzer August", () => {
    const c = computeCompareRange(
      { start: new Date(2026, 8, 1), end: new Date(2026, 8, 30) },
      "prevMonth",
    );
    expect([ymd(c.start), ymd(c.end)]).toEqual(["2026-08-01", "2026-08-31"]);
  });
  it("März → ganzer Februar (auch Schaltjahr)", () => {
    const c = computeCompareRange(
      { start: new Date(2028, 2, 1), end: new Date(2028, 2, 31) },
      "prevMonth",
    );
    expect([ymd(c.start), ymd(c.end)]).toEqual(["2028-02-01", "2028-02-29"]);
  });
  it("Teilzeitraum bleibt gleicher Zeitraum im Vormonat", () => {
    const c = computeCompareRange(
      { start: new Date(2026, 8, 10), end: new Date(2026, 8, 20) },
      "prevMonth",
    );
    expect([ymd(c.start), ymd(c.end)]).toEqual(["2026-08-10", "2026-08-20"]);
  });
});
