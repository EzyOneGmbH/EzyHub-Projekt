import { describe, expect, it } from "vitest";
import { darfGoogleListen } from "./google-list-access.server";

describe("darfGoogleListen", () => {
  it("Agentur-Rollen dürfen, Kunden-Logins und Fremde nicht", () => {
    expect(darfGoogleListen("owner")).toBe(true);
    expect(darfGoogleListen("admin")).toBe(true);
    expect(darfGoogleListen("member")).toBe(true);
    expect(darfGoogleListen("viewer")).toBe(false);
    expect(darfGoogleListen(null)).toBe(false);
    expect(darfGoogleListen(undefined)).toBe(false);
  });
});
