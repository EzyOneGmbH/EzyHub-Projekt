// @vitest-environment jsdom
// Render-Smoke nach der Modularisierung (21.08.2026): mountet die grossen
// Bereichs-Komponenten mit Minimal-Props in jsdom — Netz und Supabase sind
// gemockt (leere Antworten). Beweist, dass jede Ansicht ohne Laufzeitfehler
// in ihren Lade-/Leerzustand rendert (die Fehlerklasse, die bei
// Verschiebungen entsteht: fehlende Bezeichner/Imports/Kontexte).
import type React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
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
    functions: { invoke: async () => ({ data: null, error: null }) },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => {},
  },
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "test@ezyone.ch" },
    role: "owner",
    isOrgAdmin: true,
    organizationId: "org-1",
    loading: false,
  }),
}));

vi.stubGlobal(
  "fetch",
  vi.fn(async () => Response.json({ ok: false, error: "smoke" })),
);
// jsdom kennt kein ResizeObserver (recharts braucht es).
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
window.matchMedia =
  window.matchMedia ||
  ((q: string) =>
    ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as any);

afterEach(() => cleanup());

const KUNDE = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Smoke AG",
  domain: "smoke.ch",
  status: "active",
  tags: [],
  industry: "Test",
  metadata: {},
  defaults: {},
};
const RANGE = { start: new Date(Date.now() - 30 * 864e5), end: new Date(), label: "30 Tage" };

function mount(el: React.ReactElement) {
  return render(<ToastProvider>{el}</ToastProvider>);
}

describe("Render-Smoke der Bereichs-Module (Minimal-Props, leere Daten)", () => {
  it("RankDashboards: Agentur-Uebersicht + 4 Dashboards", async () => {
    const m = await import("@/ezy/RankDashboards");
    expect(() =>
      mount(<m.AgencyOverview clients={[KUNDE]} onSelect={() => {}} appScope={null} />),
    ).not.toThrow();
    for (const Comp of [m.SeoDashboard, m.GeoDashboard, m.ConvDashboard, m.OverviewDashboard]) {
      expect(() => mount(<Comp selectedClient={KUNDE} dateRange={RANGE} />)).not.toThrow();
    }
  });

  it("EzyPerformance: AdsDashboard", async () => {
    const m = await import("@/ezy/AdsDashboardModule");
    expect(() => mount(<m.AdsDashboard selectedClient={KUNDE} dateRange={RANGE} />)).not.toThrow();
  });

  it("Content: RefreshRadar, ContentPage, ReportsPage", async () => {
    const m = await import("@/ezy/ContentModule");
    expect(() => mount(<m.RefreshRadar selectedClient={KUNDE} />)).not.toThrow();
    expect(() =>
      mount(
        <m.ContentPage
          clients={[KUNDE]}
          items={[]}
          onSaveContent={() => {}}
          selectedClient={KUNDE}
          openEditId={null}
          onOpenEditConsumed={() => {}}
        />,
      ),
    ).not.toThrow();
    expect(() => mount(<m.ReportsPage items={[]} selectedClient={KUNDE} />)).not.toThrow();
  });

  it("Admin: ClientsPage, MatrixPage, ClientReadinessPanel", async () => {
    const m = await import("@/ezy/AdminClients");
    expect(() =>
      mount(
        <m.ClientsPage
          clients={[KUNDE]}
          selectedClientId={KUNDE.id}
          onSelectClient={() => {}}
          onUpsertClient={async () => {}}
          onDeleteClient={() => {}}
          onReload={() => {}}
          customerDefaults={{}}
        />,
      ),
    ).not.toThrow();
    expect(() => mount(<m.MatrixPage clients={[KUNDE]} />)).not.toThrow();
    expect(() =>
      mount(<m.ClientReadinessPanel client={KUNDE} onOpenSettings={() => {}} />),
    ).not.toThrow();
  });

  it("Admin: SettingsPage (inkl. Systemcheck-Sektion erreichbar)", async () => {
    const m = await import("@/ezy/AdminSettings");
    expect(() =>
      mount(
        <m.SettingsPage
          tools={[]}
          onToggleTool={() => {}}
          selectedClient={KUNDE}
          profile={{ name: "Volkan" }}
          onSaveProfile={() => {}}
          customerDefaults={{}}
          onSaveDefaults={() => {}}
          onClientUpdated={() => {}}
          onOpenAgents={null}
        />,
      ),
    ).not.toThrow();
  });

  it("Shell: EzyOneApp-Default-Export rendert (Launcher-Gate)", async () => {
    const m = await import("@/ezy/EzyOneApp.jsx");
    expect(() => render(<m.default appScope={null} />)).not.toThrow();
  });
});
