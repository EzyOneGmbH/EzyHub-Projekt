// Zufälliges Passwort für die Benutzerverwaltung.
import { describe, expect, it } from "vitest";
import { neuesPasswort } from "@/server/passwort.server";

describe("neuesPasswort", () => {
  it("hat die gewünschte Länge und alle Zeichenarten", () => {
    for (let i = 0; i < 200; i++) {
      const p = neuesPasswort();
      expect(p).toHaveLength(20);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[2-9]/);
      expect(p).toMatch(/[!#%+\-=?]/);
      expect(p).toMatch(/^[A-HJ-NP-Za-km-z2-9!#%+\-=?]+$/);
    }
  });
  it("hält die Länge zwischen 12 und 64", () => {
    expect(neuesPasswort(4)).toHaveLength(12);
    expect(neuesPasswort(500)).toHaveLength(64);
  });
  it("liefert jedes Mal ein anderes Passwort", () => {
    expect(new Set(Array.from({ length: 50 }, () => neuesPasswort())).size).toBe(50);
  });
});
