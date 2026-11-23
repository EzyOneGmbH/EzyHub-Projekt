// Projektstatus «paused» (23.11.2026): Blog sichtbar, Automatik aus.
import { describe, expect, it } from "vitest";
import { automatikAktiv, blogEingerichtet } from "./blogAutopilot";

describe("blogEingerichtet", () => {
  it("aktive und pausierte Projekte gelten als eingerichtet", () => {
    expect(blogEingerichtet("active")).toBe(true);
    expect(blogEingerichtet("paused")).toBe(true);
  });
  it("Einrichtung offen oder kein Projekt: nicht eingerichtet", () => {
    expect(blogEingerichtet("onboarding")).toBe(false);
    expect(blogEingerichtet(undefined)).toBe(false);
    expect(blogEingerichtet(null)).toBe(false);
    expect(blogEingerichtet("")).toBe(false);
  });
});

describe("automatikAktiv", () => {
  it("nur «active» schreibt und prüft von selbst", () => {
    expect(automatikAktiv("active")).toBe(true);
    expect(automatikAktiv("paused")).toBe(false);
    expect(automatikAktiv("onboarding")).toBe(false);
    expect(automatikAktiv(undefined)).toBe(false);
  });
});
