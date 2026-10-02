// @vitest-environment jsdom
// Conversion-Kandidaten aufklappbar (02.10.2026): Inhalt erst nach Klick.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ConversionScoutPanel from "@/ezy/ConversionScoutPanel";
import { ezyFetch } from "@/ezy/data/api";

vi.mock("@/ezy/data/api", () => ({ ezyFetch: vi.fn() }));

const antwort = {
  ok: true,
  lastRun: null,
  candidates: [
    {
      id: "c1",
      candidate_type: "gtm",
      raw_value: "phone_click",
      label: "Click to Call",
      source_url: "GTM GTM-TEST",
      status: "pending",
    },
    {
      id: "c2",
      candidate_type: "gtm",
      raw_value: "mail_click",
      source_url: "GTM GTM-TEST",
      status: "approved",
      ga4_destination_event: "mail_click",
    },
  ],
};
const resp = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

beforeEach(() => {
  localStorage.clear();
  vi.mocked(ezyFetch).mockResolvedValue(resp(antwort));
});
afterEach(() => {
  cleanup();
  vi.mocked(ezyFetch).mockReset();
});

describe("ConversionScoutPanel aufklappbar", () => {
  it("startet eingeklappt mit Zählern, zeigt Inhalt erst nach Klick und merkt sich das", async () => {
    render(<ConversionScoutPanel selectedClient={{ id: "k1" }} />);
    await waitFor(() => expect(screen.getByText("1 offen")).toBeTruthy());
    expect(screen.getByText("1 freigegeben")).toBeTruthy();
    expect(screen.queryByText("✓ Freigeben")).toBeNull();

    const kopf = screen.getByRole("button", { name: /Conversion-Kandidaten/ });
    expect(kopf.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(kopf);
    expect(screen.getByText("✓ Freigeben")).toBeTruthy();
    expect(screen.getByText("Freigegeben (1)")).toBeTruthy();
    expect(localStorage.getItem("ezy.convScout.open")).toBe("1");

    fireEvent.click(kopf);
    expect(screen.queryByText("✓ Freigeben")).toBeNull();
    expect(localStorage.getItem("ezy.convScout.open")).toBe("0");
  });

  it("öffnet beim Scan automatisch", async () => {
    vi.mocked(ezyFetch).mockImplementation(async (url) =>
      String(url).includes("conversion-scan") ? resp({ ok: true, gtmEvents: 2 }) : resp(antwort),
    );
    render(<ConversionScoutPanel selectedClient={{ id: "k1" }} />);
    await waitFor(() => expect(screen.getByText("1 offen")).toBeTruthy());
    fireEvent.click(screen.getByText("Website scannen"));
    await waitFor(() => expect(screen.getByText(/2 Event-Tags aus dem Container/)).toBeTruthy());
    expect(screen.getByText("✓ Freigeben")).toBeTruthy();
  });
});
