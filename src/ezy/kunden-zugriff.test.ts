// Kunden-Zugriff (14.09.2026): Kunden-Accounts (Rolle viewer) liegen im eigenen
// Admin-Tab, das Team zeigt nur noch Mitarbeiter/Admins. Die Tests sichern die
// Trennung (Filter) und die Verdrahtung im Admin-Scope (App-Registry).
import { describe, expect, it } from "vitest";
import { nurKundenAccounts, nurTeam, zugewieseneKunden } from "./data/kundenZugriff";
import { APP_SCOPES, currentAppOf } from "./data/appRegistry";

const users = [
  { userId: "u1", role: "owner", email: "chef@agentur.ch", clientIds: [] },
  { userId: "u2", role: "member", email: "ma@agentur.ch", clientIds: ["c1"] },
  { userId: "u3", role: "viewer", email: "kunde@firma.ch", clientIds: ["c1"] },
  { userId: "u4", role: "viewer", email: null, clientIds: [] },
];
const clients = [
  { id: "c1", name: "Faith in Humanity", domain: "faithinhumanity.ch" },
  { id: "c2", name: "Zweiter Kunde", domain: "zwei.ch" },
];

describe("Kunden-Zugriff: Trennung Kunden-Accounts vs. Team", () => {
  it("zeigt nur Kunden-Accounts (viewer)", () => {
    expect(nurKundenAccounts(users).map((u) => u.userId)).toEqual(["u3", "u4"]);
    expect(nurKundenAccounts(undefined)).toEqual([]);
    expect(nurTeam(null)).toEqual([]);
  });

  it("Team-Filter (Gegenstück) lässt keine viewer durch", () => {
    const team = nurTeam(users);
    expect(team.map((u) => u.role)).toEqual(["owner", "member"]);
    expect(team.length + nurKundenAccounts(users).length).toBe(users.length);
  });

  it("löst Kunden-Ids in Namen auf, unbekannte Ids bleiben sichtbar", () => {
    const k = zugewieseneKunden(["c1", "deadbeef-0000"], clients);
    expect(k[0]).toMatchObject({ id: "c1", name: "Faith in Humanity" });
    expect(k[1].name).toBe("Unbekannt (deadbeef)");
    expect(zugewieseneKunden(undefined, clients)).toEqual([]);
  });
});

describe("Kunden-Zugriff: Admin-Scope", () => {
  it("ist als Admin-Seite registriert und wird der Admin-App zugeordnet", () => {
    expect(APP_SCOPES.admin.pages).toContain("kunden-zugriff");
    expect(APP_SCOPES.admin.pages).toContain("team");
    expect(currentAppOf("kunden-zugriff", "")).toBe("admin");
  });

  it("taucht in keiner anderen App auf", () => {
    for (const [id, scope] of Object.entries(APP_SCOPES)) {
      if (id === "admin") continue;
      expect(scope.pages).not.toContain("kunden-zugriff");
    }
  });
});
