// Detailreport «Einzelzeilen» (23.09.2026): minutengenaue GA4-Zeilen muessen
// als einzelne Conversions (count = 1, time/city/page) herauskommen; gezaehlte
// Ereignisse (client_conversion_events) nehmen eventCount statt keyEvents.
import { describe, it, expect, vi, beforeEach } from "vitest";

const counted: string[] = [];
const ignored: string[] = []; // modus "ignoriert" (06.10.)
// Verkettbares .eq(): Abfrage ist zugleich awaitbar (thenable) und filterbar.
function abfrage(table: string, filter: Record<string, string> = {}): any {
  const daten = () => {
    if (table === "client_event_labels")
      return [{ event_name: "form_submit", label: "Suchformular" }];
    if (table !== "client_conversion_events") return [];
    const alle = [
      ...counted.map((event_name) => ({ event_name, modus: "zaehlt" })),
      ...ignored.map((event_name) => ({ event_name, modus: "ignoriert" })),
    ];
    return filter.modus ? alle.filter((x) => x.modus === filter.modus) : alle;
  };
  return {
    eq: (k: string, v: string) => abfrage(table, { ...filter, [k]: v }),
    then: (ok: (x: unknown) => unknown) => Promise.resolve({ data: daten() }).then(ok),
  };
}
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => ({ select: () => abfrage(table) }) },
}));
vi.mock("@/server/google-tokens.server", () => ({
  getGoogleAccessToken: async () => ({ accessToken: "t", connectionId: "c", email: null }),
}));
vi.mock("@/server/google-oauth.server", () => ({ redactSecrets: (e: unknown) => String(e) }));

const res = (json: unknown, ok = true, status = 200) =>
  new Response(JSON.stringify(json), { status: ok ? status : 400 });

function ga4Rows(dims: string[], rows: Array<{ d: string[]; m: (number | string)[] }>) {
  return {
    dimensionHeaders: dims.map((name) => ({ name })),
    rows: rows.map((r) => ({
      dimensionValues: r.d.map((value) => ({ value })),
      metricValues: r.m.map((value) => ({ value: String(value) })),
    })),
  };
}

