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

  it("EzyPerformance: Übersicht + Kampagnen mit gefülltem Report (B5-ähnlich)", async () => {
    const { default: AdsUebersicht } = await import("@/ezy/ads/AdsUebersicht");
    const { default: AdsKampagnen } = await import("@/ezy/ads/AdsKampagnen");
    const { default: AdsKarte } = await import("@/ezy/ads/AdsKarte");
    const { herkunft } = await import("@/ezy/ads/adsReportModel");
    const snap = {
      totals: {
        cost: 1163.7,
        clicks: 3367,
        impressions: 145354,
        conversions: 24,
        conversionValue: 10242,
      },
      prev: {
        cost: 1238,
        clicks: 7880,
        impressions: 176400,
        conversions: 22,
        conversionValue: 8950,
      },
      series: [
        {
          date: "2026-09-01",
          cost: 40,
          clicks: 110,
          impressions: 4800,
          conversions: 1,
          conversionValue: 400,
        },
        {
          date: "2026-09-02",
          cost: 38,
          clicks: 105,
          impressions: 4700,
          conversions: 0,
          conversionValue: 0,
        },
      ],
      campaigns: [
        {
          name: "Brand [B5 Boutique Hotel] DE-CH",
          status: "ENABLED",
          cost: 213,
          clicks: 333,
          impressions: 903,
          conversions: 15,
          conversionValue: 6072,
          roas: 28.5,
        },
        {
          name: "Display - DE - Remarketing",
          status: "PAUSED",
          cost: 0,
          clicks: 0,
          impressions: 0,
          conversions: 0,
          conversionValue: 0,
          roas: 0,
        },
      ],
      report: {
        conversionActions: [
          {
            name: "Buchungen",
            category: "PURCHASE",
            booking: true,
            count: 24,
            value: 10242,
            prevCount: 22,
            prevValue: 8950,
          },
          {
            name: "Ladenbesuche",
            category: "STORE_VISIT",
            booking: false,
            count: 611.7,
            value: 612,
            prevCount: 259.5,
            prevValue: 260,
          },
        ],
        impressionShare: { top: 76.9, absTop: 19.6, prevTop: 74.8, prevAbsTop: 24.2 },
        geo: {
          countries: [
            {
              id: "2756",
              name: "Switzerland",
              countryCode: "CH",
              clicks: 3000,
              impressions: 1,
              conversions: 24,
              value: 10242,
            },
          ],
          regions: [
            {
              id: "20134",
              name: "Ticino",
              countryCode: "CH",
              clicks: 1382,
              impressions: 1,
              conversions: 11,
              value: 4000,
            },
            {
              id: "20133",
              name: "Canton of Bern",
              countryCode: "CH",
              clicks: 83,
              impressions: 1,
              conversions: 2,
              value: 800,
            },
          ],
          cities: [
            {
              id: "1",
              name: "Lugano",
              countryCode: "CH",
              clicks: 1,
              impressions: 1,
              conversions: 7,
              value: 2900,
            },
          ],
        },
        audience: {
          age: [{ key: "AGE_RANGE_35_44", conversions: 3, clicks: 347 }],
          gender: [],
          device: [{ key: "MOBILE", conversions: 14, clicks: 2000 }],
        },
        searchTerms: [
          {
            term: "b5 boutique hotel lugano",
            impressions: 340,
            clicks: 122,
            cost: 68,
            conversions: 4,
            value: 1758,
            absTop: 65.8,
          },
        ],
        assetGroups: [
          {
            name: "Kunstliebhaber",
            campaign: "PMax [Hotel in Lugano] DE-CH",
            status: "ENABLED",
            impressions: 7022,
            clicks: 163,
            cost: 60,
            conversions: 1,
            value: 249,
          },
        ],
        errors: [],
      },
    };
    const client = { ...KUNDE, name: "B5 Boutique Hotel", brandTerms: [] };
    const u = mount(
      <AdsUebersicht
        snap={snap}
        client={client}
        tageLabel="Letzte 30 Tage"
        vergleichLabel="Vorperiode"
        aktion={null}
      />,
    );
    expect(u.container.textContent).toContain("Was hat Google Ads gebracht?");
    expect(u.container.textContent).toContain("Das Wichtigste auf einen Blick");
    expect(u.container.textContent).toContain("Alle Conversions nach Art");
    expect(u.container.textContent).toContain("b5 boutique hotel lugano");
    expect(u.container.textContent).toContain("Marke");
    const k = mount(<AdsKampagnen snap={snap} />);
    expect(k.container.textContent).toContain("Brand [B5 Boutique Hotel] DE-CH");
    expect(k.container.textContent).toContain("Kunstliebhaber");
    expect(() => mount(<AdsKarte herkunft={herkunft(snap as any)} />)).not.toThrow();
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
