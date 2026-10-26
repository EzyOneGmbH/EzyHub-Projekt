// @vitest-environment jsdom
// Insights → «Google KI» (26.10.2026): Anzeige eines Imports + Upload-Ablauf.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import GscKiPanel from "@/ezy/GscKiPanel";
import { authedFetch } from "@/lib/authed-fetch";

vi.mock("@/lib/authed-fetch", () => ({ authedFetch: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));

const S = { panel: "#fff", line: "#eee", txt: "#111", mut: "#777", app: "#70c" };
const range = {
  days: 30,
  start: new Date("2026-09-26T00:00:00Z"),
  end: new Date("2026-10-25T00:00:00Z"),
  preset: "30d",
  label: "30 Tage",
} as any;

afterEach(() => {
  cleanup();
  vi.mocked(authedFetch).mockReset();
});

describe("GscKiPanel", () => {
  it("zeigt den letzten Import: Kennzahl, Veränderung, Seiten-Tabelle", async () => {
    vi.mocked(authedFetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          quelle: "import",
          property: "sc-domain:excent.ch",
          import: {
            tabellen: {
              page: [
                { key: "https://excent.ch/", imp: 120, impPrev: 80 },
                { key: "https://excent.ch/beratung/", imp: 30, impPrev: null },
              ],
            },
            startDate: "2026-08-25",
            endDate: "2026-10-26",
            compareStart: null,
            compareEnd: null,
            totalImp: 150,
            totalImpPrev: 100,
            importiertAm: "2026-10-26T09:00:00Z",
          },
        }),
      ),
    );
    render(<GscKiPanel clientId="k1" S={S} range={range} canUpload={false} />);
    await waitFor(() => expect(screen.getByText("150")).toBeTruthy());
    expect(screen.getByText(/▲ 50 % ggü\. Vorperiode/)).toBeTruthy();
    expect(screen.getByText("excent.ch/")).toBeTruthy();
    expect(screen.getByText("+50 %")).toBeTruthy();
    expect(screen.getByText("25.08.2026 – 26.10.2026")).toBeTruthy();
    expect(screen.getByText("CSV-Import vom 26.10.2026")).toBeTruthy();
    // Kundenlogin: kein Import-Knopf
    expect(screen.queryByText(/importieren/)).toBeNull();
  });

  it("CSV hochladen → Vorschau → Import speichern", async () => {
    const posts: any[] = [];
    vi.mocked(authedFetch).mockImplementation(async (_u: any, init?: any) => {
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ ok: true, id: "i1" }));
      }
      return new Response(JSON.stringify({ ok: true, quelle: null, property: "sc-domain:x.ch" }));
    });
    render(<GscKiPanel clientId="k1" S={S} range={range} canUpload />);
    await waitFor(() => expect(screen.getByText("CSV importieren")).toBeTruthy());
    expect(screen.getByText(/Exportieren» → «CSV herunterladen/)).toBeTruthy();
    const csv = new File(
      ["Top-Seiten,Impressionen\nhttps://x.ch/a,7\nhttps://x.ch/b,3\n"],
      "Seiten.csv",
      { type: "text/csv" },
    );
    if (!("arrayBuffer" in csv))
      (csv as any).arrayBuffer = async () =>
        new TextEncoder().encode("Top-Seiten,Impressionen\nhttps://x.ch/a,7\nhttps://x.ch/b,3\n")
          .buffer;
    fireEvent.change(screen.getByTestId("gsc-ki-datei"), { target: { files: [csv] } });
    await waitFor(() => expect(screen.getByText("Vorschau: Seiten.csv")).toBeTruthy());
    fireEvent.click(screen.getByText("Import speichern"));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({
      client: "k1",
      dateiname: "Seiten.csv",
      import: {
        totalImp: 10,
        tabellen: {
          page: [
            { key: "https://x.ch/a", imp: 7, impPrev: null },
            { key: "https://x.ch/b", imp: 3, impPrev: null },
          ],
        },
      },
    });
  });
});