describe("fetchAttribution — Einzelzeilen", () => {
  beforeEach(() => {
    counted.length = 0;
    ignored.length = 0;
  });

  it("ignoriertes Key Event zaehlt nicht (Totale und Einzelzeilen)", async () => {
    ignored.push("ua__4_seiten");
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (url.includes("customDimensions")) return res({ customDimensions: [] });
      const dims: string[] = (body.dimensions ?? []).map((d: any) => d.name);
      // Totale: 12 Sessions, 41 keyEvents (40 ua__4_seiten + 1 kontaktformular)
      if (dims.join() === "sessionSource,country,sessionDefaultChannelGroup")
        return res(ga4Rows(dims, [{ d: ["chatgpt.com", "Switzerland", "Referral"], m: [12, 41] }]));
      // Ignoriert-Report: ua__4_seiten mit 40 keyEvents
      if (dims.includes("eventName") && !dims.includes("deviceCategory")) {
        expect(body.dimensionFilter.filter.inListFilter.values).toContain("ua__4_seiten");
        return res(
          ga4Rows(dims, [{ d: ["chatgpt.com", "Referral", "ua__4_seiten"], m: [40, 40] }]),
        );
      }
      if (dims.includes("dateHourMinute"))
        return res(
          ga4Rows(dims, [
            {
              d: dims.map(
                (n) =>
                  ({
                    sessionSource: "chatgpt.com",
                    eventName: "ua__4_seiten",
                    country: "Switzerland",
                    deviceCategory: "desktop",
                    dateHourMinute: "202610061259",
                    sessionDefaultChannelGroup: "Referral",
                  })[n] ?? "(not set)",
              ),
              m: [24, 0, 0, 24],
            },
            {
              d: dims.map(
                (n) =>
                  ({
                    sessionSource: "chatgpt.com",
                    eventName: "kontaktformular",
                    country: "Switzerland",
                    deviceCategory: "desktop",
                    dateHourMinute: "202610061300",
                    sessionDefaultChannelGroup: "Referral",
                  })[n] ?? "(not set)",
              ),
              m: [1, 0, 0, 1],
            },
          ]),
        );
      return res({ rows: [] });
    });
    const { fetchAttribution } = await import("./aivis-attribution.server");
    const out = await fetchAttribution(
      { id: "c1", ga4_property: "123" },
      { startDate: "2026-09-06", endDate: "2026-10-06" },
    );
    if (!("engines" in out)) throw new Error("engines fehlen");
    const gpt = out.engines.find((e) => e.engine === "ChatGPT")!;
    expect(gpt.sessions).toBe(12);
    expect(gpt.conversions).toBe(1); // 41 - 40 ignorierte
    expect(gpt.events.map((e) => e.name)).toEqual(["kontaktformular"]);
    vi.unstubAllGlobals();
  });

  it("liefert je Conversion eine Zeile mit Zeit, Stadt und Seite", async () => {
    counted.push("form_submit");
    const calls: any[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      calls.push({ url, body });
      if (url.includes("customDimensions")) return res({ customDimensions: [] });
      const dims: string[] = (body.dimensions ?? []).map((d: any) => d.name);
      // 1) Totale
      if (dims.join() === "sessionSource,country,sessionDefaultChannelGroup")
        return res(ga4Rows(dims, [{ d: ["chatgpt.com", "Switzerland", "Referral"], m: [6, 0] }]));
      // 2) gezaehlte Ereignisse (eventCount)
      if (dims.includes("eventName") && !dims.includes("deviceCategory"))
        return res(ga4Rows(dims, [{ d: ["chatgpt.com", "Referral", "form_submit"], m: [0, 3] }]));
      // 3) Detail
      if (dims.includes("dateHourMinute"))
        return res(
          ga4Rows(dims, [
            {
              d: dims.map(
                (n) =>
                  ({
                    sessionSource: "chatgpt.com",
                    eventName: "form_submit",
                    country: "Switzerland",
                    deviceCategory: "desktop",
                    dateHourMinute: "202609021435",
                    sessionDefaultChannelGroup: "Referral",
                    transactionId: "(not set)",
                    city: "Luzern",
                    pagePath: "/kontakt",
                  })[n] ?? "(not set)",
              ),
              m: [0, 0, 0, 2],
            },
            {
              d: dims.map(
                (n) =>
                  ({
                    sessionSource: "chatgpt.com",
                    eventName: "form_submit",
                    country: "Switzerland",
                    deviceCategory: "mobile",
                    dateHourMinute: "202609011012",
                    sessionDefaultChannelGroup: "Referral",
                    transactionId: "(not set)",
                    city: "(not set)",
                    pagePath: "/shop",
                  })[n] ?? "(not set)",
              ),
              m: [0, 0, 0, 1],
            },
          ]),
        );
      return res({ rows: [] });
    });

    const { fetchAttribution } = await import("./aivis-attribution.server");
    const out = await fetchAttribution(
      { id: "c1", ga4_property: "123" },
      { startDate: "2026-06-26", endDate: "2026-09-23" },
    );
    expect("engines" in out).toBe(true);
    if (!("engines" in out)) return;
    expect(out.detailError).toBeUndefined();
    const gpt = out.engines.find((e) => e.engine === "ChatGPT")!;
    expect(gpt.conversions).toBe(3);
    expect(gpt.events).toHaveLength(3);
    expect(gpt.events[0]).toMatchObject({
      name: "form_submit",
      count: 1,
      date: "20260902",
      time: "14:35",
      city: "Luzern",
      page: "/kontakt",
      label: "Suchformular",
    });
    expect(gpt.events[2]).toMatchObject({ date: "20260901", time: "10:12", page: "/shop" });
    expect(gpt.events[2].city).toBeUndefined();
    // Detailreport ist auf KI-Quellen gefiltert (Kardinalitaet / "(other)").
    const detail = calls.find((c) =>
      c.body?.dimensions?.some((d: any) => d.name === "dateHourMinute"),
    );
    expect(detail.body.dimensionFilter.filter.fieldName).toBe("sessionSource");
    expect(detail.body.dimensionFilter.filter.stringFilter.value).toMatch(/chatgpt/);
    vi.unstubAllGlobals();
  });
});
