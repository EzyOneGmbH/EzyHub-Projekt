// @vitest-environment jsdom
// EzyRank-Performance-Tabelle (29.09.2026): echte Komponente, nur ezyFetch und
// Supabase-Session gemockt.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { SeoAgencyTable } from "@/ezy/SeoAgencyTable";
import { ezyFetch } from "@/ezy/data/api";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "test-token" } } }),
      getUser: async () => ({ data: { user: { id: "u-test" } } }),
    },
  },
}));
vi.mock("@/ezy/data/api", () => ({ ezyFetch: vi.fn() }));

const A = "10000000-0000-4000-8000-00000000000a";
const B = "10000000-0000-4000-8000-00000000000b";
const clients = [
  { id: A, name: "Hotel Alpha", domain: "alpha.ch" },
  { id: B, name: "Beta AG", domain: "beta.ch" },
];
const stand = (rank: string | null, vis: string | null) => ({
  cur: { rank, visibility: vis },
  prev: { rank: null, visibility: null },
});
const antwort = {
  ok: true,
  range: { from: "2026-09-01", to: "2026-09-28" },
  prevRange: { from: "2026-08-04", to: "2026-08-31" },
  rows: [
    {
      clientId: A,
      cur: { traffic: 1200, trafficCh: 900, top3: 12, top10: 40, visibility: 0.0395 },
      prev: { traffic: 1000, trafficCh: 800, top3: 10, top10: 44, visibility: 0.035 },
      trafficQuelle: "ga4",
      rankVergleich: "ok",
      stand: stand("2026-09-28", "2026-09-27"),
      hinweise: [],
      error: null,
    },
    {
      clientId: B,
      cur: { traffic: 300, trafficCh: 150, top3: 2, top10: 9, visibility: null },
      prev: { traffic: 300, trafficCh: 150, top3: 2, top10: 9, visibility: null },
      trafficQuelle: "gsc",
      rankVergleich: "ok",
      stand: stand("2026-09-28", null),
      hinweise: ["Kein Sistrix-Wert bis Zeitraum-Ende"],
      error: null,
    },
  ],
};
const resp = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

afterEach(() => {
  cleanup();
  vi.mocked(ezyFetch).mockReset();
});

