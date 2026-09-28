import { describe, expect, it } from "vitest";
import { loeschFehlerText } from "./kundeLoeschen";

describe("loeschFehlerText", () => {
  it("erklaert das geschuetzte Ads-Protokoll (RESTRICT)", () => {
    const t = loeschFehlerText({
      code: "23503",
      message:
        'update or delete on table "clients" violates foreign key constraint "ads_changelog_client_id_fkey" on table "ads_changelog"',
    });
    expect(t).toMatch(/Google-Ads-Änderungsprotokoll/);
    expect(t).toMatch(/Deaktivieren/);
  });
  it("sagt bei der Not-Null-Verletzung klar, dass der Kunde noch da ist", () => {
    const t = loeschFehlerText({
      code: "23502",
      message:
        'null value in column "client_id" of relation "content_items" violates not-null constraint',
    });
    expect(t).toMatch(/unverändert vorhanden/);
  });
  it("faellt sonst auf die Originalmeldung zurueck", () => {
    expect(loeschFehlerText({ message: "Netzwerkfehler" })).toBe("Netzwerkfehler");
    expect(loeschFehlerText(null)).toBe("Löschen fehlgeschlagen");
  });
});
