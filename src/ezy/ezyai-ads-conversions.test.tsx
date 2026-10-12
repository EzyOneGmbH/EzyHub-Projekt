// @vitest-environment jsdom
// Conversions-Bereich im Aufbau des OpenAI Ads Managers (12.10.2026):
// Kennzahlen, Conversion-Ereignisse-Tabelle, Warnungen.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import EzyAiAdsConversions from "@/ezy/EzyAiAdsConversions";
import { authedFetch } from "@/lib/authed-fetch";

vi.mock("@/lib/authed-fetch", () => ({ authedFetch: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));

const S = { panel: "#fff", line: "#eee", txt: "#111", mut: "#777", app: "#70c" };

const setup = {
  ok: true,
  adAccountId: "adacct_1",
  configuredPixelId: "PIX1",
  hasCapiKey: true,
  pixels: [{ id: "cds_1", name: "Morosani Hotels - Conversion", pixel_id: "PIX1" }],
  eventSettings: [
    {
      id: "es1",
      name: "Hotelbuchung – alle Hotels",
      event_type: "order_created",
      custom_event_name: null,
      attribution_window_days: 30,
      view_through_days: 1,
      source_ids: ["cds_1"],
      sources: [{ id: "cds_1", name: "Morosani Hotels - Conversion" }],
      archived: false,
    },
    {
      id: "es2",
      name: "E-Mail-Klick",
      event_type: "custom",
      custom_event_name: "email_click",
      attribution_window_days: 30,
      source_ids: ["cds_1"],
      archived: false,
    },
    {
      id: "es3",
      name: "Alt",
      event_type: "lead_created",
      custom_event_name: null,
      attribution_window_days: 7,
      source_ids: [],
      archived: true,
    },
  ],
  campaigns: [
    {
      id: "c1",
      name: "Business",
      status: "active",
      objective: "clicks",
      eventSettingIds: ["es1", "es2"],
    },
    {
      id: "c2",
      name: "Hotelbuchung",
      status: "active",
      objective: "conversions",
      eventSettingIds: ["es1"],
    },
    { id: "c3", name: "Pausiert", status: "paused", objective: "conversions", eventSettingIds: [] },
  ],
};

afterEach(() => {
  cleanup();
  vi.mocked(authedFetch).mockReset();
});

describe("EzyAiAdsConversions", () => {
  it("zeigt Kennzahlen und Conversion-Ereignisse wie im Ads Manager", async () => {
    vi.mocked(authedFetch).mockResolvedValue(new Response(JSON.stringify(setup)));
    render(
      <EzyAiAdsConversions
        clientId="k1"
        S={S}
        rangeLabel="30 Tage"
        pixelIdHub="PIX1"
        hubEvents={[
          {
            id: "1",
            event_type: "order_created",
            oppref: "x",
            openai_status: "sent",
            created_at: "",
          },
          {
            id: "2",
            event_type: "order_created",
            oppref: null,
            openai_status: "failed",
            created_at: "",
          },
        ]}
      />,
    );
    await waitFor(() => expect(screen.getByText("Hotelbuchung – alle Hotels")).toBeTruthy());
    // Archivierte Events fehlen, Basisereignis = eigener Name bzw. Typ
    expect(screen.queryByText("Alt")).toBeNull();
    expect(screen.getByText("email_click")).toBeTruthy();
    expect(screen.getByText("2 Kampagnen")).toBeTruthy();
    expect(screen.getByText("30 T. Klick · 1 T. Ansicht")).toBeTruthy();
    expect(screen.getByText("2 Conversion-Ereignisse insgesamt")).toBeTruthy();
    // Nutzung: 1 von 2 aktiven Kampagnen auf Conversions (pausierte zaehlt nicht)
    expect(screen.getByText("50 %")).toBeTruthy();
    expect(screen.getByText("1 von 2 aktiven Kampagnen auf Conversions optimiert")).toBeTruthy();
    // Hub-Zaehlung je Standardtyp inkl. Klick-ID-Anteil; Custom = Pixel
    expect(screen.getByText("50 % mit Klick-ID")).toBeTruthy();
    expect(screen.getAllByText("Pixel")).toHaveLength(2); // Spaltenkopf + Custom-Zeile
    // Warnung: 1 nicht zugestelltes Ereignis
    fireEvent.click(screen.getByText("Warnungen anzeigen"));
    expect(screen.getByText("1 Ereignis nicht zugestellt")).toBeTruthy();
    expect(screen.getByText("Im Ads Manager öffnen ↗").getAttribute("href")).toContain(
      "act=adacct_1&tab=conversion-events",
    );
  });
});