describe("SeoAgencyTable", () => {
  it("zeigt Kennzahlen, GSC-Markierung und Summen", async () => {
    vi.mocked(ezyFetch).mockResolvedValue(resp(antwort));
    render(
      <SeoAgencyTable
        clients={clients}
        dateRange={{ start: new Date(2026, 8, 1), end: new Date(2026, 8, 28) }}
      />,
    );
    await waitFor(() => expect(screen.getByText("Hotel Alpha")).toBeTruthy());
    // Request: Zeitraum aus der Kopfzeile, ohne Vergleich keine compare-Felder
    const body = JSON.parse(String(vi.mocked(ezyFetch).mock.calls[0][1]?.body));
    expect(vi.mocked(ezyFetch).mock.calls[0][0]).toBe("/api/google/seo-overview");
    expect(body).toMatchObject({ startDate: "2026-09-01", endDate: "2026-09-28" });
    expect(body.compareStart).toBeUndefined();

    // Tausender-Trennzeichen je nach ICU-Version der Node-Laufzeit ' oder ’
    const zeileA = screen.getByText("Hotel Alpha").closest("tr")!;
    expect(within(zeileA).getByText(/^1['’]200$/)).toBeTruthy();
    expect(within(zeileA).getByText("75,0 %")).toBeTruthy(); // CH-Anteil 900/1200
    expect(within(zeileA).getByText("0,0395")).toBeTruthy();
    const zeileB = screen.getByText("Beta AG").closest("tr")!;
    expect(within(zeileB).getByText("GSC")).toBeTruthy();

    const fuss = screen.getByText(/Gesamt · 2 Kunden/).closest("tr")!;
    expect(within(fuss).getByText(/^1['’]500$/)).toBeTruthy(); // Traffic-Summe
    expect(within(fuss).getByText("49")).toBeTruthy(); // Top-10-Summe
  });

  it("mit Vergleich: Top 10 als absolute Veränderung, Traffic in Prozent", async () => {
    vi.mocked(ezyFetch).mockResolvedValue(resp(antwort));
    render(
      <SeoAgencyTable
        clients={clients}
        dateRange={{
          start: new Date(2026, 8, 1),
          end: new Date(2026, 8, 28),
          compare: { start: new Date(2026, 7, 4), end: new Date(2026, 7, 31) },
          compareMode: "prevPeriod",
        }}
      />,
    );
    await waitFor(() => expect(screen.getByText("Hotel Alpha")).toBeTruthy());
    const body = JSON.parse(String(vi.mocked(ezyFetch).mock.calls[0][1]?.body));
    expect(body).toMatchObject({ compareStart: "2026-08-04", compareEnd: "2026-08-31" });
    const zeileA = screen.getByText("Hotel Alpha").closest("tr")!;
    expect(within(zeileA).getByText(/−?-4$|↘ -4/)).toBeTruthy(); // Top 10: 40 vs 44
    expect(within(zeileA).getByText(/\+20,0 %/)).toBeTruthy(); // Traffic 1200 vs 1000
  });

  it("Methodenwechsel: kein Top-3/10-Delta, Hinweis statt Schein-Verlust, auch nicht in der Summe", async () => {
    const mw = {
      ...antwort,
      rows: antwort.rows.map((r, i) =>
        i === 0
          ? {
              ...r,
              prev: { ...r.prev, top3: null, top10: null },
              rankVergleich: "methodenwechsel",
            }
          : r,
      ),
    };
    vi.mocked(ezyFetch).mockResolvedValue(resp(mw));
    render(
      <SeoAgencyTable
        clients={clients}
        dateRange={{
          start: new Date(2026, 8, 1),
          end: new Date(2026, 8, 28),
          compare: { start: new Date(2026, 7, 4), end: new Date(2026, 7, 31) },
          compareMode: "prevPeriod",
        }}
      />,
    );
    await waitFor(() => expect(screen.getByText("Hotel Alpha")).toBeTruthy());
    const zeileA = screen.getByText("Hotel Alpha").closest("tr")!;
    expect(within(zeileA).getAllByText("Methode geändert")).toHaveLength(2);
    expect(within(zeileA).queryByText(/↘ -4/)).toBeNull();
    expect(within(zeileA).getByText(/\+20,0 %/)).toBeTruthy(); // Traffic-Vergleich bleibt
    const fuss = screen.getByText(/Gesamt · 2 Kunden/).closest("tr")!;
    // Zellen: 0 Name, 1 Traffic, 2 CH, 3 Anteil, 4 Top 3, 5 Top 10, 6 Visibility
    const zellen = fuss.querySelectorAll("td");
    expect(zellen[5].textContent).toBe("49—"); // Summe Top 10, KEIN Delta
    expect(zellen[4].textContent).toBe("14—"); // Summe Top 3, KEIN Delta
    expect(screen.getByText(/Methode geändert» = Vergleichslauf anders gezählt/)).toBeTruthy();
  });

  it("Sistrix-Land FR: Marke «FR» am Visibility Index, CH ohne Marke", async () => {
    const fr = {
      ...antwort,
      rows: [
        { ...antwort.rows[0], visibilityLand: "fr" },
        { ...antwort.rows[1], visibilityLand: "ch" },
      ],
    };
    vi.mocked(ezyFetch).mockResolvedValue(resp(fr));
    render(
      <SeoAgencyTable
        clients={clients}
        dateRange={{ start: new Date(2026, 8, 1), end: new Date(2026, 8, 28) }}
      />,
    );
    await waitFor(() => expect(screen.getByText("Hotel Alpha")).toBeTruthy());
    const zeileA = screen.getByText("Hotel Alpha").closest("tr")!;
    expect(within(zeileA).getByText("FR")).toBeTruthy();
    const zeileB = screen.getByText("Beta AG").closest("tr")!;
    expect(within(zeileB).queryByText("CH")).toBeNull();
  });

  it("zeigt Fehler verständlich statt leerer Tabelle", async () => {
    vi.mocked(ezyFetch).mockResolvedValue(resp({ ok: false, error: "GA4 down" }));
    render(
      <SeoAgencyTable
        clients={clients}
        dateRange={{ start: new Date(2026, 8, 1), end: new Date(2026, 8, 28) }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/SEO-Daten konnten nicht geladen werden: GA4 down/)).toBeTruthy(),
    );
  });
});
