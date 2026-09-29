// @vitest-environment jsdom
// Performance-Tabelle nur fuer Mitarbeiter (29.09.2026): Kundenportal-Rolle
// viewer sieht in der Agentur-Uebersicht nur die Kacheln — auch wenn im
// localStorage «tabelle» gemerkt ist. Mitarbeiter sehen den Umschalter.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/ezy/shared-ui";

const leereKette: any = new Proxy(() => leereKette, {
  get: (_t, prop) => {
    if (prop === "then") return (resolve: any) => resolve({ data: [], error: null, count: 0 });
    return () => leereKette;
  },
  apply: () => leereKette,
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      getUser: async () => ({ data: { user: { id: "u1" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: () => leereKette,
    rpc: () => leereKette,
  },
}));

let rolle: string | null = "member";
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { id: "u1" },
    role: rolle,
    isOrgAdmin: rolle === "owner" || rolle === "admin",
    loading: false,
  }),
}));
vi.stubGlobal(
  "fetch",
  vi.fn(async () => Response.json({ ok: false, error: "test" })),
);

const KUNDE = { id: "11111111-1111-4111-8111-111111111111", name: "Test AG", domain: "test.ch" };

beforeEach(() => {
  localStorage.setItem("ezy.agency.seoView", "tabelle");
  localStorage.setItem("ezy.agency.adsView", "tabelle");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

async function zeige(scope: string) {
  const m = await import("@/ezy/RankDashboards");
  render(
    <ToastProvider>
      <m.AgencyOverview clients={[KUNDE]} onSelect={() => {}} appScope={scope} />
    </ToastProvider>,
  );
}

describe("Performance-Tabelle: Sichtbarkeit nach Rolle", () => {
  for (const scope of ["seo", "ads"]) {
    it(`${scope}: Kunde (viewer) sieht keinen Umschalter und keine Tabelle`, async () => {
      rolle = "viewer";
      await zeige(scope);
      expect(screen.queryByText("Performance-Tabelle")).toBeNull();
      expect(screen.getByText("Test AG")).toBeTruthy(); // Kachel sichtbar
    });
    it(`${scope}: Rolle noch unbekannt → verborgen (fail-closed)`, async () => {
      rolle = null;
      await zeige(scope);
      expect(screen.queryByText("Performance-Tabelle")).toBeNull();
    });
    it(`${scope}: Mitarbeiter (member) sieht den Umschalter`, async () => {
      rolle = "member";
      await zeige(scope);
      expect(screen.getByText("Performance-Tabelle")).toBeTruthy();
    });
  }
});
