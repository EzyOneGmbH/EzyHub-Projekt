import { describe, expect, it } from "vitest";
import {
  makeBerichtToken,
  verifyBerichtToken,
  verifyReportToken,
  makeReportToken,
} from "./report-token.server";

const S = "geheim";
describe("Bericht-Token v3", () => {
  it("rundet hin und zurueck", () => {
    const t = makeBerichtToken("b1", "c1", "o1", 30, S, 1000);
    expect(verifyBerichtToken(t, S, 2000)).toEqual({
      berichtId: "b1",
      clientId: "c1",
      organizationId: "o1",
      exp: 1000 + 30 * 864e5,
    });
  });
  it("lehnt Manipulation, Ablauf, falsches Secret und v2 ab", () => {
    const t = makeBerichtToken("b1", "c1", "o1", 1, S, 1000);
    expect(verifyBerichtToken(t, "anders", 2000)).toBeNull();
    expect(verifyBerichtToken(t, S, 1000 + 2 * 864e5)).toBeNull();
    expect(verifyBerichtToken(t.slice(0, -2) + "xx", S, 2000)).toBeNull();
    expect(verifyBerichtToken(makeReportToken("c1", "o1", 1, S, 1000), S, 2000)).toBeNull();
    expect(verifyReportToken(t, S, 2000)).toBeNull(); // v3 nie als aivis-Token gueltig
  });
});
