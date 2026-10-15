// @vitest-environment jsdom
// Ads-Manager (15.10.2026): Drill-down Kampagne -> Gruppen -> Anzeigen per
// Klick auf den Namen, Filter aus der Auswahl, Name sortierbar, Gruppe inkl.
// Anzeigen duplizieren.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import EzyAiAdsManager from "@/ezy/EzyAiAdsManager";
import { authedFetch } from "@/lib/authed-fetch";

vi.mock("@/lib/authed-fetch", () => ({ authedFetch: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));
vi.mock("@/ezy/EzyAiAdPreview", () => ({ AdPreviewThumb: () => null }));

const S = { panel: "#fff", line: "#eee", txt: "#111", mut: "#777", app: "#70c" };
const range = {
  days: 30,
  start: new Date("2026-09-15T00:00:00Z"),
  end: new Date("2026-10-14T00:00:00Z"),
  preset: "30d",
  label: "30 Tage",
} as any;

const kamp = (id: string, name: string) => ({
  openai_campaign_id: id,
  name,
  status: "active",
  bidding_type: "clicks",
  objective: "clicks",
  budget_daily_micros: null,
  budget_lifetime_micros: 200e6,
});
const gruppe = (id: string, name: string, campaign_id: string) => ({
  openai_ad_group_id: id,
  name,
  status: "active",
  campaign_id,
  bidding_config: { billing_event_type: "click" },
  context_hints: ["Nutzfahrzeuge kaufen, Sursee"],
});
const anzeige = (id: string, name: string, ad_group_id: string, campaign_id: string) => ({
  openai_ad_id: id,
  name,
  status: "active",
  review_status: "approved",
  ad_group_name: null,
  ad_group_id,
  campaign_id,
  creative: { type: "chat_card", title: name, body: "", target_url: "https://x.ch" },
});
const daten = {
  ok: true,
  connected: true,
  account: { name: "Centralgarage", currency_code: "CHF" },
  campaigns: [kamp("c1", "Zeta Conversions"), kamp("c2", "Alpha Klicks")],
  adGroups: [
    gruppe("g1", "Gruppe Z1", "c1"),
    gruppe("g2", "Gruppe Z2", "c1"),
    gruppe("g3", "Gruppe A1", "c2"),
  ],
  ads: [
    anzeige("a1", "Anzeige Z1", "g1", "c1"),
    anzeige("a2", "Anzeige Z2", "g2", "c1"),
    anzeige("a3", "Anzeige A1", "g3", "c2"),
  ],
  insights: [],
  commands: [],
  audiences: [],
};

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(() => {
  cleanup();
  vi.mocked(authedFetch).mockReset();
});

const posts: any[] = [];
function mockApi() {
  posts.length = 0;
  vi.mocked(authedFetch).mockImplementation(async (_url: any, init?: any) => {
    if (init?.method === "POST") {
      const b = JSON.parse(String(init.body));
      posts.push(b);
      return new Response(
        JSON.stringify({ ok: true, name: b.name, anzeigen: { kopiert: 1, quelle: 1 } }),
      );
    }
    return new Response(JSON.stringify(daten));
  });
}
const tab = (name: RegExp) => screen.getAllByRole("button", { name })[0];
const namenInTabelle = () =>
  Array.from(document.querySelectorAll("tbody tr td:nth-child(3)"))
    .map((td) => (td.textContent || "").replace("⋯", "").trim())
    .filter((t) => /[A-Za-z]/.test(t)); // Summenzeile (Zahlen/leer) auslassen

describe("EzyAiAdsManager — Drill-down", () => {
  it("Klick auf Kampagne zeigt nur deren Gruppen, Klick auf Gruppe nur deren Anzeigen", async () => {
    mockApi();
    render(
      <EzyAiAdsManager clientId="k1" clientName="Centralgarage" range={range} S={S} isOrgAdmin />,
    );
    await waitFor(() => expect(screen.getByText("Zeta Conversions")).toBeTruthy());

    fireEvent.click(screen.getByText("Zeta Conversions"));
    await waitFor(() => expect(screen.getByText("Gruppe Z1")).toBeTruthy());
    expect(screen.getByText("Gruppe Z2")).toBeTruthy();
    expect(screen.queryByText("Gruppe A1")).toBeNull();
    expect(screen.getByText("Kampagne «Zeta Conversions»")).toBeTruthy();

    fireEvent.click(screen.getByText("Gruppe Z2"));
    await waitFor(() => expect(namenInTabelle()).toEqual(["Anzeige Z2"]));
    expect(screen.getByText("Anzeigengruppe «Gruppe Z2»")).toBeTruthy();

    // Zurück zu den Kampagnen: Auswahl bleibt («1 ausgewählt»)
    fireEvent.click(tab(/^Kampagnen/));
    expect(within(tab(/^Kampagnen/)).getByText(/1 ausgewählt/)).toBeTruthy();

    // Filter auf Anzeigengruppen-Ebene entfernen -> alle Gruppen
    fireEvent.click(tab(/^Anzeigengruppen/));
    fireEvent.click(screen.getByTitle("Filter entfernen"));
    await waitFor(() => expect(screen.getByText("Gruppe A1")).toBeTruthy());
  });

  it("Name ist auf- und absteigend sortierbar", async () => {
    mockApi();
    render(
      <EzyAiAdsManager clientId="k1" clientName="Centralgarage" range={range} S={S} isOrgAdmin />,
    );
    await waitFor(() => expect(screen.getByText("Zeta Conversions")).toBeTruthy());
    const kopf = screen.getByTitle(/nach Name sortieren/);
    fireEvent.click(kopf);
    expect(namenInTabelle()).toEqual(["Alpha Klicks", "Zeta Conversions"]);
    fireEvent.click(kopf);
    expect(namenInTabelle()).toEqual(["Zeta Conversions", "Alpha Klicks"]);
  });

  it("Anzeigengruppe bearbeiten ändert die Kontexthinweise (Kommas bleiben ganz)", async () => {
    mockApi();
    render(
      <EzyAiAdsManager clientId="k1" clientName="Centralgarage" range={range} S={S} isOrgAdmin />,
    );
    await waitFor(() => expect(screen.getByText("Zeta Conversions")).toBeTruthy());
    fireEvent.click(screen.getByText("Alpha Klicks"));
    await waitFor(() => expect(screen.getByText("Gruppe A1")).toBeTruthy());
    fireEvent.click(screen.getAllByTitle("Aktionen")[0]);
    fireEvent.click(screen.getByText(/Anzeigengruppe bearbeiten/));
    await waitFor(() =>
      expect(screen.getByPlaceholderText("Hinweis eingeben, Enter")).toBeTruthy(),
    );
    // bestehender Hinweis als Chip
    expect(screen.getAllByText("Nutzfahrzeuge kaufen, Sursee").length).toBeGreaterThan(0);
    const feld = screen.getByPlaceholderText("Hinweis eingeben, Enter");
    fireEvent.change(feld, { target: { value: "Lieferwagen leasen, Luzern" } });
    fireEvent.keyDown(feld, { key: "Enter" });
    expect(screen.getByText("2/50", { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByText("Speichern"));
    await waitFor(() => expect(posts.some((b) => b.action === "adgroup-update")).toBe(true));
    expect(posts.find((b) => b.action === "adgroup-update").contextHints).toEqual([
      "Nutzfahrzeuge kaufen, Sursee",
      "Lieferwagen leasen, Luzern",
    ]);
  });

  it("Anzeigengruppe duplizieren kopiert die Anzeigen mit (adgroup-duplicate)", async () => {
    mockApi();
    render(
      <EzyAiAdsManager clientId="k1" clientName="Centralgarage" range={range} S={S} isOrgAdmin />,
    );
    await waitFor(() => expect(screen.getByText("Zeta Conversions")).toBeTruthy());
    fireEvent.click(screen.getByText("Alpha Klicks"));
    await waitFor(() => expect(screen.getByText("Gruppe A1")).toBeTruthy());
    fireEvent.click(screen.getAllByTitle("Aktionen")[0]);
    fireEvent.click(screen.getByText(/Anzeigengruppe duplizieren/));
    await waitFor(() => expect(posts.some((b) => b.action === "adgroup-duplicate")).toBe(true));
    const b = posts.find((x) => x.action === "adgroup-duplicate");
    expect(b).toMatchObject({ adGroupId: "g3", name: "Gruppe A1 (Kopie)" });
    await waitFor(() => expect(screen.getByText(/1\/1 Anzeigen kopiert/)).toBeTruthy());
  });
});
