// @vitest-environment jsdom
// EzyPerformance-Kacheln (19.11.2026): Mitarbeiter lesen den stündlich
// vorgewärmten Stand der Performance-Tabelle im Zeitraum der Kopfzeile;
// das Kundenportal (viewer) bleibt beim gespeicherten Snapshot.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/ezy/shared-ui";

const KUNDE = { id: "11111111-1111-4111-8111-111111111111", name: "Test AG", domain: "test.ch" };

const leereKette: any = new Proxy(() => leereKette, {
  get: (_t, prop) => {
    if (prop === "then") return (resolve: any) => resolve({ data: [], error: null, count: 0 });
    return () => leereKette;
  },
  apply: () => leereKette,
});

const rpc = vi.fn(async (..._args: unknown[]) => ({
  data: [
    {
      client_id: "11111111-1111-4111-8111-111111111111",
      created_at: "2026-11-19T09:21:46Z",
      felder: { totals: { cost: 50, conversionValue: 100 }, roas: 2 },
    },
  ],
  error: null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      getUser: async () => ({ data: { user: { id: "u1" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: () => leereKette,
    rpc: (...args: unknown[]) => rpc(...args),
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

let overviewOk = true;
const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) =>
  overviewOk
    ? Response.json({
        ok: true,
        rows: [{ clientId: KUNDE.id, cur: { cost: 200, conversionValue: 900 }, error: null }],
      })
    : Response.json({ ok: false, error: "test" }),
);
vi.stubGlobal("fetch", fetchMock);

const overviewAufrufe = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/google/ads-overview"));

beforeEach(() => {
  overviewOk = true;
  fetchMock.mockClear();
  rpc.mockClear();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

async function zeige(dateRange: unknown = null) {
  const m = await import("@/ezy/RankDashboards");
  render(
    <ToastProvider>
      <m.AgencyOverview
        clients={[KUNDE]}
        onSelect={() => {}}
        appScope="ads"
        dateRange={dateRange}
      />
    </ToastProvider>,
  );
}

describe("EzyPerformance-Kacheln: Quelle der Kennzahlen", () => {
  it("Mitarbeiter: Werte aus dem stündlichen Übersichts-Stand, Zeitraum der Kopfzeile", async () => {
    rolle = "member";
    await zeige({
      start: new Date(2026, 10, 12),
      end: new Date(2026, 10, 18),
      compareMode: "previous",
      compare: { start: new Date(2026, 10, 5), end: new Date(2026, 10, 11) },
    });
    await waitFor(() => expect(screen.getByText("4,50×")).toBeTruthy());
    expect(screen.getByText("200")).toBeTruthy();
    expect(screen.getByText("900")).toBeTruthy();
    const aufrufe = overviewAufrufe();
    expect(aufrufe).toHaveLength(1);
    // Ohne Vergleichszeitraum — sonst verfehlt der Abruf den vorgewärmten Cache.
    expect(JSON.parse(String(aufrufe[0][1]?.body))).toEqual({
      clientIds: [KUNDE.id],
      startDate: "2026-11-12",
      endDate: "2026-11-18",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("Mitarbeiter ohne Kopfzeilen-Zeitraum: 30 Tage bis gestern", async () => {
    rolle = "member";
    await zeige();
    await waitFor(() => expect(overviewAufrufe()).toHaveLength(1));
    const body = JSON.parse(String(overviewAufrufe()[0][1]?.body));
    const tage =
      (new Date(body.endDate).getTime() - new Date(body.startDate).getTime()) / 864e5 + 1;
    expect(Math.round(tage)).toBe(30);
  });

  it("Mitarbeiter, Route antwortet nicht: gespeicherter Snapshot hilft aus", async () => {
    rolle = "member";
    overviewOk = false;
    await zeige();
    await waitFor(() => expect(screen.getByText("2,00×")).toBeTruthy());
    expect(screen.getByText("50")).toBeTruthy();
  });

  it("Kundenportal (viewer): Snapshot, kein Aufruf der Übersichts-Route", async () => {
    rolle = "viewer";
    await zeige();
    await waitFor(() => expect(screen.getByText("2,00×")).toBeTruthy());
    expect(overviewAufrufe()).toHaveLength(0);
  });
});
